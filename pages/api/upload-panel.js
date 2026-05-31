import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import redis from '../../lib/redis.js';
import { isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';

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
// Per-identifier rolling 30-day window limits that cap R2 storage growth on
// free-tier accounts.  These are intentionally set above realistic daily-quota
// ceilings (e.g. free = 1 comic/day × 2 unlocked panels × 30 days = 60 panels
// theoretical max; 80 gives a 33 % safety margin before the gate trips).
// Admins bypass entirely; Redis downtime fails open (see catch block below).
const UPLOAD_LIMITS = {
  anonymous: { panels: 20,  posters: 5   },
  free:      { panels: 80,  posters: 45  },
  pro:       { panels: 250, posters: 120 },
};

// Single 30-day TTL for both asset types. Set once on the first upload in a
// window; subsequent uploads inherit the expiry, resetting naturally at day 30.
const WINDOW_SECS = 30 * 24 * 60 * 60;

// ── Body size limit ───────────────────────────────────────────────────────────
// Base64 encodes ~33 % larger than binary. A 1 024px JPEG from Flux is typically
// 150–350 KB binary → 200–470 KB base64. 4 MB gives ample headroom.
export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
};

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { imageData, key } = req.body ?? {};

  // ── Input validation ──────────────────────────────────────────────────────
  if (!imageData || typeof imageData !== 'string') {
    return res.status(400).json({ error: 'imageData is required and must be a string.' });
  }
  if (!key || typeof key !== 'string') {
    return res.status(400).json({ error: 'key is required and must be a string.' });
  }
  // Guard against path traversal and arbitrary key shapes.
  if (!key.match(/^(panels|posters)\//) || key.includes('..') || key.length > 200) {
    return res.status(400).json({ error: 'Invalid key format.' });
  }

  // Asset type is derived deterministically from the validated key prefix.
  const assetType = /** @type {'panels'|'posters'} */ (
    key.startsWith('panels/') ? 'panels' : 'posters'
  );

  // ── Parse data URI ────────────────────────────────────────────────────────
  // Expected format: "data:image/jpeg;base64,/9j/..."
  const match = imageData.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) {
    return res.status(400).json({ error: 'imageData must be a valid base64 data URI.' });
  }
  const [, mimeType, b64] = match;
  const imageBuffer = Buffer.from(b64, 'base64');

  // ── R2 config ─────────────────────────────────────────────────────────────
  const bucket    = process.env.R2_BUCKET_NAME;
  const publicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');

  if (!bucket || !publicUrl) {
    return res.status(500).json({ error: 'R2_BUCKET_NAME or R2_PUBLIC_URL not configured.' });
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
  if (!isAdminRequest(req)) {
    try {
      const { tier, identifier } = await getSessionAndTier(req, res);
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

        console.log(`🚫 Upload gated [${tier}/${assetType}]: ${identifier} reached ${limit} assets`);
        return res.status(200).json({ url: null, gated: true });
      }
    } catch (e) {
      // Redis unavailable or session resolution threw — fail open so uploads are
      // never blocked by infrastructure outages (consistent with quota pattern).
      console.warn(`⚠️ Upload gate check skipped (Redis unavailable): ${e.message}`);
    }
  }

  // ── R2 write ──────────────────────────────────────────────────────────────
  try {
    await getS3().send(new PutObjectCommand({
      Bucket:       bucket,
      Key:          key,
      Body:         imageBuffer,
      ContentType:  mimeType,
      // Assets are immutable once generated — aggressive CDN caching is safe.
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    const url = `${publicUrl}/${key}`;
    console.log(`☁️ R2 upload: ${key} (${imageBuffer.length} bytes) → ${url}`);
    return res.status(200).json({ url });

  } catch (err) {
    console.error('🔴 R2 upload failed:', { key, message: err.message, code: err.Code });
    return res.status(500).json({ error: 'Upload to R2 failed. Panel stored in session only.' });
  }
}
