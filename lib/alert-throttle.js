/**
 * Generic "at most one Telegram alert per key per window" helper.
 *
 * Same safety pattern as lib/auth-alerts.js (which is intentionally left untouched):
 *   • production only — never alerts from dev/test;
 *   • one slot per key per window via Redis SET NX EX, capped at ~500ms; if Redis is down,
 *     slow or unconfigured it falls back to one alert per key per window PER INSTANCE;
 *   • the whole thing is bounded to ~1.5s and NEVER throws, so it can't hold up or break a
 *     response.
 *
 * `text` is sent as-is through sendTelegram (Markdown): callers must pass fixed text or
 * escape anything dynamic with escapeMarkdownV1. Never put request data or secrets in it.
 */
import redis from './redis.js';
import { sendTelegram } from './telegram.js';

const DEFAULT_WINDOW_SEC = 30 * 60;
const WAIT_BUDGET_MS     = 1500;
const REDIS_BUDGET_MS    = 500;

const lastSentByKey = new Map(); // Redis-unavailable fallback (per process instance)

async function claimSlot(key, windowSec) {
  try {
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('redis timeout')), REDIS_BUDGET_MS); });
    try {
      const res = await Promise.race([redis.set(`alert:${key}`, '1', { nx: true, ex: windowSec }), timeout]);
      return res !== null && res !== undefined; // NX that lost the race returns null
    } finally { clearTimeout(timer); }
  } catch {
    const now = Date.now();
    if (now - (lastSentByKey.get(key) || 0) < windowSec * 1000) return false;
    lastSentByKey.set(key, now);
    return true;
  }
}

async function sendOnce(key, text, windowSec) {
  if (process.env.NODE_ENV !== 'production') return;
  if (!(await claimSlot(key, windowSec))) return;
  await sendTelegram(text);
}

/** Sends `text` unless an alert for `key` already went out within the window. Never throws. */
export async function alertOnce(key, text, { windowSec = DEFAULT_WINDOW_SEC } = {}) {
  let timer;
  try {
    await Promise.race([
      sendOnce(key, text, windowSec),
      new Promise((resolve) => { timer = setTimeout(resolve, WAIT_BUDGET_MS); }),
    ]);
  } catch {
    /* alerting must never affect the caller */
  } finally {
    clearTimeout(timer);
  }
}
