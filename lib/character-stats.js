/**
 * Star Yourself OUTCOME counters — numbers only, no identifiers, no image data.
 *
 *   stats:character:<UTC day>:<name>      INCR, expires 60 days after that day's end
 *
 * SERVER names (pages/api/upload-character.js): every request that reaches the handler adds ONE `started` and exactly ONE outcome, so started = the sum of the
 * outcomes: succeeded | unsafe | unavailable | minor_rejected | sheet_failed | unsupported_format | blocked (consent / tier / 18+ / quota / budget / rate-limit
 * refusals, a too-short body) | error (unhandled / server misconfiguration). The outcome is derived from the FINAL response by outcomeFor(), in one place.
 * Requests carrying the admin API KEY are not counted (admin-tier user ACCOUNTS are).
 * CLIENT names (pages/api/character-event.js): decode_failed | heic_detected — failures that happen in the browser and never reach upload-character.
 * They are advisory (anyone can POST the two enum values, rate-limited), and mutually exclusive: heic_detected = a HEIC-looking file whose decode failed.
 * Every function is bounded (~0.5 s), never throws, and never changes a response.
 */
import redis from './redis.js';
import { nextMidnightUTC } from './api-utils.js';

export const SERVER_OUTCOMES = ['succeeded', 'unsafe', 'unavailable', 'minor_rejected', 'sheet_failed', 'unsupported_format', 'blocked', 'error'];
export const CLIENT_EVENTS = ['decode_failed', 'heic_detected'];
export const ALL_COUNTERS = ['started', ...SERVER_OUTCOMES, ...CLIENT_EVENTS];
export const RETENTION_DAYS = 60;
const BUDGET_MS = 500;

const utcDay = (d = new Date()) => d.toISOString().split('T')[0];
export const characterKey = (name, day = utcDay()) => `stats:character:${day}:${name}`;

const CODE_OUTCOME = {
  SAFETY_REJECTED: 'unsafe', CONTENT_REFUSED: 'unsafe',
  MINOR_REJECTED: 'minor_rejected',
  CONTENT_CHECK_UNAVAILABLE: 'unavailable', PHOTO_CHECK_UNAVAILABLE: 'unavailable', SERVICE_UNAVAILABLE: 'unavailable',
  CHARACTER_SHEET_FAILED: 'sheet_failed',
  IMAGE_UNSUPPORTED: 'unsupported_format',
};

/** the outcome of one upload-character request from its FINAL response: (HTTP status, `code` of the body, body.success === true) */
export function outcomeFor(status, code, success) {
  if (status === 200 && success === true) return 'succeeded';
  if (code && Object.prototype.hasOwnProperty.call(CODE_OUTCOME, code)) return CODE_OUTCOME[code];
  if (code === 'SERVER_ERROR') return 'error';                                 // a server problem (unhandled error, storage / secret not configured, Redis unreadable)
  if (code) return 'blocked';                                                   // any other coded refusal is a gate decision (consent, tier, 18+, quota, budget — also when it is a 503 —, rate limit)
  return !Number.isFinite(status) || status >= 500 ? 'error' : 'blocked';       // no code: a crash is an error, anything else a refusal
}

async function bump(names) {
  let timer;
  try {
    const pipe = redis.pipeline();
    for (const n of names) { const key = characterKey(n); pipe.incr(key); pipe.expireat(key, nextMidnightUTC() + RETENTION_DAYS * 86400); }
    await Promise.race([pipe.exec(), new Promise((resolve) => { timer = setTimeout(resolve, BUDGET_MS); })]);
  } catch { /* visibility only */ } finally { clearTimeout(timer); }
}

/** one upload-character request: `started` + its outcome (a name from SERVER_OUTCOMES; anything else is ignored) */
export async function recordCharacterRequest(outcome) {
  if (!SERVER_OUTCOMES.includes(outcome)) return;
  await bump(['started', outcome]);
}

/** one client-side failure (a name from CLIENT_EVENTS; anything else is ignored) */
export async function recordClientEvent(event) {
  if (!CLIENT_EVENTS.includes(event)) return;
  await bump([event]);
}

/** last `days` UTC days, newest first: [{ day, counts: { started, succeeded, … } }] — one batched read, days with no data left out. Fail-open: [] on error. */
export async function readCharacterOutcomes(days = 7, client = redis, now = new Date()) {
  try {
    const dayList = Array.from({ length: days }, (_, i) => utcDay(new Date(now.getTime() - i * 86400000)));
    const keys = dayList.flatMap((d) => ALL_COUNTERS.map((n) => characterKey(n, d)));
    const vals = await client.mget(...keys);
    return dayList.map((day, i) => ({ day, counts: Object.fromEntries(ALL_COUNTERS.map((n, j) => [n, Number(vals?.[i * ALL_COUNTERS.length + j]) || 0])) }))
      .filter((d) => Object.values(d.counts).some((v) => v > 0));
  } catch { return []; }
}
