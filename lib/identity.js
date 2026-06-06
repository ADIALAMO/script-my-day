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

// ─── Global daily spend kill-switch ──────────────────────────────────────────────
// Per-user quota protects against a single abuser; it does NOT cap AGGREGATE spend.
// A traffic spike, a viral moment, or a burst of fresh free signups could still drain
// the prepaid OpenRouter balance in one day and take the whole app offline. DAILY_IDENTITY_BUDGET
// (USD) sets a hard ceiling on TOTAL identity spend per UTC day: once reached, every identity
// request degrades to the faceless cascade — the app stays up, just without faces — until the
// counter resets at midnight UTC. Unset / non-positive budget → no cap (protection is opt-in).
const IDENTITY_MAX_COST_USD = 0.06; // worst-case per call (Grok); Gemini is cheaper, so pricing
                                    // every call at the max makes the dollar ceiling a TRUE
                                    // upper bound on real spend (we can only undershoot it).

// Global counter is keyed per UTC calendar day, matching the daily-quota convention.
function globalIdentityKey() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD (UTC)
  return `usage:identity:global:${today}`;
}

/**
 * True when today's aggregate identity spend has hit the configured DAILY_IDENTITY_BUDGET.
 * FAIL-CLOSED on a Redis outage (returns true): a transient blip must never open the spend
 * floodgates — we'd rather serve a faceless image than risk draining the prepaid balance.
 */
export async function identityBudgetReached() {
  const budget = parseFloat(process.env.DAILY_IDENTITY_BUDGET);
  if (!Number.isFinite(budget) || budget <= 0) return false; // no budget configured → no cap
  const maxCalls = Math.floor(budget / IDENTITY_MAX_COST_USD);
  try {
    const used = parseInt(await redis.get(globalIdentityKey()), 10) || 0;
    return used >= maxCalls;
  } catch (e) {
    console.warn(`⚠️ Global identity budget unverifiable (Redis down) — failing closed: ${e.message}`);
    return true;
  }
}

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
    return used >= limit;
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
 *   { mode: 'identity', usageKey, limit }   → run identity provider; consume on success
 *   { mode: 'standard' }                    → no/invalid face → normal generation (not an error)
 *   { mode: 'reject', status, code }        → blocked (not paid / monthly quota hit)
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
  // Free → no-expiry lifetime key; paid → current-month key.
  const usageKey = isLifetime ? lifetimeKey(identifier) : monthKey(identifier);
  try {
    const used = parseInt(await redis.get(usageKey), 10) || 0;
    if (limit !== Infinity && used >= limit) {
      return { mode: 'reject', status: 429, code: CODES.QUOTA_IDENTITY };
    }
  } catch (e) {
    // FAIL-CLOSED — identity is the ONLY per-call paid feature, so this deliberately diverges
    // from the app-wide fail-OPEN convention: if we cannot verify the user's remaining quota we
    // must NOT spend money. Degrade to the faceless cascade — the user still gets an image,
    // just without their face — rather than risk an unbounded paid call during a Redis outage.
    console.warn(`⚠️ Identity quota unverifiable (Redis down) — degrading to faceless: ${e.message}`);
    return { mode: 'standard' };
  }

  // (4) Global daily budget kill-switch — caps AGGREGATE identity spend across ALL users so a
  // spike / abuse burst cannot drain the prepaid AI balance and take the app down. Checked
  // after the per-user gate (paying users are counted against their own quota first); on a hit
  // we degrade to faceless to keep the rest of the app alive instead of erroring.
  if (await identityBudgetReached()) {
    console.warn('🛑 Global daily identity budget reached — degrading to faceless cascade.');
    return { mode: 'standard' };
  }

  return { mode: 'identity', usageKey, limit, isLifetime };
}

/**
 * Consume one identity credit — call ONLY after a real identity success (faceApplied).
 * Monthly keys get an expireat so they reset; lifetime keys (free taste) are left
 * WITHOUT expiry so the one-time allowance never comes back.
 */
export async function consumeIdentityCredit(usageKey, limit, { isLifetime = false } = {}) {
  if (!usageKey || limit === Infinity) return;
  try {
    const pipe = redis.pipeline();
    pipe.incr(usageKey);
    if (!isLifetime) pipe.expireat(usageKey, nextMonthStartUTC()); // monthly reset (lifetime: never)
    // Always bump the GLOBAL daily spend counter that powers identityBudgetReached(), with a
    // midnight-UTC expiry so the budget refreshes each day. Every real identity success costs
    // money regardless of tier, so all of them must count toward the daily ceiling.
    const gKey = globalIdentityKey();
    pipe.incr(gKey);
    pipe.expireat(gKey, nextMidnightUTC());
    await pipe.exec();
  } catch (e) {
    console.warn(`⚠️ Identity quota increment skipped (Redis down): ${e.message}`);
  }
}
