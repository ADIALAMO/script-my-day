/**
 * Character-consistency (identity) feature — all OpenRouter calls, the tier/quota
 * gate, and the credit accounting in one cohesive module.
 *
 * Verified live against OpenRouter:
 *   Grok image     → x-ai/grok-imagine-image-quality, modalities:["image"],
 *                    image at choices[0].message.images[0].image_url.url (base64 JPEG)
 *   Moderation     → nvidia/nemotron-3.5-content-safety:free (text+image, free)
 */
import redis from './redis.js';
import { CODES } from './messages.js';
import { nextMonthStartUTC, nextMidnightUTC } from './api-utils.js';
import { identityBudgetReached, reserveIdentityBudget, releaseIdentityBudget } from './budget.js';
import { getSessionAndTier } from './auth.js';
import { limitFor } from './quota.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OR_HEADERS = (key) => ({
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': 'https://lifescript.app',
  'X-Title': 'LifeScript Studio',
});

// ─── Reference-conditioned image generation (OpenRouter) ────────────────────────

// Both verified models return the image at the same path:
//   choices[0].message.images[0].image_url.url  (base64 data URI)
// so a single generic caller serves both tiers of the identity cascade.
async function orImageFromReference(model, prompt, referenceUrl, timeoutMs = 45000) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not configured');
  if (!referenceUrl) throw new Error('image-from-reference requires a referenceUrl');

  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: OR_HEADERS(key),
    body: JSON.stringify({
      model,
      modalities: ['image'],
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: referenceUrl } },
        ],
      }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`${model} ${res.status}: ${err.substring(0, 150)}`);
  }
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
  if (!raw) throw new Error(`${model} returned no image`);
  return raw; // base64 data URI (Grok=JPEG, Gemini=PNG)
}

// P1 — quality default: bold inked comic look that sets the app's tone ($0.06 flat).
export const grokImageFromReference = (prompt, referenceUrl, { timeoutMs = 45000 } = {}) =>
  orImageFromReference('x-ai/grok-imagine-image-quality', prompt, referenceUrl, timeoutMs);

// P2 — cheaper/faster fallback ($0.039, softer style). Benchmarked at parity on identity.
export const geminiImageFromReference = (prompt, referenceUrl, { timeoutMs = 45000 } = {}) =>
  orImageFromReference('google/gemini-2.5-flash-image', prompt, referenceUrl, timeoutMs);

// ─── Nemotron content-safety moderation ─────────────────────────────────────────

/**
 * Returns true only when the image is classified SAFE.
 * Fail-closed: any error / non-OK response returns false so we never store or
 * use an unmoderated face.
 */
export async function moderateImage(imageUrl) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return false;
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: OR_HEADERS(key),
      body: JSON.stringify({
        model: 'nvidia/nemotron-3.5-content-safety:free',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Classify this image for content safety. Answer "safe" or "unsafe".' },
            { type: 'image_url', image_url: { url: imageUrl } },
          ],
        }],
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    const verdict = (data?.choices?.[0]?.message?.content || '').toLowerCase();
    return verdict.includes('safe') && !verdict.includes('unsafe');
  } catch (e) {
    console.warn(`⚠️ Moderation failed (fail-closed): ${e.message}`);
    return false;
  }
}

// ─── Tier + monthly-quota gate ──────────────────────────────────────────────────

function monthKey(identifier) {
  const d = new Date();
  const ym = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  return `usage:identity:${identifier}:${ym}`;
}

// Free tier's single identity poster is a ONE-TIME-FOR-LIFE taste, so it lives under a
// dedicated key with NO expiry — it must never reset like the monthly paid allowance.
function lifetimeKey(identifier) {
  return `usage:identity:lifetime:${identifier}`;
}

// Bonus identity credits earned through the referral loop (lib/referral.js). No expiry —
// they accumulate and RAISE the user's effective identity limit. Read here so the existing
// gate stays the single enforcement point (the global budget kill-switch still applies on
// top). Fail-OPEN to 0: a bonus-read outage must never *grant* extra paid calls.
function bonusKey(identifier) {
  return `usage:identity:bonus:${identifier}`;
}

async function identityBonus(identifier) {
  try {
    return parseInt(await redis.get(bonusKey(identifier)), 10) || 0;
  } catch {
    return 0; // unreadable → assume no bonus (never inflates the paid allowance)
  }
}

// ─── Global daily spend kill-switch ──────────────────────────────────────────────
// The counter + checks live in lib/budget.js (re-exported here so existing imports keep working).
export { IDENTITY_MAX_COST_USD, identityBudgetReached } from './budget.js';

/**
 * Read-only peek: has this user already spent their identity allowance?
 * Used by upload-character.js to block a (paid) Character Sheet regeneration when a free
 * user has already burned their one-time lifetime poster — saves the sheet cost and nudges
 * to Pro. Fail-OPEN on Redis error: never block a legitimate upload on a transient outage;
 * the poster gate (resolveIdentityGate) remains the authoritative spend-time enforcer.
 */
export async function identityQuotaExceeded(tier, identifier) {
  const limit = limitFor(tier, 'identity');
  if (limit === Infinity) return false;
  if (limit === 0) return true;
  const key = tier === 'free' ? lifetimeKey(identifier) : monthKey(identifier);
  try {
    const used = parseInt(await redis.get(key), 10) || 0;
    // Referral bonus credits raise the effective allowance — keep this peek in sync with the
    // spend-time gate so a rewarded free user isn't wrongly blocked from re-uploading.
    return used >= limit + await identityBonus(identifier);
  } catch (e) {
    console.warn(`⚠️ Identity quota peek skipped (Redis down): ${e.message}`);
    return false;
  }
}

/** reference must be an https URL (preferred) or a base64 image data URI. */
export function validFaceUrl(u) {
  return typeof u === 'string'
    && (u.startsWith('https://') || u.startsWith('data:image/'))
    && u.length < 2_000_000;
}

/**
 * Decides whether a request may use the Identity Track. Returns one of:
 *   { mode: 'identity', usageKey, limit, release }              → run identity provider; credit + budget slot are already
 *                                                                 RESERVED — call release() if the face was not applied
 *   { mode: 'standard' }                                       → no/invalid face → normal generation (not an error)
 *   { mode: 'standard', identityDegraded: true, code }         → had a face, but this user's own
 *                                                                 identity quota is exhausted — degrades
 *                                                                 to a faceless image instead of failing
 *                                                                 the whole request; `code` tells the
 *                                                                 client WHY (lifetime vs monthly) so it
 *                                                                 can show an accurate non-blocking notice
 *   { mode: 'reject', status, code }                           → blocked outright (not eligible for the
 *                                                                 tier at all — e.g. anonymous)
 */
export async function resolveIdentityGate(req, res, { isAdmin, characterImageUrl, isComic = false }) {
  const hasFace = validFaceUrl(characterImageUrl);

  if (isAdmin) {
    return hasFace ? { mode: 'identity', usageKey: null, limit: Infinity } : { mode: 'standard' };
  }
  if (!hasFace) return { mode: 'standard' };

  const { tier, identifier } = await getSessionAndTier(req, res);
  const limit = limitFor(tier, 'identity');

  // (1) Tier gate — identity is paywalled for anonymous (limit = 0).
  if (limit === 0) return { mode: 'reject', status: 403, code: CODES.NEEDS_PRO };

  // (2) Free tier gets ONE lifetime identity poster — poster track only. A free identity
  // request inside the comic flow degrades to the faceless cascade instead of burning the
  // one-time credit (or erroring mid-comic). Paid tiers run on the monthly allowance.
  const isLifetime = tier === 'free';
  if (isLifetime && isComic) return { mode: 'standard' };

  // (3) Quota gate — checked BEFORE OpenRouter so we never burn $ on an over-limit user.
  // Free → no-expiry lifetime key; paid → current-month key. Referral bonus credits raise
  // the EFFECTIVE limit (base + bonus) so a rewarded free user can make extra Star-Yourself
  // posters; the returned `limit` carries the effective value through to credit consumption.
  //
  // An exhausted PERSONAL quota degrades to a faceless image (mirrors the comic track's
  // rule 2 above) instead of rejecting the whole request — the Star Yourself toggle is now
  // sticky/defaulted-on (see hooks/useCharacter.js), so without this a free user with zero
  // credits left would get a hard error on every single poster attempt instead of just
  // losing the face. `code` distinguishes the one-time free lifetime grant (never refreshes)
  // from the paid monthly allowance (does refresh) so the client shows an accurate message.
  const usageKey = isLifetime ? lifetimeKey(identifier) : monthKey(identifier);
  const effectiveLimit = limit + await identityBonus(identifier);

  // Both the personal credit and the global daily budget slot are RESERVED atomically (INCR first, compare
  // after, DECR on refusal) — never read-then-consume-later, which let parallel requests all pass the check
  // and each spend a paid generation. The caller hands the reservation back with gate.release() whenever the
  // identity provider did not actually apply the face.
  let creditReserved = false;
  if (effectiveLimit !== Infinity) {
    try {
      const pipe = redis.pipeline();
      pipe.incr(usageKey);
      if (!isLifetime) pipe.expireat(usageKey, nextMonthStartUTC()); // monthly reset (lifetime: never)
      const out = await pipe.exec();
      const used = parseInt(Array.isArray(out) ? out[0] : NaN, 10);
      if (!Number.isFinite(used)) throw new Error('identity counter returned no value');
      if (used > effectiveLimit) {
        await redis.decr(usageKey).catch(() => {});
        // An exhausted PERSONAL quota degrades to a faceless image (the toggle is sticky, so a hard error on
        // every poster would be hostile). `code` says WHY: one-time free grant vs. paid monthly allowance.
        return { mode: 'standard', identityDegraded: true, code: isLifetime ? CODES.IDENTITY_LIFETIME_USED : CODES.QUOTA_IDENTITY };
      }
      creditReserved = true;
    } catch (e) {
      // FAIL-CLOSED — identity is a per-call paid feature, so this deliberately diverges from the app-wide
      // fail-OPEN convention: if the quota cannot be verified, do not spend. Degrade to the faceless cascade.
      console.warn(`⚠️ Identity quota unverifiable (Redis down) — degrading to faceless: ${e.message}`);
      return { mode: 'standard' };
    }
  }
  const releaseCredit = async () => {
    if (!creditReserved) return;
    creditReserved = false;
    await redis.decr(usageKey).catch(() => {});
  };

  // Global daily budget kill-switch — caps AGGREGATE identity spend across ALL users. Reserved atomically
  // for metered users; unmetered tiers (limit = Infinity: admin) are only checked, as before.
  let budgetReserved = false;
  if (effectiveLimit !== Infinity) {
    try {
      const b = await reserveIdentityBudget();
      if (!b.ok) {
        await releaseCredit();
        // Reported once per day by lib/budget.js. The request still succeeds (faceless), but the client is TOLD
        // why (identityDegraded + code) instead of silently getting a different image.
        return { mode: 'standard', identityDegraded: true, code: CODES.IDENTITY_BUDGET_REACHED };
      }
      budgetReserved = true;
    } catch (e) {
      await releaseCredit();
      console.warn(`⚠️ Identity budget unverifiable (Redis down) — degrading to faceless: ${e.message}`);
      return { mode: 'standard' };
    }
  } else if (await identityBudgetReached()) {
    return { mode: 'standard', identityDegraded: true, code: CODES.IDENTITY_BUDGET_REACHED };
  }

  const release = async () => {
    await releaseCredit();
    if (budgetReserved) { budgetReserved = false; await releaseIdentityBudget(); }
  };

  return { mode: 'identity', usageKey, limit: effectiveLimit, isLifetime, release };
}
