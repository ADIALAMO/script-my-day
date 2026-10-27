/**
 * "No endpoints found matching your data policy" (HTTP 404) — OpenRouter found NO provider for the model that satisfies the request's
 * `provider.data_collection: "deny"` (or the account's privacy settings). It is a technical routing failure like any other: the caller falls through to its
 * existing fallback, nothing is skipped or approved. This module only makes it VISIBLE, because the fallback also changes cost and which provider sees the data:
 *   • a numbers-only daily counter `stats:policy404:<UTC day>:<circuit>` (7 days)
 *   • ONE Telegram alert per hour for the whole account (fixed text; `label` comes from a closed list; no model output, URL or user data)
 * Never throws.
 */
import redis from './redis.js';
import { alertOnce } from './alert-throttle.js';
import { nextMidnightUTC } from './api-utils.js';

const POLICY_404 = /no endpoints found matching your data policy/i;
const LABELS = new Set(['check_nemotron', 'check_gemini', 'check_imgsafety', 'check_text', 'check_minor', 'check_gemini_retry', 'check_imgsafety_retry', 'check_text_retry', 'check_minor_retry', 'openrouter', 'grok_identity', 'gemini_identity']);   // circuit names of the calls that send `deny` and can hit this
const ALERT_WINDOW_SEC = 60 * 60;
const COUNTER_TTL_SEC = 7 * 24 * 60 * 60;

/** true when this status + error text is OpenRouter's data-policy routing failure */
export const isPolicyRoutingError = (status, text) => status === 404 && POLICY_404.test(String(text ?? ''));

/** Counts + announces one data-policy 404 of the call `label` (a circuit name). Returns true when it was one. */
export async function notePolicyRouting404(label, status, text) {
  if (!isPolicyRoutingError(status, text)) return false;
  const name = LABELS.has(label) ? label : 'other';
  console.warn(`🔒 OpenRouter: no endpoint satisfies the data policy (data_collection=deny) for ${name} — falling back`);
  try {
    const key = `stats:policy404:${new Date().toISOString().split('T')[0]}:${name}`;
    const pipe = redis.pipeline();
    pipe.incr(key);
    pipe.expireat(key, nextMidnightUTC() + COUNTER_TTL_SEC);
    await pipe.exec();
  } catch { /* visibility only */ }
  await alertOnce('policy-404',
    `🔒 *LIFESCRIPT*: a provider no longer satisfies our privacy routing (OpenRouter data_collection=deny) — first seen on: ${name.replace(/_/g, ' ')}. ` +
    'Requests fall back to the other providers (higher cost / a different provider sees the data). Check the model\'s data policy on openrouter.ai.',
    { windowSec: ALERT_WINDOW_SEC });
  return true;
}
