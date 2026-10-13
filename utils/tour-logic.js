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

/** the first of a step's anchors (several = fallbacks) that exists and is visible, else null. lookup(anchor) -> rect | null */
export function findUsableAnchor(step, lookup) {
  return step.anchors.find((a) => isUsableRect(lookup(a))) || null;
}

/** keep the steps with a usable anchor right now */
export function resolveSteps(steps, lookup) {
  return steps.filter((s) => findUsableAnchor(s, lookup));
}

/**
 * One step's lifecycle, polled. Not shown yet: 'show' when its anchor is there, 'wait' until `waitMs` has passed, then 'drop' (silently).
 * Shown: 'keep' while the anchor is there; once it has been missing `misses` polls in a row (>= 2, so a re-render can't drop it) 'drop'.
 */
export function stepOutcome({ found, shown, elapsedMs = 0, waitMs = 0, misses = 0 }) {
  if (!shown) return found ? 'show' : (elapsedMs >= waitMs ? 'drop' : 'wait');
  if (found) return 'keep';
  return misses >= 2 ? 'drop' : 'wait';
}

/** "k of M" total after silent drops */
export const chapterTotal = (length, dropped) => Math.max(0, length - dropped);

/** a chapter can start when the stage it needs was reached (on screen, or earlier in this session). reached = {script, poster, comic} */
export const chapterAvailable = (chapter, reached) => !chapter.stage || !!reached?.[chapter.stage];

/** chapters 2+ start on their own only for a user who finished chapter 1 (never after a skip), once each */
export function chapterAutoEligible(state, id) {
  return id > 1 && !state.off && state.done.includes(1) && !state.done.includes(id);
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

// ── Spotlight positioning (pure) ─────────────────────────────────────────────

const near = (a, b, eps) => Math.abs(a - b) <= eps;

/** two DOMRect-like boxes are the same place (sub-pixel noise tolerated) */
export const rectsClose = (a, b, eps = 0.5) => !!a && !!b
  && near(a.left, b.left, eps) && near(a.top, b.top, eps) && near(a.width, b.width, eps) && near(a.height, b.height, eps);

/**
 * "Stable" = the anchor's rect has not moved for `frames` consecutive animation frames. push(rect) once per frame; a null rect (anchor
 * missing / zero-size) or any movement restarts the count. Used to show the spotlight only after a scroll or an entrance animation settled.
 */
export function createStability({ frames = 3, eps = 0.5 } = {}) {
  let last = null;
  let still = 0;
  return {
    push(rect) {
      if (!isUsableRect(rect)) { last = null; still = 0; return false; }
      still = rectsClose(last, rect, eps) ? still + 1 : 0;
      last = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
      return still >= frames;
    },
    reset() { last = null; still = 0; },
  };
}

/** scroll only when the anchor is not already comfortably visible: clear of the sticky navbar and leaving `room` px below for the bubble */
export function needsScroll({ rect, navH = 0, vh, room = 220 }) {
  if (rect.top < navH + 8) return true;
  const tall = rect.height > vh - navH - room;
  return tall ? rect.top > navH + 8 + 40 : rect.bottom > vh - room;
}

/**
 * Spotlight + bubble layout. `rect` is getBoundingClientRect() (layout-viewport coordinates, which is also what position:fixed uses);
 * `off` = visualViewport.offsetLeft/offsetTop and `vp` its width/height (iOS: the visible part moves inside the layout viewport while the
 * toolbar collapses or the page is zoomed). The anchor is clipped to the VISIBLE part, the bubble is placed inside it, and both are returned
 * in layout coordinates again so they line up with the real element.
 */
export function layoutFor({ rect, off = { x: 0, y: 0 }, vp, insets = {}, bubble, rtl = false, pad = 6 }) {
  const top = Math.max(rect.top - off.y, 0);
  const bottom = Math.min(rect.bottom - off.y, vp.h);
  const left = Math.max(rect.left - off.x, 0);
  const right = Math.min(rect.right - off.x, vp.w);
  const vis = { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
  const spot = { left: vis.left - pad + off.x, top: vis.top - pad + off.y, width: vis.width + pad * 2, height: vis.height + pad * 2 };
  const padded = { left: vis.left - pad, right: vis.right + pad, top: vis.top - pad, bottom: vis.bottom + pad, width: vis.width + pad * 2, height: vis.height + pad * 2 };
  const p = computePlacement({ rect: padded, bubble, vp, insets, rtl });
  return { spot, place: { ...p, left: p.left + off.x, top: p.top + off.y } };
}
