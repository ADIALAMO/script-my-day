// What a failed comic-frame request means for the user (pure, unit-tested in tests/frame-error.test.js).
// A frame that failed because of the NETWORK (offline, iOS "Load failed" after the tab was suspended, a timeout, a 5xx, a non-JSON body) can simply be
// asked for again; a refusal or a quota answer cannot — retrying would not change it. Both used to end in the same dead black "Frame Lost" tile.
import { CODES } from '../lib/messages.js';

export const FETCH_TIMEOUT_MS = { storyboard: 62000, panel: 55000 }; // just above the 60 s server limit / a bit below it for one panel
export const AUTO_RETRY_DELAY_MS = 1500;
export const RESUME_CONCURRENCY = 2;

// never retry: the answer would be the same (or it is the user's decision: sign in, wait for the reset, start a new comic)
const TERMINAL_CODES = new Set([
  CODES.CONTENT_BLOCKED, CODES.CONTENT_REFUSED, CODES.IMAGE_BUDGET_REACHED,
  CODES.QUOTA_PANEL_REGEN, CODES.QUOTA_PANEL_DAILY, CODES.NEEDS_ACCOUNT,
  CODES.SERVICE_UNAVAILABLE,   // the AI account is out of credit: asking again (or retrying automatically) cannot help until it is topped up
]);

/**
 * kind: 'network' | 'timeout' | 'nonjson' | 'http' | 'api' (a JSON answer with success:false) | 'placeholder'
 * -> { retryable, sessionExpired, rateLimited, reason }
 */
export function classifyFrameFailure({ kind, status = 0, code = '' } = {}) {
  const out = (retryable, extra = {}) => ({ retryable, sessionExpired: false, rateLimited: false, reason: kind || 'unknown', ...extra });
  if (code === CODES.COMIC_SESSION_EXPIRED) return out(false, { sessionExpired: true, reason: 'session-expired' });
  if (code === CODES.RATE_LIMITED) return out(true, { rateLimited: true, reason: 'rate-limited' });   // has its own amber "wait a moment" state
  if (code && TERMINAL_CODES.has(code)) return out(false, { reason: 'terminal' });
  if (code === CODES.CONTENT_CHECK_UNAVAILABLE) return out(true);                                      // the image could not be checked in time; nothing was charged
  if (kind === 'network' || kind === 'timeout' || kind === 'nonjson') return out(true);
  if (kind === 'http') {
    if (status >= 500) return out(true);
    if (status === 429) return out(true, { rateLimited: true, reason: 'rate-limited' });
    return out(false, { reason: `http-${status}` });                                                   // other 4xx without a known code: the request itself is wrong
  }
  if (kind === 'placeholder') return out(true);                                                         // every provider busy; the server gave the attempt back
  return out(true);                                                                                     // an unknown failure is worth one more try
}

/** the frames the user can ask for again: finished-with-an-error, retryable, no image. panelImages = { [idx]: state } */
export function missingFrames(panelImages, count) {
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const s = panelImages?.[i];
    if (s && !s.loading && !s.url && s.error && s.retryable) out.push(i);
  }
  return out;
}

/** true when some frame says the comic's server session is gone (the only way forward is a new comic) */
export const anySessionExpired = (panelImages, count) => {
  for (let i = 0; i < count; i += 1) if (panelImages?.[i]?.sessionExpired) return true;
  return false;
};

/** one automatic retry per frame, only on a retryable failure */
export const shouldAutoRetry = ({ attempt, retryable }) => attempt === 0 && !!retryable;

/** a restored panel without an image: resumable only when its comic session (seed) was saved */
export function restoredPanelState(panel, canResume) {
  if (panel?.imageUrl) return { loading: false, url: panel.imageUrl, error: false };
  return canResume
    ? { loading: false, url: null, error: true, retryable: true, missing: true }
    : { loading: false, url: null, error: true, retryable: false, noSession: true };
}
