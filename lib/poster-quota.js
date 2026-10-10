/**
 * Standalone-poster quota (pages/api/generate-poster.js, non-comic requests).
 *
 * Reserved ATOMICALLY: INCR first, compare after, DECR on refusal or when no image is produced — the same
 * pattern as the script / comic / sheet quotas. (It used to be read-then-increment-after-success, so a burst of
 * parallel requests all passed the check and every one of them was served.)
 *
 * Anonymous posters are a LIFETIME allowance per IP, kept for GUEST_RETENTION.ipDays (default 90) and REFRESHED on every
 * use (a returning guest keeps the spent allowance; one silent for the whole period starts fresh — the IP is not stored
 * forever). Every other tier resets at midnight UTC.
 */
import redis from './redis.js';
import { nextMidnightUTC } from './api-utils.js';
import { limitFor } from './quota.js';
import { CODES } from './messages.js';
import { GUEST_RETENTION } from '../config/limits.js';

export function posterQuotaKey(tier, identifier, now = new Date()) {
  return tier === 'anonymous' ? `usage:poster:lifetime:${identifier}` : `usage:poster:${identifier}:${now.toISOString().split('T')[0]}`;
}

/**
 *   { ok: true, key }                  reserved (key null when unlimited)
 *   { ok: false, status, code }        refused (403 needs account / 429 quota); slot returned
 *   throws                             Redis unavailable → the route fails open, as before
 */
export async function reservePosterQuota(tier, identifier) {
  const limit = limitFor(tier, 'poster');
  if (limit === 0) return { ok: false, status: 403, code: CODES.NEEDS_ACCOUNT };
  if (limit === Infinity) return { ok: true, key: null };
  const key = posterQuotaKey(tier, identifier);
  const pipe = redis.pipeline();
  pipe.incr(key);
  if (tier === 'anonymous') pipe.expire(key, GUEST_RETENTION.ipDays * 86400); // refreshed on every attempt, refused ones included
  else pipe.expireat(key, nextMidnightUTC());
  const results = await pipe.exec();
  const used = parseInt(Array.isArray(results) ? results[0] : NaN, 10);
  if (!Number.isFinite(used)) throw new Error('poster counter returned no value');
  if (used > limit) {
    await redis.decr(key).catch(() => {});
    return { ok: false, status: 429, code: tier === 'anonymous' ? CODES.QUOTA_POSTER_GUEST : CODES.QUOTA_POSTER };
  }
  return { ok: true, key };
}

/** Give a reserved poster back (no image was produced). Never throws. */
export async function releasePosterQuota(key) {
  if (!key) return;
  try { await redis.decr(key); }
  catch (e) { console.warn(`⚠️ Poster quota release skipped (Redis): ${e.message}`); }
}
