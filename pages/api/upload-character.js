/**
 * POST /api/upload-character
 *
 * One-time character setup for the identity feature. Two-stage "Character Sheet"
 * pipeline that locks both identity AND style for downstream comic/poster panels:
 *
 *   1. Auth + tier gate (paid-only — no point storing biometrics we won't serve), then the account's stored 18+ confirmation (403 ADULT_CONFIRMATION_REQUIRED)
 *   2. Validate the selfie: a real JPEG / PNG / WebP by its own BYTES (SVG, GIF, anything else is refused)
 *   3. Reserve the paid generation (per-user sheet quota + global identity budget)
 *   4. 🛡️ FULL image-safety check (lib/image-check.js checkImage: Nemotron + Gemini second opinion) on the exact bytes that will be stored — fail-closed
 *      (unsafe → SAFETY_REJECTED, checker unavailable → CONTENT_CHECK_UNAVAILABLE; both give the reservations back), then the apparent-minor screen
 *   5. Store the raw selfie in blob storage (the provider fetches it by URL) — it is deleted after EVERY attempt, whatever the outcome
 *   6. STAGE A — generate a clean, canonical character portrait from the selfie
 *      (Grok / Gemini), run the output check on it, store it → styledUrl.
 *      If this stage fails for ANY reason the request fails with an error: there is NO fallback to the raw selfie as a reference.
 *   7. Persist a Redis pointer (URLs only) with a 90-day TTL (GDPR-friendly)
 *   8. Replace flow: ONLY after the new sheet is stored and the new pointer written, delete the objects the previous pointer named (own scope only; best effort)
 *
 * Returns { success, characterImageUrl, sheetGenerated: true } where characterImageUrl is the styled
 * sheet — the reference the client passes to /api/generate-poster for each panel.
 */
import redis from '../../lib/redis.js';
import { CODES } from '../../lib/messages.js';
import { isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { limitFor } from '../../lib/quota.js';
import { grokImageFromReference, geminiImageFromReference, identityQuotaExceeded } from '../../lib/identity.js';
import { reserveIdentityBudget, releaseIdentityBudget } from '../../lib/budget.js';
import { reserveSheetQuota, releaseSheetQuota } from '../../lib/sheet-quota.js';
import { blobConfigured, putImage, decodeDataUri } from '../../lib/blob-store.js';
import { buildCharacterKeys, objectKeySecretConfigured, sniffImage, decodeDataUriBytes } from '../../lib/upload-image.js';
import { RETENTION, SELFIE_MAX_BYTES } from '../../config/limits.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { checkImage } from '../../lib/image-check.js';
import { readAdultConfirmation } from '../../lib/adult-confirmation.js';
import { screenApparentMinor } from '../../lib/minor-screen.js';
import { ContentRefusalError } from '../../lib/content-safety.js';
import { deleteRawSelfie, deletePreviousCharacter } from '../../lib/character-store.js';

export const maxDuration = 60;
// Selfies are large base64 blobs; raise the default 1mb body limit.
export const config = { api: { bodyParser: { sizeLimit: '8mb' } } };

const CHARACTER_SHEET_PROMPT =
  'Clean character reference portrait, head and shoulders, of the exact person in the ' +
  'reference photo, preserving their facial features, comic illustration style, ' +
  'neutral plain background, front-facing, even lighting';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  // ── Rate limiting (sliding window, before any paid AI call) ──────────────
  // upload-character triggers Grok + Gemini calls (~$0.10/request); the tight
  // 4/5m window means a malicious burst drains at most $0.40 before being cut.
  if (await enforceRateLimit(req, res, 'upload-character')) return;

  const startedAt = Date.now();
  let dropRaw = async () => {};          // deletes the raw selfie (a no-op until it has been stored); idempotent
  let giveBackReservation = async () => {};
  let refundOnCrash = false;             // true from the reservation until the paid sheet call has returned: an unexpected crash gives the quota back
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

      // (1b) "Star Yourself" is 18+: the ACCOUNT must have confirmed it (user:adult:<userId>, lib/adult-confirmation.js) — the client state alone
      // is not trusted. Checked before any quota, storage or paid call. Redis cannot answer → fail CLOSED (a face feature, like the identity quota).
      // A self-declaration, NOT age verification; the apparent-minor screen below is a separate layer and unchanged.
      let adult;
      try { adult = await readAdultConfirmation(ctx.userId); }
      catch (e) { console.error('❌ upload-character: adult confirmation unreadable —', e.message); return res.status(503).json({ success: false, code: CODES.SERVER_ERROR }); }
      if (!adult.confirmed) {
        return res.status(403).json({ success: false, code: CODES.ADULT_CONFIRMATION_REQUIRED });
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

    // (2) Input validation. The claimed MIME type is ignored: the bytes must BE a JPEG / PNG / WebP (magic bytes), the stored type and extension come from them.
    // SVG (can carry script), GIF and everything else are refused. The very same bytes are what the safety check sees and what is stored.
    if (typeof selfieBase64 !== 'string' || !selfieBase64.startsWith('data:image/') || selfieBase64.length > 8_000_000) {
      return res.status(400).json({ success: false, code: CODES.INPUT_TOO_SHORT });
    }
    const bytes = decodeDataUriBytes(selfieBase64);
    if (!bytes || bytes.length === 0 || bytes.length > SELFIE_MAX_BYTES) {
      return res.status(400).json({ success: false, code: CODES.INPUT_TOO_SHORT });
    }
    const sniffed = sniffImage(bytes);
    if (!sniffed) {
      return res.status(400).json({ success: false, code: CODES.IMAGE_UNSUPPORTED });
    }
    const checkedUri = `data:${sniffed.mime};base64,${bytes.toString('base64')}`;

    // Blob storage is the one external dependency this endpoint needs.
    if (!blobConfigured()) {
      console.error('❌ upload-character: blob storage not configured (set S3_* env vars)');
      return res.status(503).json({ success: false, code: CODES.SERVER_ERROR });
    }

    if (!objectKeySecretConfigured()) {
      console.error('❌ upload-character: OBJECT_KEY_SECRET is not configured — refusing to store the photo');
      return res.status(503).json({ success: false, code: CODES.SERVER_ERROR });
    }

    // (3) Reserve the PAID generation: per-user daily upload quota AND the global daily identity
    // budget, both ATOMICALLY (INCR first, compare after — see lib/sheet-quota.js, lib/budget.js)
    // and BEFORE any storage, safety check or paid call, so an over-limit request costs nothing. A hit is an
    // explicit error the UI shows — never a silent downgrade. Admin bypasses.
    // Redis trouble fails CLOSED: this is a per-call paid feature.
    let sheetKey = null;
    let budgetReserved = false;
    if (!isAdmin) {
      try {
        const q = await reserveSheetQuota(tier, identifier);
        if (!q.ok) return res.status(429).json({ success: false, code: CODES.QUOTA_SHEET, limit: q.limit, resetsAt: q.resetsAt });
        sheetKey = q.key;

        const b = await reserveIdentityBudget();
        if (!b.ok) {
          await releaseSheetQuota(sheetKey);
          console.warn('🛑 Global daily identity budget reached — character sheet refused.');
          return res.status(503).json({ success: false, code: CODES.IDENTITY_BUDGET_REACHED });
        }
        budgetReserved = true;
      } catch (e) {
        await releaseSheetQuota(sheetKey);
        console.warn(`⚠️ Sheet reservation unverifiable (Redis down) — failing closed: ${e.message}`);
        return res.status(503).json({ success: false, code: CODES.SERVER_ERROR });
      }
    }
    giveBackReservation = async () => {
      await releaseSheetQuota(sheetKey);
      if (budgetReserved) await releaseIdentityBudget();
    };
    refundOnCrash = true;

    // (4) 🛡️ Content safety — the SAME two-opinion check every generated image gets (Nemotron "safe" is then confirmed by the Gemini second opinion
    // on nudity / sexualised content / apparent minors), on the exact bytes that will be stored. Fail-closed: unsafe → SAFETY_REJECTED, no answer
    // (circuit open, budget spent, outage) → CONTENT_CHECK_UNAVAILABLE (retryable). Either way nothing was stored or generated and the reservations go back.
    const selfieCheck = await checkImage(checkedUri, { budgetMs: 20000 });
    if (selfieCheck.verdict !== 'safe') {
      console.warn(`🛑 upload-character: selfie not accepted — output check ${selfieCheck.verdict} (via ${selfieCheck.via}${selfieCheck.why ? `, ${selfieCheck.why}` : ''})`);
      await giveBackReservation(); refundOnCrash = false;
      return selfieCheck.verdict === 'unsafe'
        ? res.status(422).json({ success: false, code: CODES.SAFETY_REJECTED })
        : res.status(503).json({ success: false, code: CODES.CONTENT_CHECK_UNAVAILABLE });
    }

    // (4b) Best-effort screen for a photo that CLEARLY shows a child ("Star Yourself" is 18+). NOT age verification: unsure, an unreadable
    // reply, a refusal, a failed call, an open circuit or a spent daily budget all ALLOW the photo. Runs before anything is stored or any paid
    // sheet is generated; a rejection gives the reservations back.
    const minor = await screenApparentMinor(checkedUri);
    if (minor.reject) {
      console.warn('🛑 upload-character: photo appears to show a child — rejected before storing or generating anything');
      await giveBackReservation(); refundOnCrash = false;
      return res.status(422).json({ success: false, code: CODES.MINOR_REJECTED });
    }

    const stamp = Date.now();
    // Random, unguessable names under an HMAC owner segment (no user id in the public URL; see lib/upload-image.js).
    const keys = buildCharacterKeys(identifier, sniffed.ext);
    let rawUrl;
    let rawStored = false;
    // The raw selfie exists ONLY to feed the sheet generator (the provider fetches it by public URL). It is deleted after EVERY attempt — success, provider
    // failure, refused or unavailable output check, storage failure, crash — and is never the user's reference. A delete that keeps failing marks the object
    // hidden (the daily sweep then moves it to the private bucket) and alerts (lib/character-store.js).
    dropRaw = async () => {
      if (!rawStored) return;
      rawStored = false;
      await deleteRawSelfie(keys.raw);
    };
    try {
      // (5) Store raw selfie (bytes exactly as checked; type + extension from the bytes).
      rawUrl = await putImage(keys.raw, bytes, sniffed.mime);
      rawStored = true;
    } catch (e) {
      await giveBackReservation(); refundOnCrash = false;   // storage failed before any paid call
      throw e;
    }

    // (6) STAGE A — canonical character sheet (the paid call). If the PROVIDER fails there is no usable reference: the raw photo is deleted, the quota AND
    // the budget slot are given back (no money was spent) and the user gets an error.
    let sheetDataUri;
    try {
      sheetDataUri = await sheetGenerator(CHARACTER_SHEET_PROMPT, rawUrl);
    } catch (e) {
      console.warn(`⚠️ Character sheet generation failed: ${e.message}`);
      await dropRaw();
      await giveBackReservation(); refundOnCrash = false;
      return e instanceof ContentRefusalError
        ? res.status(422).json({ success: false, code: CODES.CONTENT_REFUSED })
        : res.status(503).json({ success: false, code: CODES.CHARACTER_SHEET_FAILED });
    }
    refundOnCrash = false;   // the provider answered: money was (probably) spent. The paths below decide what is given back.
    await dropRaw();         // the generator has read the photo; it is not needed any more, whatever happens next

    // The generated sheet is the reference EVERY later poster/panel is conditioned on, so it gets the same output check as
    // any other generated image before it is stored. Unsafe or no checker available → not stored; the user's sheet quota is handed back
    // (they get nothing), the global identity budget slot stays spent because the provider call really happened. Rate limit + global budget bound retries.
    const check = await checkImage(sheetDataUri, { budgetMs: Math.max(5000, Math.min(25000, 55000 - (Date.now() - startedAt))) });
    if (check.verdict !== 'safe') {
      console.warn(`🛑 upload-character: generated sheet not stored — output check ${check.verdict} (via ${check.via}${check.why ? `, ${check.why}` : ''})`);
      await releaseSheetQuota(sheetKey);   // the user is not charged for a sheet they cannot use (the global budget slot keeps the real provider cost)
      return check.verdict === 'unavailable'
        ? res.status(503).json({ success: false, code: CODES.CONTENT_CHECK_UNAVAILABLE })
        : res.status(422).json({ success: false, code: CODES.CONTENT_REFUSED });
    }

    let styledUrl;
    try {
      const sheet = decodeDataUri(sheetDataUri);
      styledUrl = await putImage(keys.sheet, sheet.bytes, sheet.contentType);
    } catch (e) {
      // Generated but could not be stored: the user got nothing, so their sheet quota goes back (the global budget keeps the real cost).
      console.warn(`⚠️ Character sheet could not be stored: ${e.message}`);
      await releaseSheetQuota(sheetKey);
      return res.status(503).json({ success: false, code: CODES.CHARACTER_SHEET_FAILED });
    }

    // (7) Persist pointer (URLs only) with RETENTION.characterPointerDays TTL (default 90) — set once, never refreshed on use.
    let previousPointer = null;   // read BEFORE the overwrite; a Redis failure just means there is nothing to clean up
    try { previousPointer = await redis.get(`character:${identifier}`); } catch { /* best effort */ }
    const ninetyDays = Math.floor(Date.now() / 1000) + RETENTION.characterPointerDays * 86400;
    let pointerWritten = false;
    try {
      const pipe = redis.pipeline();
      pipe.set(`character:${identifier}`, JSON.stringify({
        url: styledUrl, styledUrl, createdAt: Math.floor(stamp / 1000), status: 'ready',
        consentAt: Math.floor(stamp / 1000), // biometric consent recorded with the asset (BIPA/GDPR audit trail)
      }));
      pipe.expireat(`character:${identifier}`, ninetyDays);
      await pipe.exec();
      pointerWritten = true;
    } catch (e) {
      console.warn(`⚠️ Character pointer persist skipped (Redis down): ${e.message}`);
    }

    // (8) The new character is stored and pointed to: only now is the previous one disposable. Never fails the upload.
    if (pointerWritten && previousPointer) {
      try { await deletePreviousCharacter(identifier, previousPointer, [keys.sheet, keys.raw]); } catch { /* deletePreviousCharacter never throws; belt and braces */ }
    }

    console.log(`🎭 Character ready for ${identifier}`);
    return res.status(200).json({ success: true, characterImageUrl: styledUrl, sheetGenerated: true });
  } catch (err) {
    try { await dropRaw(); } catch { /* deleteRawSelfie never throws; belt and braces */ }
    if (refundOnCrash) { try { await giveBackReservation(); } catch { /* best effort */ } }
    console.error('upload-character unhandled error:', err.message, err.stack);
    return res.status(500).json({ success: false, code: CODES.SERVER_ERROR });
  }
}
