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
import { nextMonthStartUTC } from './api-utils.js';
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
export async function resolveIdentityGate(req, res, { isAdmin, characterImageUrl }) {
  const hasFace = validFaceUrl(characterImageUrl);

  if (isAdmin) {
    return hasFace ? { mode: 'identity', usageKey: null, limit: Infinity } : { mode: 'standard' };
  }
  if (!hasFace) return { mode: 'standard' };

  const { tier, identifier } = await getSessionAndTier(req, res);
  const limit = limitFor(tier, 'identity');

  // (1) Tier gate — identity is paid-only (anonymous/free limit = 0).
  if (limit === 0) return { mode: 'reject', status: 403, code: CODES.NEEDS_PRO };

  // (2) Monthly quota gate — checked BEFORE OpenRouter so we never burn $ on an over-limit user.
  const usageKey = monthKey(identifier);
  try {
    const used = parseInt(await redis.get(usageKey), 10) || 0;
    if (limit !== Infinity && used >= limit) {
      return { mode: 'reject', status: 429, code: CODES.QUOTA_IDENTITY };
    }
  } catch (e) {
    console.warn(`⚠️ Identity quota check skipped (Redis down): ${e.message}`);
  }
  return { mode: 'identity', usageKey, limit };
}

/** Consume one identity credit — call ONLY after a real identity success (faceApplied). */
export async function consumeIdentityCredit(usageKey, limit) {
  if (!usageKey || limit === Infinity) return;
  try {
    const pipe = redis.pipeline();
    pipe.incr(usageKey);
    pipe.expireat(usageKey, nextMonthStartUTC()); // monthly reset
    await pipe.exec();
  } catch (e) {
    console.warn(`⚠️ Identity quota increment skipped (Redis down): ${e.message}`);
  }
}
