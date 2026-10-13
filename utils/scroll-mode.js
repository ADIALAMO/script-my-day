// How the script window scrolls (pure; unit-tested in tests/scroll-mode.test.js).
//
// iOS SCROLL RULE (see CLAUDE.md): the DOCUMENT is the page scroller (pages/_document.js) and there is at most ONE inner scroll container on a screen —
// the script window. History: the script used to sit in a fixed-height box that was a THIRD nested scroller (viewport > body > box) on iPhone Safari,
// which rubber-banded and shook; the page scroller was the `body` because the splash CSS (html, body {height:100%; overflow:hidden}) was never undone.
// Making the document the scroller (one nesting level fewer) fixed it: verified stable on a real iPhone (variant "B" of the preview comparison).
//
// DEFAULT everywhere: the fixed-height window with its own inner scroll. `?variant=off` (stored, `?variant=on` undoes it) is the escape hatch: it restores the
// previous behaviour (touch: the script flows in the page; the old body page scroller).
export const COARSE_QUERY = '(pointer: coarse)';

/**
 * Box height on touch: min(60svh, 520px). svh = the SMALL viewport, which does NOT change while Safari's toolbar collapses (dvh does), so the box
 * never resizes during a scroll or a typing tick. Never vh (the large viewport: taller than the visible area while the toolbar is up).
 */
export const TOUCH_BOX_HEIGHT = 'min(60svh, 520px)';

/** 'inner' = the fixed-height window with its own scroller (default, desktop AND touch); 'page' = the legacy page flow (touch + ?variant=off only) */
export const scriptWindowMode = ({ coarsePointer, off = false }) => (coarsePointer && off ? 'page' : 'inner');

/** touch + not switched off: the window uses the touch height */
export const isTouchBox = ({ coarsePointer, off = false }) => !!coarsePointer && !off;

/** with the touch window the page must never be scrolled programmatically (index.js skips its own scroll to the script): that was part of the verified variant */
export const skipPageAutoScroll = isTouchBox;

/**
 * class list of the script window's container.
 * mode 'page' (legacy): no height / overflow / scrollbar styling. mode 'inner': the window. `touch` = the touch window: fixed height from TOUCH_BOX_HEIGHT (an
 * inline style; h-[500px] is only the fallback for a browser without svh).
 */
export function scriptWindowClasses(mode, { touch = false } = {}) {
  if (mode !== 'inner') return 'p-10 md:p-20 relative';
  // scrollbar-gutter:stable keeps the text column the same width whether or not the scrollbar is showing (typing makes it appear: no reflow, no 4-15 px jump)
  const base = 'overflow-y-auto [scrollbar-gutter:stable] p-10 md:p-20 custom-scrollbar relative';
  return touch ? `h-[500px] ${base} overscroll-y-auto` : `h-[500px] md:h-[650px] ${base} overscroll-y-auto`;
}

/** the frame's corner radius: the window's text can scroll past the rounded corners, so with a window the radius must not exceed the padding (32px < 40px on phones, 56px = 80px on md+) */
export const scriptFrameRadius = (mode) => (mode === 'inner' ? 'rounded-[2rem] md:rounded-[3.5rem]' : 'rounded-[3.5rem]');
