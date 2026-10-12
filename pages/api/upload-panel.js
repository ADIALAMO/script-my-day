import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import redis from '../../lib/redis.js';
import { isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { UPLOAD_LIMITS } from '../../config/limits.js';
import { checkImage, markImageChecked, getImageMark, imageHash, cleanProviderTag } from '../../lib/image-check.js';
import { CODES } from '../../lib/messages.js';
import { MAX_IMAGE_BYTES, sniffImage, decodeDataUriBytes, buildObjectKey, objectKeySecretConfigured } from '../../lib/upload-image.js';

// ── R2 client singleton ───────────────────────────────────────────────────────
// Reuses the same HTTP connection pool across warm serverless invocations.
// R2 exposes a fully S3-compatible API at the account-specific endpoint.
let _s3 = null;
function getS3() {
  if (!_s3) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID not configured.');
    if (!process.env.R2_ACCESS_KEY_ID) throw new Error('R2_ACCESS_KEY_ID not configured.');
    if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error('R2_SECRET_ACCESS_KEY not configured.');
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

// ── Upload quotas ─────────────────────────────────────────────────────────────
// Per-identifier rolling 30-day window limits that cap R2 storage growth. The numbers live in
// config/limits.js (UPLOAD_LIMITS). Admins bypass entirely; Redis downtime fails open.

// Single 30-day TTL for both asset types. Set once on the first upload in a
// window; subsequent uploads inherit the expiry, resetting naturally at day 30.
const WINDOW_SECS = 30 * 24 * 60 * 60;

// ── Body size limit ───────────────────────────────────────────────────────────
// Base64 encodes ~33 % larger than binary. A 1 024px JPEG from Flux is typically
// 150–350 KB binary → 200–470 KB base64. 4 MB gives ample headroom.
export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

// The fail-closed re-check below (only when the image was not already checked by generate-poster) can take up to ~16 s.
export const maxDuration = 30;

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Shared sliding-window limiter, before any parsing or storage work.
  if (await enforceRateLimit(req, res, 'upload-panel')) return;

  const { imageData, key } = req.body ?? {};

  // ── Input validation ──────────────────────────────────────────────────────
  if (!imageData || typeof imageData !== 'string') {
    return res.status(400).json({ error: 'imageData is required and must be a string.' });
  }

  // The client's `key` is no longer used as a storage path (it could overwrite
  // objects or pick arbitrary paths). Only its prefix is read, as a hint for
  // which folder + quota bucket this asset belongs to; older clients keep
  // sending it and keep working unchanged.
  const assetType = /** @type {'panels'|'posters'} */ (
    typeof key === 'string' && key.startsWith('panels/') ? 'panels' : 'posters'
  );

  // ── Decode + verify the bytes ─────────────────────────────────────────────
  // The claimed MIME type is ignored: only real png/jpeg/webp content (checked
  // by magic bytes) is accepted, and the stored type comes from those bytes.
  const imageBuffer = decodeDataUriBytes(imageData);
  if (!imageBuffer) {
    return res.status(400).json({ error: 'imageData must be a valid base64 data URI.' });
  }
  if (imageBuffer.length > MAX_IMAGE_BYTES) {
    return res.status(413).json({ error: 'Image too large.' });
  }
  const sniffed = sniffImage(imageBuffer);
  if (!sniffed) {
    return res.status(400).json({ error: 'Unsupported image type. Only PNG, JPEG and WebP are accepted.' });
  }
  const mimeType = sniffed.mime;

  if (!objectKeySecretConfigured()) {
    console.error('❌ upload-panel: OBJECT_KEY_SECRET is not configured — refusing to store images');
    return res.status(500).json({ error: 'Storage key secret not configured.' });
  }

  // ── R2 config ─────────────────────────────────────────────────────────────
  const bucket    = process.env.R2_BUCKET_NAME;
  const publicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');

  if (!bucket || !publicUrl) {
    return res.status(500).json({ error: 'R2_BUCKET_NAME or R2_PUBLIC_URL not configured.' });
  }

  // ── Output-image safety check ──────────────────────────────────────────────
  // generate-poster checks every image it returns and leaves an `imgok:<sha256 of the bytes>` marker (6 h). The browser
  // uploads those SAME bytes, so a marker hit stores them with no second model call. Anything else — a direct API upload, an
  // edited image, an expired marker — is checked here, fail-closed, before it can become a public R2 URL. Runs before the
  // upload quota is touched, so a rejected or unverifiable image costs the caller nothing.
  const checkedUri = `data:${sniffed.mime};base64,${imageBuffer.toString('base64')}`;
  const bytesHash = imageHash(checkedUri);

  // Bytes a user already reported (before they were uploaded) are never stored. A Redis error fails OPEN here — the output check
  // below still runs, and hiding is enforced again by the image proxy.
  try {
    if (await redis.get(`report:hidden:h:${bytesHash}`)) {
      return res.status(422).json({ error: 'Image rejected.', code: CODES.CONTENT_REFUSED });
    }
  } catch (e) { console.warn(`⚠️ report-hidden check skipped: ${e.message}`); }

  const mark = await getImageMark(checkedUri);   // null | '1' | provider tag written by generate-poster
  if (mark === null) {
    const check = await checkImage(checkedUri, { budgetMs: 20000 });
    if (check.verdict === 'unsafe') {
      console.warn(`🛑 upload-panel: image rejected by the output check (via ${check.via}${check.why ? `, ${check.why}` : ''})`);
      return res.status(422).json({ error: 'Image rejected.', code: CODES.CONTENT_REFUSED });
    }
    if (check.verdict !== 'safe') {
      return res.status(503).json({ error: 'Safety check unavailable.', code: CODES.CONTENT_CHECK_UNAVAILABLE });
    }
    await markImageChecked(checkedUri);
  }

  // ── Upload gate ───────────────────────────────────────────────────────────
  // Enforces per-identifier rolling-window quotas to prevent unbounded R2
  // storage growth.  The gate is skipped for admin requests and fails open when
  // Redis is unavailable — a brief outage must never block a generation.
  //
  // Algorithm: INCR-first with atomic rollback on breach.
  //   1. INCR the counter atomically.  The returned value is the new total.
  //   2. On the first write (count === 1), arm the 30-day expiry asynchronously.
  //      Fire-and-forget: if expireat fails the key persists slightly longer,
  //      which is far preferable to blocking the upload with an await/throw.
  //   3. If the new count exceeds the limit, DECR to restore accuracy, then
  //      return a synthetic 200 so the UI stays unbroken.  The in-session data
  //      URI the client already holds keeps the image visible; the history entry
  //      simply won't carry a CDN url for this asset.
  let ownerId = 'admin'; // feeds the (hashed) owner segment of the generated key
  if (!isAdminRequest(req)) {
    ownerId = 'unknown';
    try {
      const { tier, identifier } = await getSessionAndTier(req, res);
      ownerId = identifier;
      // Admin (resolved via session tier, not the x-admin-key header) bypasses the storage
      // gate entirely — same as a header admin. Without this an admin fell through to the
      // anonymous caps (20 panels / 5 posters) and uploads silently returned url:null, so
      // generated panels never got a CDN URL and could not persist to history.
      if (tier !== 'admin') {
      const limits     = UPLOAD_LIMITS[tier] ?? UPLOAD_LIMITS.anonymous;
      const limit      = limits[assetType];
      const storageKey = `upload:${assetType}:${identifier}`;

      const newCount = await redis.incr(storageKey);

      if (newCount === 1) {
        redis
          .expireat(storageKey, Math.floor(Date.now() / 1000) + WINDOW_SECS)
          .catch(e => console.warn(`⚠️ upload gate expireat failed (${storageKey}): ${e.message}`));
      }

      if (newCount > limit) {
        redis
          .decr(storageKey)
          .catch(e => console.warn(`⚠️ upload gate decr failed (${storageKey}): ${e.message}`));

        return res.status(200).json({ url: null, gated: true });
      }
      }
    } catch (e) {
      // Redis unavailable or session resolution threw — fail open so uploads are
      // never blocked by infrastructure outages (consistent with quota pattern).
      console.warn(`⚠️ Upload gate check skipped (Redis unavailable): ${e.message}`);
    }
  }

  // ── R2 write ──────────────────────────────────────────────────────────────
  // Server-generated key: unguessable, unique per upload, never overwrites.
  const objectKey = buildObjectKey(assetType, ownerId, sniffed.ext);
  try {
    await getS3().send(new PutObjectCommand({
      Bucket:       bucket,
      Key:          objectKey,
      Body:         imageBuffer,
      ContentType:  mimeType,
      // Which engine produced it (server-written marker, never client input) — for diagnostics and report triage; no personal data.
      ...(cleanProviderTag(mark !== '1' ? mark : null) ? { Metadata: { provider: cleanProviderTag(mark) } } : {}),
      // Assets are immutable once generated — aggressive CDN caching is safe.
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    // hash → key, so a report made while the image was still only in the browser (hash-based) can find the stored object.
    try { await redis.set(`objkey:${bytesHash}`, objectKey, { ex: 400 * 24 * 60 * 60 }); }
    catch (e) { console.warn(`⚠️ objkey mapping skipped: ${e.message}`); }

    const url = `${publicUrl}/${objectKey}`;
    return res.status(200).json({ url });

  } catch (err) {
    console.error('🔴 R2 upload failed:', { key: objectKey, message: err.message, code: err.Code });
    return res.status(500).json({ error: 'Upload to R2 failed. Panel stored in session only.' });
  }
}
