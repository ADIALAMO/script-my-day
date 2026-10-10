/**
 * "A spend budget was reached" visibility — once per UTC day per budget, never per request.
 *
 *   • one log line (so Vercel logs show WHEN it tripped and at what count)
 *   • one Telegram message through the project's existing alert channel (lib/alert-throttle.js →
 *     lib/telegram.js; production only, bounded, never throws)
 *
 * Contains the budget name, the current count and the limit — no user data. Both budgets are
 * counted in provider CALLS (the dollar ceiling is divided by the per-call cost).
 */
import redis from './redis.js';
import { alertOnce } from './alert-throttle.js';
import { escapeMarkdownV1 } from './telegram.js';

const DAY_SEC = 25 * 60 * 60;
const loggedInThisInstance = new Set(); // cheap short-circuit + fallback when Redis is unavailable

const dayStamp = () => new Date().toISOString().split('T')[0];

/**
 * @param {'DAILY_IMAGE_BUDGET'|'DAILY_IDENTITY_BUDGET'|'DAILY_GUEST_SCRIPT_BUDGET'} budget
 * @param {number} used   calls counted so far today
 * @param {number} max    calls allowed today
 */
export async function reportBudgetReached(budget, used, max) {
  try {
    const day = dayStamp();
    const memKey = `${budget}:${day}`;
    if (loggedInThisInstance.has(memKey)) return; // already reported by this instance today
    loggedInThisInstance.add(memKey);
    if (loggedInThisInstance.size > 20) loggedInThisInstance.clear();

    // Claim the day across ALL serverless instances (SET NX). If Redis is down we still log once
    // per instance — a duplicate is better than silence.
    let claimed = true;
    try {
      const res = await redis.set(`alert:budget-log:${budget}:${day}`, '1', { nx: true, ex: DAY_SEC });
      claimed = res !== null && res !== undefined;
    } catch { /* keep claimed = true */ }
    if (!claimed) return;

    console.warn(`🛑 BUDGET REACHED: ${budget} ${used}/${max} calls (UTC ${day}) — feature degraded until midnight UTC.`);
    await alertOnce(
      `budget:${budget}:${day}`,
      `🛑 *Budget reached:* ${escapeMarkdownV1(budget)}\n` +
      `Count: ${Number(used)} / limit: ${Number(max)} calls (UTC ${day}).\n` +
      `The feature is degraded or paused until midnight UTC.`,
      { windowSec: DAY_SEC },
    );
  } catch { /* visibility must never affect the request */ }
}

/** Test helper. */
export function _resetBudgetAlertMemory() { loggedInThisInstance.clear(); }
