/**
 * HTTP 429 handling for the paid OpenRouter SAFETY CHECKS (lib/image-check.js: the image fallback, the second opinion, the text classifier, the minor screen).
 * A single 429 used to fail the check (and, through the circuit breaker, block every new poster for 45 s) even though the image was fine. Now:
 *   • callWithRetry   ONE retry on 429, inside the call's own time budget, with jitter — or NO retry when the server sent `Retry-After` > 1.5 s
 *                     (we do not hit a server again before it said it is ready). If the retry fails too, the result is exactly the first failure's: the check
 *                     stays fail-closed.
 *   • noteRateLimit429  a sanitized one-line log of the 429 (provider, code, short message — never URLs, ids, e-mails, request or image) and a numbers-only
 *                     daily counter `stats:ratelimit429:<UTC day>:<circuit>` (7 days) so the frequency can be judged later.
 * Nothing here touches the credit path (402 / key-limit 403): only a 429 is ever retried.
 */
import redis from './redis.js';
import { nextMidnightUTC } from './api-utils.js';
import { readErrorBody } from './credit-failure.js';

export const MAX_RETRY_AFTER_MS = 1500;      // a longer Retry-After means "do not retry now"
const JITTER_BASE_MS = 300;                  // no Retry-After, the retry goes to ANOTHER model (its own upstream limit): wait 300 ms + 0-400 ms
const JITTER_SPAN_MS = 400;
const SAME_MODEL_BASE_MS = 1500;             // no Retry-After, the retry hits the SAME model (the limit that just rejected us): wait longer, 1.5 s + 0-500 ms
const SAME_MODEL_SPAN_MS = 500;
const MIN_CALL_MS = 2500;                    // never start a call with less time than this left (same floor as lib/image-check.js)
const COUNTER_TTL_SEC = 7 * 24 * 60 * 60;

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry-After header → ms. null = no header at all. Infinity = a header that is PRESENT but that we cannot read with certainty (empty, garbage, an odd date):
 * it asked us to wait, so we do not retry. Only a plain number of seconds or a well-formed HTTP-date (RFC 9110: "Wed, 21 Oct 2026 07:28:00 GMT") is trusted —
 * V8's lenient Date.parse would turn strings like "foo 12" into a date in the past, i.e. "retry now".
 */
export function parseRetryAfterMs(value) {
  if (value === null || value === undefined) return null;
  const v = String(value).trim();
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(parseFloat(v) * 1000);
  if (/^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} (GMT|UTC)$/.test(v)) {
    const at = Date.parse(v);
    if (Number.isFinite(at)) return Math.max(0, at - Date.now());
  }
  return Infinity;
}

/**
 * How long to wait before the ONE retry; null = do not retry (Retry-After above the cap). Jitter only when the server gave no Retry-After: short (300-700 ms) when the
 * retry goes to a different model, longer (1.5-2.0 s) when `sameModel` — it would hit the very limit that just said no. A Retry-After <= 1.5 s is respected exactly.
 */
export function retryPauseMs(retryAfterMs, random = Math.random, sameModel = false) {
  if (retryAfterMs === null || retryAfterMs === undefined) {
    return sameModel ? SAME_MODEL_BASE_MS + Math.floor(random() * (SAME_MODEL_SPAN_MS + 1)) : JITTER_BASE_MS + Math.floor(random() * (JITTER_SPAN_MS + 1));
  }
  return retryAfterMs <= MAX_RETRY_AFTER_MS ? retryAfterMs : null;
}

/**
 * Runs `call(timeoutMs, attempt)` (attempt 0, then 1 for the retry — the caller may use another model for it; it returns { kind:'technical', status, retryAfterMs? }
 * on a failure) and retries it ONCE when the failure is a 429 — see the file comment. `timeoutMs` is the whole budget for call + pause + retry; the retry only starts
 * if at least MIN_CALL_MS of it is left. `sameModel`: the retry hits the same model as the first call (longer pause when there is no Retry-After).
 */
export async function callWithRetry(call, timeoutMs, { sleep = sleepMs, random = Math.random, now = () => performance.now(), sameModel = false } = {}) {
  const t0 = now();
  const first = await call(timeoutMs, 0);
  if (first?.kind !== 'technical' || first.status !== 429) return first;
  const pause = retryPauseMs(first.retryAfterMs, random, sameModel);
  if (pause === null) return first;
  const left = timeoutMs - (now() - t0) - pause;
  if (left < MIN_CALL_MS) return first;
  await sleep(pause);
  return call(Math.floor(left), 1);
}

/** A log-safe fragment: URLs, e-mails and long id-like tokens removed, ASCII only (no log injection), at most `max` characters. */
export function sanitizeLogText(value, max = 160) {
  return String(value ?? '')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, '[email]')
    .replace(/\b[0-9a-f]{16,}\b/gi, '[id]')
    .replace(/\b[\w-]{24,}\b/g, '[id]')
    .replace(/\d{8,}/g, '[num]')               // project numbers and the like
    .replace(/"/g, "'")                         // a quote cannot imitate a field of the log line
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** { provider, code, message, raw } from an OpenRouter error body (JSON or not), every field sanitized and short. */
export function describeRateLimitBody(text) {
  let provider = '', code = '', message = '', raw = '';
  try {
    const e = JSON.parse(text)?.error;
    provider = sanitizeLogText(e?.metadata?.provider_name, 40).replace(/[^A-Za-z0-9 ._/-]/g, '');
    code = sanitizeLogText(e?.code, 12);
    message = sanitizeLogText(e?.message, 120);
    const r = e?.metadata?.raw;
    raw = sanitizeLogText(typeof r === 'string' ? r : r === undefined ? '' : JSON.stringify(r), 160);
  } catch {
    raw = sanitizeLogText(text, 160);
  }
  return { provider, code, message, raw };
}

/** Log + count one 429 answered to the check `label` (a circuit name). Reads the body (2 s guard). Never throws. */
export async function noteRateLimit429(label, res, retryAfterMs) {
  try {
    const d = describeRateLimitBody(await readErrorBody(res));
    const ra = retryAfterMs === null || retryAfterMs === undefined ? 'none' : Number.isFinite(retryAfterMs) ? `${retryAfterMs}ms` : 'unreadable';
    console.warn(`⏳ HTTP 429 on ${sanitizeLogText(label, 30)}: provider=${d.provider || '?'} code=${d.code || '?'} retry-after=${ra} message="${d.message}" raw="${d.raw}"`);
  } catch { /* the log line is a nicety */ }
  try {
    const key = `stats:ratelimit429:${new Date().toISOString().split('T')[0]}:${sanitizeLogText(label, 30).replace(/[^a-z0-9_]/gi, '')}`;
    const pipe = redis.pipeline();
    pipe.incr(key);
    pipe.expireat(key, nextMidnightUTC() + COUNTER_TTL_SEC);
    await pipe.exec();
  } catch { /* visibility only */ }
}
