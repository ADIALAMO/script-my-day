/**
 * OpenRouter CREDIT exhaustion (HTTP 402) — one place that counts it, announces it and notices the recovery.
 *
 * Every paid and free OpenRouter call uses the same account balance, so when it runs out ALL of them fail with 402 at once. A 402 is not a
 * transient error: retrying cannot help until the owner adds credit. This module gives the three paths that need to know (circuit breaker,
 * routes, tests) one definition:
 *   • isCreditStatus(status)      402 only (401/429/5xx/timeouts are NOT credit failures). A 403 counts only as a KEY-LIMIT body: creditStatus() maps it to 402 at the call site
 *   • noteCreditFailure(source)   per-UTC-day counter `stats:credit402:<day>:<path>` (a number, never text/keys), the `credit:outage` flag, and ONE Telegram
 *                                 alert per 30 min for the whole account (lib/alert-throttle.js, production only, never throws)
 *   • noteCreditRecovery()        called after a PAID OpenRouter call succeeded; if the outage flag was set, announces the recovery once (and re-arms the
 *                                 failure alert if the outage lasted >= 10 min)
 * `source` is a circuit name (lib/circuit-breaker.js) or one of the route labels below. Alert text is fixed: no ids, no balances, no provider bodies.
 */
import redis from './redis.js';
import { alertOnce, resetAlert } from './alert-throttle.js';
import { nextMidnightUTC } from './api-utils.js';

export const isCreditStatus = (status) => status === 402;

/**
 * A per-API-key limit ("Key limit exceeded", HTTP 403 with error.metadata.scope "key_limit" / limit_source "openrouter_key_limit") is the same outage as an
 * exhausted account balance for the app: the key can no longer pay for anything. ONLY that exact body counts — every other 403 (bad key, no access, an
 * unparseable or unrelated body) keeps its own handling. `body` is a parsed object or text (a text that is cut off mid-JSON falls back to a marker match).
 */
export function isKeyLimitBody(body) {
  if (body === null || body === undefined) return false;
  if (typeof body === 'object') { const m = body?.error?.metadata; return m?.scope === 'key_limit' || m?.limit_source === 'openrouter_key_limit'; }
  if (typeof body !== 'string') return false;
  try {
    const m = JSON.parse(body)?.error?.metadata;
    return m?.scope === 'key_limit' || m?.limit_source === 'openrouter_key_limit';
  } catch {
    return /"scope"\s*:\s*"key_limit"|"limit_source"\s*:\s*"openrouter_key_limit"/.test(body);
  }
}

/** The status the rest of the app should act on: a key-limit 403 becomes 402 (the credit path); every other status is returned unchanged. */
export function creditStatus(status, body) {
  if (status !== 403 || !isKeyLimitBody(body)) return status;
  console.warn('🔑 OpenRouter API-key limit reached (HTTP 403, scope key_limit) — handled as a credit failure (402)');
  return 402;
}

/** Reads (at most 2 KB of) an error body, only for the 403 case that needs it; gives up after 2 s (the caller's request timeout may already be cleared). Never throws. */
export async function readErrorBody(res) {
  let timer;
  try {
    const text = await Promise.race([res.text(), new Promise((resolve) => { timer = setTimeout(() => resolve(''), 2000); })]);
    return String(text).slice(0, 2000);
  } catch { return ''; } finally { clearTimeout(timer); }
}

/**
 * The thrown "<Name> <status>: <body slice>" message of a provider call (lib/circuit-breaker.js extractStatusCode parses the status). A key-limit 403 is thrown
 * as 402 with a FIXED text — the "(key limit)" marker keeps the real cause visible in logs, and the body (which names the key's management URL) is not repeated.
 */
export function providerErrorMessage(name, status, bodyText) {
  const st = creditStatus(status, bodyText);
  return st !== status ? `${name} ${st}: (key limit) API key limit exceeded` : `${name} ${status}: ${String(bodyText).substring(0, 150)}`;
}

/** source (circuit name or route label) -> path slug used in the counter key and in the alert */
const SLUG = {
  script_paid: 'script', script: 'script',
  storyboard_gemini: 'storyboard', storyboard: 'storyboard',
  openrouter: 'poster-image',
  grok_identity: 'star-yourself-image', gemini_identity: 'star-yourself-image',
  check_nemotron: 'image-check', check_gemini: 'image-check', check_imgsafety: 'image-check',
  check_text: 'text-check',
  check_minor: 'photo-check',
  'character-sheet': 'character-sheet',
};
const SLUGS = [...new Set(Object.values(SLUG)), 'other'];

const OUTAGE_FLAG = 'credit:outage';
const OUTAGE_FLAG_TTL_SEC = 6 * 60 * 60;
const ALERT_KEY = 'credit-402';
const ALERT_WINDOW_SEC = 30 * 60;
const REARM_AFTER_MS = 10 * 60 * 1000;   // an outage shorter than this does not re-arm the failure alert
const COUNTER_TTL_SEC = 7 * 24 * 60 * 60;

const utcDay = () => new Date().toISOString().split('T')[0];
const counterKey = (slug) => `stats:credit402:${utcDay()}:${slug}`;

export async function noteCreditFailure(source) {
  const slug = SLUG[source] ?? 'other';
  let count = null;
  try {
    const key = counterKey(slug);
    const pipe = redis.pipeline();
    pipe.incr(key);
    pipe.expireat(key, nextMidnightUTC() + COUNTER_TTL_SEC);
    pipe.set(OUTAGE_FLAG, String(Date.now()), { ex: OUTAGE_FLAG_TTL_SEC, nx: true });   // value = when the outage began (kept by NX)
    const out = await pipe.exec();
    count = Number(out?.[0]) || null;
  } catch (e) {
    console.warn(`⚠️ credit-failure counter skipped (Redis): ${e.message}`);
  }
  console.warn(`💳 OpenRouter credit failure (HTTP 402) — path: ${slug}`);
  await alertOnce(ALERT_KEY,
    `🚨 *LIFESCRIPT*: OpenRouter credit (or an API-key limit) looks *exhausted* — first seen on: ${slug.replace(/-/g, ' ')}${count ? ` (${count} today)` : ''}. ` +
    'Generation is failing for every user until credit is added; they see "temporarily unavailable". Top up the account or raise the key limit at openrouter.ai.',
    { windowSec: ALERT_WINDOW_SEC });
}

/** Call after a PAID OpenRouter call succeeded. Cheap no-op unless an outage flag exists; never throws. */
export async function noteCreditRecovery() {
  try {
    const since = await redis.getdel(OUTAGE_FLAG);
    if (since === null || since === undefined) return;
    // A NEW outage must be announced again, not swallowed by the old window — but only after a REAL outage: a request-dependent 402 (one oversized request)
    // that is followed by successes must not make the alert flap.
    if (Date.now() - Number(since) >= REARM_AFTER_MS) await resetAlert(ALERT_KEY);
    let total = 0;
    try { total = (await redis.mget(...SLUGS.map(counterKey))).reduce((a, v) => a + (Number(v) || 0), 0); } catch { /* the number is a nicety */ }
    await alertOnce('credit-recovered',
      `✅ *LIFESCRIPT*: OpenRouter calls are succeeding again${total ? ` (${total} credit failures today)` : ''}. Generation is back.`,
      { windowSec: 10 * 60 });
  } catch { /* alerting must never affect the caller */ }
}
