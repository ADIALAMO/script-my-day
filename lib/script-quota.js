/**
 * Script quotas (pages/api/generate-script.js).
 *
 *   daily   — every tier (config/limits.js TIER_LIMITS.<tier>.script): usage:script:<id>:<YYYY-MM-DD>, resets at 00:00 UTC
 *   monthly — Pro only (SCRIPT_MONTHLY_LIMITS.pro, default 150, on top of the daily 20): usage:script-month:<id>:<YYYY-MM>,
 *             resets on the 1st (UTC); the key outlives the month by a few days (garbage collection only)
 *
 * Reserved ATOMICALLY (INCR first, compare after, DECR on refusal); a refusal by the monthly cap also returns the
 * daily slot. Both are given back by releaseScriptQuota() when no script is produced.
 */
import redis from './redis.js';
import { nextMidnightUTC, nextMonthStartUTC } from './api-utils.js';
import { limitFor } from './quota.js';
import { SCRIPT_MONTHLY_LIMITS } from '../config/limits.js';

const TTL_GRACE_SEC = 3 * 24 * 60 * 60;

export function scriptQuotaKey(identifier, now = new Date()) {
  return `usage:script:${identifier}:${now.toISOString().split('T')[0]}`;
}
export function scriptMonthKey(identifier, now = new Date()) {
  return `usage:script-month:${identifier}:${now.toISOString().slice(0, 7)}`;
}
export function scriptMonthlyLimit(tier) {
  return SCRIPT_MONTHLY_LIMITS[tier] ?? Infinity;
}

async function incr(key, expireAt) {
  const pipe = redis.pipeline();
  pipe.incr(key);
  pipe.expireat(key, expireAt);
  const results = await pipe.exec();
  const n = parseInt(Array.isArray(results) ? results[0] : NaN, 10);
  if (!Number.isFinite(n)) throw new Error('script counter returned no value');
  return n;
}

/**
 *   { ok: true, key, monthKey }                         reserved (keys null when unlimited)
 *   { ok: false, scope: 'day'|'month', limit, resetsAt } refused (slots returned)
 *   throws                                              Redis unavailable (the route fails open, like before)
 */
export async function reserveScriptQuota(tier, identifier) {
  const limit = limitFor(tier, 'script');
  if (limit === Infinity) return { ok: true, key: null, monthKey: null, limit };

  const key = scriptQuotaKey(identifier);
  const used = await incr(key, nextMidnightUTC());
  if (used > limit) {
    await redis.decr(key).catch(() => {});
    return { ok: false, scope: 'day', limit, resetsAt: new Date(nextMidnightUTC() * 1000).toISOString() };
  }

  const monthlyLimit = scriptMonthlyLimit(tier);
  if (monthlyLimit === Infinity) return { ok: true, key, monthKey: null, limit };

  const monthKey = scriptMonthKey(identifier);
  try {
    const m = await incr(monthKey, nextMonthStartUTC() + TTL_GRACE_SEC);
    if (m > monthlyLimit) {
      await redis.decr(monthKey).catch(() => {});
      await redis.decr(key).catch(() => {});                       // the day slot was not used either
      return { ok: false, scope: 'month', limit: monthlyLimit, resetsAt: new Date(nextMonthStartUTC() * 1000).toISOString() };
    }
  } catch (e) {
    await redis.decr(key).catch(() => {});
    throw e;
  }
  return { ok: true, key, monthKey, limit };
}

/** Give a reservation back (no script was produced). Accepts the reservation object or a bare key. Never throws. */
export async function releaseScriptQuota(reservation) {
  const keys = typeof reservation === 'string' ? [reservation] : [reservation?.key, reservation?.monthKey];
  for (const k of keys.filter(Boolean)) {
    try { await redis.decr(k); }
    catch (e) { console.warn(`⚠️ Script quota release skipped (Redis): ${e.message}`); }
  }
}
