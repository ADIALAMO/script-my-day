/**
 * Telegram alerts for the script cascade — deduped through lib/alert-throttle.js (alertOnce: production only, one per
 * key per window across instances via Redis SET NX, bounded to ~1.5 s, never throws).
 * Text is FIXED (model ids are code constants, not request data) — no user input and no secrets ever go in here.
 */
import { alertOnce } from './alert-throttle.js';
import { escapeMarkdownV1 } from './telegram.js';

const utcDay = () => new Date().toISOString().split('T')[0];

/**
 * A Gemini model answered 429 and its circuit just opened. One alert per 30 min; a per-day quota gets its own, rarer one.
 * `kind` (minute | day | unknown) is the classification of the 429 body (lib/script-circuit.js classify429) — a fixed
 * three-value label so the first real alert shows which path was taken. Anything else is shown as "unknown".
 */
export function alertGemini429(model, kind) {
  const name = escapeMarkdownV1(model);
  const label = kind === 'day' || kind === 'minute' ? kind : 'unknown';
  if (label === 'day') {
    return alertOnce(`script-gemini-quota-day:${utcDay()}`,
      `🚨 *LIFESCRIPT*: Gemini ${name} hit a *daily* quota (HTTP 429, classification: day). It is skipped until the quota resets; scripts fall back to the next models.`,
      { windowSec: 6 * 3600 });
  }
  return alertOnce('script-gemini-429',
    `⚠️ *LIFESCRIPT*: Gemini ${name} answered HTTP 429 (classification: ${label}). It is skipped for a minute; scripts fall back to the next models.`);
}

/** Every stage of the script cascade failed → the user got SCRIPT_FAIL. */
export function alertCascadeFailed() {
  return alertOnce('script-cascade-failed',
    '🚨 *LIFESCRIPT*: script generation failed on ALL stages (users are getting SCRIPT_FAIL). Check Gemini quota and OpenRouter / Cohere status.');
}
