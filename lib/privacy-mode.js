/**
 * "Privacy mode" guard. The Privacy Policy (constants/ai-provider-copy.js §7) describes PRODUCTION with privacy mode ON: the journal text goes only to OpenRouter models routed with
 * provider.data_collection "deny" (an OpenRouter key and DAILY_SCRIPT_BUDGET > 0, see lib/story-service.js / pages/api/generate-storyboard.js). With it OFF the old paths wake up —
 * the direct Google free-tier key, Cohere — which the policy no longer lists, so the policy would be wrong.
 *
 * warnIfPrivacyModeOff(privacy) is called where `privacy` is decided. Only on the PRODUCTION deployment (VERCEL_ENV === 'production': a Preview build also has NODE_ENV
 * production but its own settings): one log line per instance + ONE deduped Telegram alert per 6 h for the whole account (lib/alert-throttle.js: production only, Redis SET NX,
 * bounded ~1.5 s, never throws). Fixed text only — no values, no request data. Costs nothing when privacy mode is on (a boolean check).
 */
import { alertOnce } from './alert-throttle.js';
import { escapeMarkdownV1 } from './telegram.js';

const ALERT_WINDOW_SEC = 6 * 60 * 60;
let logged = false;

export async function warnIfPrivacyModeOff(privacy) {
  if (privacy || process.env.VERCEL_ENV !== 'production') return;
  if (!logged) {
    logged = true;
    console.error('🔓 PRIVACY MODE IS OFF in production (no OpenRouter key, or DAILY_SCRIPT_BUDGET is 0): journal text can reach providers the Privacy Policy no longer lists — fix the setting or update the policy.');
  }
  await alertOnce('privacy-mode-off',
    `🔓 *LIFESCRIPT*: privacy mode is *OFF* in production (no OpenRouter key, or ${escapeMarkdownV1('DAILY_SCRIPT_BUDGET')} is 0). ` +
    'Journal text can now reach providers the Privacy Policy no longer lists (the direct Google free-tier key, Cohere). ' +
    `Set ${escapeMarkdownV1('DAILY_SCRIPT_BUDGET')} above 0, or update the Privacy Policy.`,
    { windowSec: ALERT_WINDOW_SEC });
}

/** Test helper. */
export function _resetPrivacyModeLog() { logged = false; }
