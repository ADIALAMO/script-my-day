/**
 * Telegram alert when the magic-link email cannot be sent.
 *
 * Why: a revoked Gmail App Password (535 BadCredentials) made every magic link
 * fail silently for ~9 days; the only trace was a runtime-log line that expires
 * in about an hour. This pings the admin chat instead.
 *
 * Called from the sendVerificationRequest wrapper in lib/auth.js, on the failure
 * path only. It never throws, is bounded to ~1.5s so it can't hold up the
 * sign-in response, and never includes anything sensitive: only the nodemailer
 * error code, the SMTP response code, the Vercel environment and a short
 * message scrubbed of email addresses. No recipient, SMTP user, password, host,
 * command, error.response or stack — and no env values.
 */
import redis from './redis.js';
import { escapeMarkdownV1, sendTelegram } from './telegram.js';

const WINDOW_SEC     = 30 * 60;   // at most one alert per error code per window
const WAIT_BUDGET_MS = 1500;      // whole alert (Redis claim + Telegram) is bounded to this
const REDIS_BUDGET_MS = 500;      // Redis slower than this counts as "unavailable" (fail open)
const MAX_DETAIL     = 200;

// Redis-unavailable fallback: one alert per code per window, per process instance.
const lastSentByCode = new Map();

/**
 * Defence in depth: remove the configured SMTP user / password / host if a server (or a
 * proxy in between) ever echoes them back in an error message. Only the VALUES are
 * removed — nothing here prints or logs them.
 */
function redactConfiguredSecrets(text) {
  let out = text;
  for (const name of ['EMAIL_SERVER_PASSWORD', 'EMAIL_SERVER_USER', 'EMAIL_SERVER_HOST']) {
    const v = process.env[name];
    if (v && v.length >= 3) out = out.split(v).join('[redacted]');
  }
  return out;
}

/** Strips configured secrets and anything address-like, collapses whitespace, truncates. */
export function scrubMessage(message) {
  return redactConfiguredSecrets(String(message ?? ''))
    .replace(/\S+@\S+/g, '[email]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_DETAIL);
}

function safeCode(error) {
  const c = error && typeof error.code === 'string' ? error.code : '';
  return /^[A-Za-z0-9_.-]{1,32}$/.test(c) ? c : 'UNKNOWN';
}

function safeResponseCode(error) {
  return Number.isInteger(error?.responseCode) ? error.responseCode : null;
}

/** Atomically claims this code's alert slot. true = we may send, false = suppressed. */
async function claimSlot(code) {
  try {
    // The Upstash client retries a dead connection with backoff for >1s, which would eat the
    // whole alert budget — so a slow Redis is treated as unavailable and falls through.
    let timer;
    const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('redis timeout')), REDIS_BUDGET_MS); });
    try {
      const res = await Promise.race([redis.set(`alert:magiclink:${code}`, '1', { nx: true, ex: WINDOW_SEC }), timeout]);
      return res !== null && res !== undefined; // NX that lost the race returns null
    } finally { clearTimeout(timer); }
  } catch {
    // Redis down → fail open, but at most one alert per code per window per instance.
    const now = Date.now();
    const last = lastSentByCode.get(code) || 0;
    if (now - last < WINDOW_SEC * 1000) return false;
    lastSentByCode.set(code, now);
    return true;
  }
}

async function sendAlert(error) {
  if (process.env.NODE_ENV !== 'production') return; // never alert from dev/test

  const code = safeCode(error);
  if (!(await claimSlot(code))) return;

  const responseCode = safeResponseCode(error);
  const env = ['production', 'preview'].includes(process.env.VERCEL_ENV) ? process.env.VERCEL_ENV : 'unknown';
  const text = [
    '🔴 *Magic link send failed*',
    `env: ${escapeMarkdownV1(env)}`,
    `code: ${escapeMarkdownV1(code)}${responseCode ? ` / ${responseCode}` : ''}`,
    `detail: ${escapeMarkdownV1(scrubMessage(error?.message))}`,
  ].join('\n');

  await sendTelegram(text);
}

/**
 * Fire the alert, waiting at most WAIT_BUDGET_MS (so a serverless function isn't
 * frozen before the request leaves, yet sign-in is never held up). Never throws.
 */
export async function alertMagicLinkFailure(error) {
  let timer;
  try {
    await Promise.race([
      sendAlert(error),
      new Promise((resolve) => { timer = setTimeout(resolve, WAIT_BUDGET_MS); }),
    ]);
  } catch {
    /* alerting must never affect sign-in */
  } finally {
    clearTimeout(timer);
  }
}

// Test hook: reset the per-instance fallback state.
export function _resetAlertStateForTests() { lastSentByCode.clear(); }
