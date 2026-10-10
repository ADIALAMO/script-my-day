/**
 * Comic quota (owned by pages/api/generate-storyboard.js — see the quota skill).
 *
 * Free: COMIC.freePerMonth per UTC month; Pro: COMIC.proPerDay per UTC day AND COMIC.proPerMonth per UTC month
 * (config/limits.js).
 * The slot is RESERVED atomically (INCR first, compare after, give back on refusal/failure),
 * so concurrent requests can no longer all pass a read-then-write check.
 *
 * Also decides how many panels a given comic unlocks: Free's FIRST comic ever unlocks
 * COMIC.freeFirstComicPanels, later ones COMIC.freeLaterComicPanels.
 */
import redis from './redis.js';
import { nextMidnightUTC, nextMonthStartUTC } from './api-utils.js';
import { limitFor, comicPeriodFor } from './quota.js';
import { COMIC } from '../config/limits.js';

const TTL_GRACE_SEC = 3 * 24 * 60 * 60;

export function comicMonthKey(identifier, now = new Date()) {
  return `usage:comic-month:${identifier}:${now.toISOString().slice(0, 7)}`;
}
/** Pro only: monthly cap on top of the daily one (config/limits.js COMIC.proPerMonth). */
export function comicMonthlyLimit(tier) {
  return tier === 'pro' ? COMIC.proPerMonth : Infinity;
}

export function comicQuotaKey(tier, identifier, now = new Date()) {
  const iso = now.toISOString();
  const stamp = comicPeriodFor(tier) === 'month' ? iso.slice(0, 7) : iso.slice(0, 10); // YYYY-MM | YYYY-MM-DD
  return `usage:comic:${identifier}:${stamp}`;
}

function expiryFor(tier) {
  return comicPeriodFor(tier) === 'month' ? nextMonthStartUTC() : nextMidnightUTC();
}

/**
 * Reserve one comic.
 *   { ok: true, key, monthKey }       → reserved (keys are null when not applicable)
 *   { ok: false, period, limit }      → limit reached (slots returned); period 'day' | 'month' | 'pro-month'
 *   throws                            → Redis unavailable (the route fails open, like before)
 */
export async function reserveComicQuota(tier, identifier) {
  const limit = limitFor(tier, 'comic');
  const period = comicPeriodFor(tier);
  if (limit === Infinity) return { ok: true, key: null, period, limit };
  if (limit === 0) return { ok: false, period, limit: 0 };
  const key = comicQuotaKey(tier, identifier);
  const pipe = redis.pipeline();
  pipe.incr(key);
  pipe.expireat(key, expiryFor(tier));
  const results = await pipe.exec();
  const used = parseInt(Array.isArray(results) ? results[0] : NaN, 10);
  if (!Number.isFinite(used)) throw new Error('comic counter returned no value');
  if (used > limit) {
    await redis.decr(key).catch(() => {});
    return { ok: false, period, limit };
  }

  const monthlyLimit = comicMonthlyLimit(tier);
  if (monthlyLimit === Infinity) return { ok: true, key, monthKey: null, period, limit };
  const monthKey = comicMonthKey(identifier);
  try {
    const mp = redis.pipeline();
    mp.incr(monthKey);
    mp.expireat(monthKey, nextMonthStartUTC() + TTL_GRACE_SEC);
    const mr = await mp.exec();
    const m = parseInt(Array.isArray(mr) ? mr[0] : NaN, 10);
    if (!Number.isFinite(m)) throw new Error('comic month counter returned no value');
    if (m > monthlyLimit) {
      await redis.decr(monthKey).catch(() => {});
      await redis.decr(key).catch(() => {});            // the day slot was not used either
      return { ok: false, period: 'pro-month', limit: monthlyLimit, resetsAt: new Date(nextMonthStartUTC() * 1000).toISOString() };
    }
  } catch (e) {
    await redis.decr(key).catch(() => {});
    throw e;
  }
  return { ok: true, key, monthKey, period, limit };
}

/** Give a reserved comic back (generation failed). Accepts the reservation or a bare key. Never throws. */
export async function releaseComicQuota(reservation) {
  const keys = typeof reservation === 'string' ? [reservation] : [reservation?.key, reservation?.monthKey];
  for (const k of keys.filter(Boolean)) {
    try { await redis.decr(k); }
    catch (e) { console.warn(`⚠️ Comic quota release skipped (Redis): ${e.message}`); }
  }
}

/**
 * How many panels this comic unlocks. Call ONCE per successful storyboard.
 * Free: lifetime ordinal via INCR (no expiry) → 1st comic = first-comic value, else later value.
 * Redis trouble → the conservative (smaller) value.
 */
export async function unlockedPanelsForNewComic(tier, identifier) {
  const base = limitFor(tier, 'unlockedPanels');
  if (tier !== 'free') return base;
  try {
    const ordinal = parseInt(await redis.incr(`usage:comic:lifetime:${identifier}`), 10);
    return ordinal === 1 ? COMIC.freeFirstComicPanels : COMIC.freeLaterComicPanels;
  } catch (e) {
    console.warn(`⚠️ Comic ordinal unavailable (Redis) — using the later-comic panel count: ${e.message}`);
    return COMIC.freeLaterComicPanels;
  }
}
