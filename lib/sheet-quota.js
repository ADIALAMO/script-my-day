/**
 * Per-user quota for character-sheet uploads (pages/api/upload-character.js).
 *
 * Each upload triggers a PAID image generation, so it is counted at the moment of the paid call
 * — atomically (INCR first, compare after), never read-then-write. Key: usage:sheet:<id>:<YYYY-MM>
 * (month-stamped, so it resets on the 1st by construction; the TTL is only garbage collection and is
 * deliberately a little over a month). The limits (Free / Pro separately) live in config/limits.js.
 */
import redis from './redis.js';
import { nextMonthStartUTC } from './api-utils.js';
import { SHEET_LIMITS } from '../config/limits.js';

export function sheetLimitFor(tier) {
  return SHEET_LIMITS[tier] ?? SHEET_LIMITS.anonymous;
}

// Key lifetime: until 3 days past the end of the month (slightly over a month from the first use).
const TTL_GRACE_SEC = 3 * 24 * 60 * 60;

export function sheetKey(identifier, now = new Date()) {
  return `usage:sheet:${identifier}:${now.toISOString().slice(0, 7)}`; // YYYY-MM (UTC)
}

/** First instant of the next UTC month, as an ISO string — when the quota resets. */
export function sheetResetsAt(now = new Date()) {
  return new Date(nextMonthStartUTC() * 1000).toISOString();
}

/**
 * Reserve one upload for `identifier`.
 *   { ok: true, key }                  → reserved (call releaseSheetQuota(key) if the paid call fails)
 *   { ok: false, limit, resetsAt }     → monthly limit reached (the slot is returned)
 *   throws                             → Redis unavailable; caller must fail CLOSED (paid feature)
 */
export async function reserveSheetQuota(tier, identifier) {
  const limit = sheetLimitFor(tier);
  if (limit === Infinity) return { ok: true, key: null };
  if (limit === 0) return { ok: false, limit: 0, resetsAt: sheetResetsAt() };
  const key = sheetKey(identifier);
  const pipe = redis.pipeline();
  pipe.incr(key);
  pipe.expireat(key, nextMonthStartUTC() + TTL_GRACE_SEC);
  const results = await pipe.exec();
  const used = parseInt(Array.isArray(results) ? results[0] : NaN, 10);
  if (!Number.isFinite(used)) throw new Error('sheet counter returned no value');
  if (used > limit) {
    await redis.decr(key).catch(() => {});
    return { ok: false, limit, resetsAt: sheetResetsAt() };
  }
  return { ok: true, key };
}

/** Give a reserved upload back (the paid generation failed). Never throws. */
export async function releaseSheetQuota(key) {
  if (!key) return;
  try { await redis.decr(key); }
  catch (e) { console.warn(`⚠️ Sheet quota release skipped (Redis): ${e.message}`); }
}
