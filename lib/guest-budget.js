/**
 * Global DAILY budget for guest (anonymous) script generation — all guests together, per UTC day.
 *
 * The per-IP limit (TIER_LIMITS.anonymous.script) cannot bound the aggregate: guests are identified
 * by IP only, and many IPs = many allowances. This caps the sum (config/limits.js GUEST_SCRIPT_BUDGET,
 * env GUEST_SCRIPTS_PER_DAY, 0 = no cap). Signed-in users never touch this counter.
 *
 * Reserved atomically (INCR then compare, DECR on refusal / failed generation). Redis trouble fails
 * OPEN, like the other quotas. First refusal of the day is logged once + sent to Telegram once
 * (lib/budget-alerts.js, same mechanism as DAILY_IMAGE_BUDGET / DAILY_IDENTITY_BUDGET).
 */
import redis from './redis.js';
import { nextMidnightUTC } from './api-utils.js';
import { reportBudgetReached } from './budget-alerts.js';
import { GUEST_SCRIPT_BUDGET } from '../config/limits.js';

export const GUEST_BUDGET_NAME = 'DAILY_GUEST_SCRIPT_BUDGET';

export function guestScriptBudgetKey(now = new Date()) {
  return `usage:guest-script-global:${now.toISOString().split('T')[0]}`;
}

/**
 *   { ok: true, reserved: false }   no cap configured
 *   { ok: true, reserved: true }    slot taken (give it back with releaseGuestScriptBudget on failure)
 *   { ok: false, resetsAt }         budget used up for today
 *   throws                          Redis unavailable (the route fails open)
 */
export async function reserveGuestScriptBudget() {
  const max = GUEST_SCRIPT_BUDGET.perDay;
  if (!Number.isFinite(max) || max <= 0) return { ok: true, reserved: false };
  const key = guestScriptBudgetKey();
  const pipe = redis.pipeline();
  pipe.incr(key);
  pipe.expireat(key, nextMidnightUTC());
  const results = await pipe.exec();
  const used = parseInt(Array.isArray(results) ? results[0] : NaN, 10);
  if (!Number.isFinite(used)) throw new Error('guest budget counter returned no value');
  if (used > max) {
    await redis.decr(key).catch(() => {});
    await reportBudgetReached(GUEST_BUDGET_NAME, max, max); // once per day, never throws
    return { ok: false, resetsAt: new Date(nextMidnightUTC() * 1000).toISOString() };
  }
  return { ok: true, reserved: true };
}

/** Give a slot back (no script was produced). Never throws. */
export async function releaseGuestScriptBudget() {
  try { await redis.decr(guestScriptBudgetKey()); }
  catch (e) { console.warn(`⚠️ Guest script budget release skipped (Redis): ${e.message}`); }
}
