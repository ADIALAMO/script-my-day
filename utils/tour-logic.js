// Pure logic of the guided tour (no DOM, no React) so it can be unit-tested.

/** Keys that prove this device has used the app before (existing users never get the tour unprompted). */
const PRIOR_KEYS = ['lifescript_history', 'ls_howto_dismissed', 'lifescript_producer_name'];

/** true when the device already has history entries / posters / comics (they live in the history list) or other proof of earlier use */
export function hasPriorActivity(storage, historyCount = 0) {
  if (historyCount > 0) return true;
  try {
    if (!storage) return false;
    const rawHistory = storage.getItem('lifescript_history');
    if (rawHistory) {
      try {
        const list = JSON.parse(rawHistory);
        if (Array.isArray(list) ? list.length > 0 : !!list) return true;
      } catch { return true; } // unreadable but present = used before
    }
    return PRIOR_KEYS.slice(1).some((k) => !!storage.getItem(k));
  } catch { return false; }
}

/** the cookie banner shows while its key is unset; the tour waits so the bubble never sits under it */
export function cookieBannerPending(storage) {
  try { return !!storage && storage.getItem('lifescript_cookie_v2') === null; } catch { return false; }
}

/**
 * Auto-start decision on first visit. `ready` = mounted long enough and the first anchor is on screen.
 * Returns 'start' | 'wait' | 'abandon' (abandon = never auto-start in this session, nothing is stored).
 */
export function autoStartDecision({ done, priorActivity, hasScript, blocked, cookiePending, ready }) {
  if (done || priorActivity || hasScript) return 'abandon';
  if (blocked || cookiePending || !ready) return 'wait';
  return 'start';
}

export const isUsableRect = (r) => !!r && r.width > 0 && r.height > 0;

/** keep the steps whose anchor exists and is visible. lookup(anchor) -> rect | null */
export function resolveSteps(steps, lookup) {
  return steps.filter((s) => isUsableRect(lookup(s.anchor)));
}

/**
 * Bubble placement in viewport (physical) coordinates.
 * rect = anchor rect; bubble = {w,h}; vp = {w,h}; insets = {top,bottom,left,right}; rtl aligns a wide anchor's START edge.
 * Returns { mode: 'top'|'bottom'|'dock', left, top, arrowLeft } — arrowLeft is relative to the bubble (null when docked).
 */
export function computePlacement({ rect, bubble, vp, insets = {}, rtl = false, gap = 14, margin = 12 }) {
  const ins = { top: 0, bottom: 0, left: 0, right: 0, ...insets };
  const minLeft = ins.left + margin;
  const maxLeft = Math.max(minLeft, vp.w - ins.right - margin - bubble.w);
  const minTop = ins.top + margin;
  const maxBottom = vp.h - ins.bottom - margin;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  const centre = rect.left + rect.width / 2;
  let left = centre - bubble.w / 2;
  if (rect.width > bubble.w) left = rtl ? rect.right - bubble.w : rect.left;
  left = clamp(left, minLeft, maxLeft);

  const below = rect.bottom + gap;
  const above = rect.top - gap - bubble.h;
  const dockTop = maxBottom - bubble.h;
  let mode;
  let top;
  if (below + bubble.h <= maxBottom) { mode = 'bottom'; top = Math.max(below, minTop); }
  else if (above >= minTop) { mode = 'top'; top = above; }
  else { mode = 'dock'; top = Math.max(minTop, dockTop); }

  const arrowLeft = mode === 'dock' ? null : clamp(centre - left, 18, bubble.w - 18);
  return { mode, left, top, arrowLeft };
}

/** next index with direction, never leaving [0, n-1]; -1 when there is nothing further */
export function stepAfter(index, dir, n) {
  const next = index + dir;
  return next < 0 || next >= n ? -1 : next;
}
