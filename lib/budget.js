/**
 * Global DAILY identity spend budget (DAILY_IDENTITY_BUDGET, USD) — the counter + the checks.
 *
 * Lives here (re-exported from lib/identity.js, which used to own it) so it can be imported
 * without dragging in the whole auth stack, and so the character-sheet route can RESERVE budget
 * atomically instead of read-then-write.
 *
 * Per-user quota protects against a single heavy user; this caps AGGREGATE spend per UTC day. Once the
 * ceiling is hit every identity request degrades (poster/panel → faceless) or is refused
 * (character sheet) until midnight UTC. Unset / non-positive budget → no cap (opt-in).
 */
import redis from './redis.js';
import { nextMidnightUTC } from './api-utils.js';
import { reportBudgetReached } from './budget-alerts.js';

// Worst-case cost per identity call (Grok). Gemini is cheaper, so pricing every call at the max
// makes the dollar ceiling a TRUE upper bound on real spend (we can only undershoot it).
export const IDENTITY_MAX_COST_USD = 0.06;

// Global counter, keyed per UTC calendar day, matching the daily-quota convention.
export function globalIdentityKey() {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD (UTC)
  return `usage:identity:global:${today}`;
}

/** Max identity calls per day implied by DAILY_IDENTITY_BUDGET, or null when no cap is configured. */
export function identityMaxCalls() {
  const budget = parseFloat(process.env.DAILY_IDENTITY_BUDGET);
  if (!Number.isFinite(budget) || budget <= 0) return null;
  return Math.floor(budget / IDENTITY_MAX_COST_USD);
}

/**
 * True when today's aggregate identity spend has hit DAILY_IDENTITY_BUDGET.
 * FAIL-CLOSED on a Redis outage (returns true): a transient blip must never open the spend
 * floodgates — we'd rather serve a faceless image than risk draining the prepaid balance.
 */
export async function identityBudgetReached() {
  const maxCalls = identityMaxCalls();
  if (maxCalls === null) return false; // no budget configured → no cap
  try {
    const used = parseInt(await redis.get(globalIdentityKey()), 10) || 0;
    if (used >= maxCalls) {
      await reportBudgetReached('DAILY_IDENTITY_BUDGET', used, maxCalls); // once per day, never throws
      return true;
    }
    return false;
  } catch (e) {
    console.warn(`⚠️ Global identity budget unverifiable (Redis down) — failing closed: ${e.message}`);
    return true;
  }
}

/**
 * ATOMICALLY reserve one identity call against today's global budget, at the moment a paid
 * generation is about to run. INCR first, then compare: two concurrent requests can never both
 * take the last slot (the read-then-write race the poster path still has).
 *
 *   { ok: true }                    → slot reserved; call releaseIdentityBudget() if the paid
 *                                     call then fails (no cost was incurred)
 *   { ok: false, used, max }        → budget exhausted (the slot is returned); do NOT spend
 *   throws                          → Redis unavailable; the caller must fail CLOSED
 *
 * With no budget configured the counter is still incremented (so the admin dashboard sees the
 * spend) and the reservation always succeeds.
 */
export async function reserveIdentityBudget() {
  const key = globalIdentityKey();
  const maxCalls = identityMaxCalls();
  const pipe = redis.pipeline();
  pipe.incr(key);
  pipe.expireat(key, nextMidnightUTC());
  const results = await pipe.exec();
  const used = parseInt(Array.isArray(results) ? results[0] : NaN, 10);
  if (!Number.isFinite(used)) throw new Error('identity budget counter returned no value');
  if (maxCalls !== null && used > maxCalls) {
    await redis.decr(key).catch(() => {});
    await reportBudgetReached('DAILY_IDENTITY_BUDGET', used - 1, maxCalls);
    return { ok: false, used: used - 1, max: maxCalls };
  }
  return { ok: true, used, max: maxCalls };
}

/** Give a reserved slot back (the paid call failed, so nothing was spent). Never throws. */
export async function releaseIdentityBudget() {
  try { await redis.decr(globalIdentityKey()); }
  catch (e) { console.warn(`⚠️ Identity budget release skipped (Redis): ${e.message}`); }
}
