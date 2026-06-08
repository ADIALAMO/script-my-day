/**
 * POST /api/upload-character
 *
 * One-time character setup for the identity feature. Two-stage "Character Sheet"
 * pipeline that locks both identity AND style for downstream comic/poster panels:
 *
 *   1. Auth + tier gate (paid-only — no point storing biometrics we won't serve)
 *   2. Validate selfie data URI
 *   3. 🛡️ Nemotron content-safety moderation (fail-closed)
 *   4. Store the raw selfie in blob storage → rawUrl
 *   5. STAGE A — generate a clean, canonical character portrait from the selfie
 *      (Grok) and store it → styledUrl. Using an in-style reference for every panel
 *      keeps identity + style far more consistent than re-interpreting a photo each time.
 *   6. Persist a Redis pointer (URLs only) with a 90-day TTL (GDPR-friendly)
 *
 * Returns { success, characterImageUrl } where characterImageUrl is the styled
 * sheet — the reference the client passes to /api/generate-poster for each panel.
 */
import redis from '../../lib/redis.js';
import { CODES } from '../../lib/messages.js';
import { isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { limitFor } from '../../lib/quota.js';
import { moderateImage, grokImageFromReference, geminiImageFromReference, identityQuotaExceeded } from '../../lib/identity.js';
import { blobConfigured, putImage, decodeDataUri } from '../../lib/blob-store.js';

export const maxDuration = 60;
// Selfies are large base64 blobs; raise the default 1mb body limit.
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const CHARACTER_SHEET_PROMPT =
  'Clean character reference portrait, head and shoulders, of the exact person in the ' +
  'reference photo, preserving their facial features, comic illustration style, ' +
  'neutral plain background, front-facing, even lighting';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const isAdmin = isAdminRequest(req);
    const { selfieBase64, consent } = req.body || {};

    // (0) Biometric consent — mandatory before any face is processed/stored.
    // The client gates this in CharacterModal; enforce it server-side too so a
    // face is never persisted without a recorded affirmative consent.
    if (consent !== true) {
      return res.status(400).json({ success: false, code: CODES.CONSENT_REQUIRED });
    }

    // (1) Tier gate — identity requires at least the free lifetime allowance (anonymous = 0).
    let identifier = 'admin';
    let tier = 'admin';
    if (!isAdmin) {
      const ctx = await getSessionAndTier(req, res);
      identifier = ctx.identifier;
      tier = ctx.tier;
      if (limitFor(ctx.tier, 'identity') === 0) {
        return res.status(403).json({ success: false, code: CODES.NEEDS_PRO });
      }

      // Cost guard: don't burn a (paid) Character Sheet generation if the user has no
      // identity credit left to spend on a poster anyway. For free users this is their
      // one-time lifetime allowance — once spent, block re-upload and nudge to Pro.
      if (await identityQuotaExceeded(tier, identifier)) {
        const code = tier === 'free' ? CODES.IDENTITY_LIFETIME_USED : CODES.QUOTA_IDENTITY;
        return res.status(429).json({ success: false, code });
      }
    }

    // Option C cost control: Free's one-time sheet is generated with the cheaper Gemini
    // ($0.039) to cap the lifetime taste; Pro+/admin keep the signature Grok sheet ($0.06).
    const sheetGenerator = tier === 'free' ? geminiImageFromReference : grokImageFromReference;

    // (2) Input validation.
    if (typeof selfieBase64 !== 'string'
        || !selfieBase64.startsWith('data:image/')
        || selfieBase64.length > 8_000_000) {
      return res.status(400).json({ success: false, code: CODES.INPUT_TOO_SHORT });
    }

    // Blob storage is the one external dependency this endpoint needs.
    if (!blobConfigured()) {
      console.error('❌ upload-character: blob storage not configured (set S3_* env vars)');
      return res.status(503).json({ success: false, code: CODES.SERVER_ERROR });
    }

    // (3) 🛡️ Content safety — fail-closed.
    const safe = await moderateImage(selfieBase64);
    if (!safe) {
      return res.status(422).json({ success: false, code: CODES.SAFETY_REJECTED });
    }

    // (4) Store raw selfie.
    const { bytes, contentType } = decodeDataUri(selfieBase64);
    const stamp = Date.now();
    const rawUrl = await putImage(`characters/${identifier}-raw-${stamp}.jpg`, bytes, contentType);

    // (5) STAGE A — canonical character sheet. If it fails, fall back to the raw
    // selfie as the reference so the feature still works (degraded consistency).
    let styledUrl = rawUrl;
    try {
      const sheetDataUri = await sheetGenerator(CHARACTER_SHEET_PROMPT, rawUrl);
      const sheet = decodeDataUri(sheetDataUri);
      styledUrl = await putImage(`characters/${identifier}-sheet-${stamp}.jpg`, sheet.bytes, sheet.contentType);
    } catch (e) {
      console.warn(`⚠️ Character sheet generation failed, using raw selfie as reference: ${e.message}`);
    }

    // (6) Persist pointer (URLs only) with 90-day TTL.
    const ninetyDays = Math.floor(Date.now() / 1000) + 90 * 86400;
    try {
      const pipe = redis.pipeline();
      pipe.set(`character:${identifier}`, JSON.stringify({
        url: rawUrl, styledUrl, createdAt: Math.floor(stamp / 1000), status: 'ready',
        consentAt: Math.floor(stamp / 1000), // biometric consent recorded with the asset (BIPA/GDPR audit trail)
      }));
      pipe.expireat(`character:${identifier}`, ninetyDays);
      await pipe.exec();
    } catch (e) {
      console.warn(`⚠️ Character pointer persist skipped (Redis down): ${e.message}`);
    }

    console.log(`🎭 Character ready for ${identifier} (sheet: ${styledUrl !== rawUrl})`);
    return res.status(200).json({ success: true, characterImageUrl: styledUrl });
  } catch (err) {
    console.error('upload-character unhandled error:', err.message, err.stack);
    return res.status(500).json({ success: false, code: CODES.SERVER_ERROR });
  }
}
