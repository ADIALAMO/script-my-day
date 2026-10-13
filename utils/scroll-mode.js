// How the script window scrolls (pure; unit-tested in tests/scroll-mode.test.js).
//
// iOS RULE: no nested vertical scroll container on touch devices. The script used to live in a fixed-height box with its own overflow-y:auto
// (a "screenplay window" that follows the typewriter). On iPhone Safari that box is a third nested scroller (viewport > body > box): after typing it
// is parked at its bottom edge, iOS rubber-bands it instead of handing the gesture to the page, and the screen visibly shakes. Touch devices
// therefore get ordinary page flow (like the poster and the comic, which are stable); desktop keeps the window.
// (That is still the DEFAULT. The variants below bring the window back on touch for side-by-side comparison on a preview deployment.)
export const COARSE_QUERY = '(pointer: coarse)';

// ── Preview variants (query flags, touch devices only; the DEFAULT is unchanged: page flow) ──────────────────────────────────────────────────────
// The product owner wants the fixed-height script window back on iPhone without the shake. Until one variant is proven stable on a real phone, they are
// selected by URL flags so they can be compared on a preview deployment:
//   ?scriptbox=1                          A  the window back, page scroller = BODY (today's model)
//   ?scriptbox=1&rootscroll=1             B  the window, the DOCUMENT is the page scroller (one nesting level fewer; flag handled in pages/_document.js)
//   ?scriptbox=1&rootscroll=1&contain=1   C  B + overscroll-behavior: contain on the box (a swipe that starts inside it cannot scroll the page: visible gutters around it)
// `contain` / `rootscroll` are also honoured on their own so the combinations can be probed, but only A, B and C are the supported comparison set.
const flag = (search, name) => new RegExp(`(?:^|[?&])${name}=1(?:&|$)`).test(search || '');

export function parseScriptVariant(search = '') {
  return { scriptbox: flag(search, 'scriptbox'), rootscroll: flag(search, 'rootscroll'), contain: flag(search, 'contain') };
}

/** 'A' | 'B' | 'C' | 'custom' (any other scriptbox combination) | 'default' (no scriptbox flag) */
export function variantId({ scriptbox, rootscroll, contain }) {
  if (!scriptbox) return 'default';
  if (!rootscroll && !contain) return 'A';
  if (rootscroll && !contain) return 'B';
  if (rootscroll && contain) return 'C';
  return 'custom';
}

export const variantLabel = (v) => `${variantId(v)}: box ${v.scriptbox ? 'on' : 'off'} | scroller ${v.rootscroll ? 'document' : 'body'} | overscroll ${v.contain ? 'contain' : 'auto'}`;

/**
 * 'page'  = the script flows in the page (touch default)
 * 'inner' = the fixed-height window with its own scroller (desktop / precise pointer ALWAYS; touch only with ?scriptbox=1)
 */
export function scriptWindowMode({ coarsePointer, search = '' }) {
  if (!coarsePointer) return 'inner';
  return parseScriptVariant(search).scriptbox ? 'inner' : 'page';
}

/** touch + a scriptbox variant: the preview window is active */
export const isTouchBoxVariant = ({ coarsePointer, search = '' }) => !!coarsePointer && parseScriptVariant(search).scriptbox;

/**
 * Box height on touch: min(60svh, 520px). svh = the SMALL viewport, which does NOT change while Safari's toolbar collapses (dvh does), so the box
 * never resizes during a scroll or a typing tick. Never vh (the large viewport: taller than the visible area while the toolbar is up).
 */
export const TOUCH_BOX_HEIGHT = 'min(60svh, 520px)';

/** the page's own auto-scroll to the script (index.js) is skipped in a touch box variant: the page must never be scrolled programmatically there */
export const skipPageAutoScroll = isTouchBoxVariant;

/**
 * class list of the script window's container.
 * mode 'page' (touch default): no height / overflow / scrollbar styling. mode 'inner': the window. `touch` = a touch preview variant: fixed height from
 * TOUCH_BOX_HEIGHT (applied as an inline style; h-[500px] is only the fallback for a browser without svh), `contain` = overscroll-behavior: contain.
 */
export function scriptWindowClasses(mode, { touch = false, contain = false } = {}) {
  if (mode !== 'inner') return 'p-10 md:p-20 relative';
  const base = 'overflow-y-auto p-10 md:p-20 custom-scrollbar relative';
  if (touch) return `h-[500px] ${base} ${contain ? 'overscroll-y-contain' : 'overscroll-y-auto'}`;
  return `h-[500px] md:h-[650px] ${base} overscroll-y-auto`;
}

/** margin classes of the frame around the box: with `contain` there must always be a page gutter to swipe the page in (sides, above, below) */
export const scriptFrameGutter = ({ touch = false, contain = false } = {}) => (touch && contain ? 'mx-5 my-6' : 'mx-2 md:mx-4');
