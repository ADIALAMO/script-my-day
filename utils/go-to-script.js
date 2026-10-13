// Pure rules for the "Go to script window" button (unit-tested in tests/go-to-script.test.js). No DOM access here.

/** the label, both languages */
export const GO_TO_SCRIPT_LABEL = { he: 'לחלון התסריט', en: 'Go to script' };
export const GO_TO_SCRIPT_ARIA = { he: 'גלול אל חלון התסריט', en: 'Scroll to the script window' };

/** the touch target of the button (px) — never below 44 */
export const GO_TO_SCRIPT_MIN_PX = 44;

/**
 * "Mostly visible": at least 60% of the window is inside the visible area (below the sticky navbar), or the visible part fills at least half of that area
 * (the window can be taller than a short screen). `rect` = getBoundingClientRect(), `navH` = height of the sticky navbar, `vh` = viewport height.
 */
export function scriptWindowMostlyVisible({ rect, navH = 0, vh }) {
  if (!rect || !(rect.height > 0) || !(vh > 0)) return false;
  const top = Math.max(rect.top, navH); const bottom = Math.min(rect.bottom, vh);
  const shown = Math.max(0, bottom - top);
  return shown >= rect.height * 0.6 || shown >= (vh - navH) * 0.5;
}

/** which way the window lies: 'up' = above the visible area, 'down' = below it (drives the arrow) */
export const scriptWindowDirection = ({ rect, navH = 0 }) => (rect && rect.top + rect.height / 2 < navH ? 'up' : 'down');

/**
 * Whether the button is shown.
 *   typingStarted   the typewriter has started for this script (stays true afterwards, until the window has been seen)
 *   seen            the window was mostly visible at some point since typing started: the job of the button is done, it never comes back for this script
 *   visible         the window is mostly visible right now
 *   busy            a poster / comic generation is running
 *   overlay         a modal, lightbox, menu or the guided tour is covering the page
 */
export const shouldShowGoToScript = ({ typingStarted, seen, visible, busy, overlay }) =>
  !!typingStarted && !seen && !visible && !busy && !overlay;
