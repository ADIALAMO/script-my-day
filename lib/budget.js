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

// ─── Global daily spend caps for the PAID checks (Gemini 2.5 Flash-Lite via OpenRouter) ─────────────────────────────────────
// Four INDEPENDENT budgets, so exhausting one can never switch off another:
//   image  DAILY_CHECK_BUDGET (default $0.50)        the output-image fallback checker (lib/image-check.js)      key usage:check:paid:global:<day>
//   text   DAILY_TEXT_CHECK_BUDGET (default $0.30)   the generated-text classifier (lib/text-check.js)           key usage:check:text:global:<day>
//   minor  DAILY_MINOR_CHECK_BUDGET (default $0.20)  the apparent-minor screen (lib/minor-screen.js)             key usage:check:minor:global:<day>
//   imgsafety DAILY_IMAGE_SAFETY_BUDGET (default $0.50) the second-opinion image check after Nemotron says safe (lib/image-check.js)   key usage:check:imgsafety:global:<day>
// Each is a USD ceiling per UTC day divided by an upper-bound price per call (CHECK_COST_USD / TEXT_CHECK_COST_USD / MINOR_CHECK_COST_USD) = max calls.
// Unlike the opt-in budgets above they have DEFAULTS (brand-new paid paths); a value of 0 switches that check's paid call off entirely.
// DAILY_CHECK_BUDGET keeps its original meaning (the image one) so existing deployments are unaffected.
// Price basis (OpenRouter endpoints API for google/gemini-2.5-flash-lite, fetched 2026-10-12): $0.10 / 1M prompt AND image tokens, $0.40 / 1M output.
//   image / minor: a 1024px image ≈ 1,032 tokens + ~80 prompt in, ~10 out ≈ $0.00012 → 0.00015 upper bound.
//   text: a script is ~2,500 tokens in (≈ $0.00026), a storyboard ~700 (≈ $0.00007), the classifier answers in ~6 tokens → 0.0004 upper bound per call.
export const CHECK_COST_USD = parseFloat(process.env.CHECK_COST_USD) || 0.00015;

const CHECK_BUDGETS = {
  image: { env: 'DAILY_CHECK_BUDGET',       dflt: 0.5, costEnv: 'CHECK_COST_USD',       cost: 0.00015, key: 'usage:check:paid:global' },
  text:  { env: 'DAILY_TEXT_CHECK_BUDGET',  dflt: 0.3, costEnv: 'TEXT_CHECK_COST_USD',  cost: 0.0004,  key: 'usage:check:text:global' },
  minor: { env: 'DAILY_MINOR_CHECK_BUDGET', dflt: 0.2, costEnv: 'MINOR_CHECK_COST_USD', cost: 0.00015, key: 'usage:check:minor:global' },
  imgsafety: { env: 'DAILY_IMAGE_SAFETY_BUDGET', dflt: 0.5, costEnv: 'IMAGE_SAFETY_COST_USD', cost: 0.00015, key: 'usage:check:imgsafety:global' },
};
const cfg = (purpose) => CHECK_BUDGETS[purpose] ?? CHECK_BUDGETS.image;

export function checkBudgetUsd(purpose = 'image') {
  const c = cfg(purpose);
  const raw = process.env[c.env];
  if (raw === undefined || String(raw).trim() === '') return c.dflt;
  const v = parseFloat(raw);
  return Number.isFinite(v) && v >= 0 ? v : c.dflt;
}
const checkCostUsd = (purpose) => { const c = cfg(purpose); return parseFloat(process.env[c.costEnv]) || c.cost; };
// (+1e-9: 0.30 / 0.0004 is 749.999… in floating point; the cap must be the round number a human expects)
export const checkMaxCalls = (purpose = 'image') => Math.floor(checkBudgetUsd(purpose) / checkCostUsd(purpose) + 1e-9);

export function globalCheckKey(purpose = 'image') {
  return `${cfg(purpose).key}:${new Date().toISOString().split('T')[0]}`;
}

/**
 * Atomically reserve one paid check of `purpose` (INCR then compare, like reserveIdentityBudget). { ok:false } when THAT purpose's day cap is
 * spent (the other two are untouched); THROWS on a Redis failure — the caller fails CLOSED (no paid call without a verified budget).
 */
export async function reserveCheckBudget(purpose = 'image') {
  const key = globalCheckKey(purpose);
  const maxCalls = checkMaxCalls(purpose);
  if (maxCalls <= 0) return { ok: false, used: 0, max: 0 };
  const pipe = redis.pipeline();
  pipe.incr(key);
  pipe.expireat(key, nextMidnightUTC());
  const results = await pipe.exec();
  const used = parseInt(Array.isArray(results) ? results[0] : NaN, 10);
  if (!Number.isFinite(used)) throw new Error('check budget counter returned no value');
  if (used > maxCalls) {
    await redis.decr(key).catch(() => {});
    await reportBudgetReached(cfg(purpose).env, used - 1, maxCalls);
    return { ok: false, used: used - 1, max: maxCalls };
  }
  return { ok: true, used, max: maxCalls };
}

/** Give a reserved slot of `purpose` back (the paid call failed technically, so nothing was spent). Never throws. */
export async function releaseCheckBudget(purpose = 'image') {
  try { await redis.decr(globalCheckKey(purpose)); }
  catch (e) { console.warn(`⚠️ Check budget release skipped (Redis): ${e.message}`); }
}
