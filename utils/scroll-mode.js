// How the script window scrolls (pure; unit-tested in tests/scroll-mode.test.js).
//
// iOS RULE: no nested vertical scroll container on touch devices. The script used to live in a fixed-height box with its own overflow-y:auto
// (a "screenplay window" that follows the typewriter). On iPhone Safari that box is a third nested scroller (viewport > body > box): after typing it
// is parked at its bottom edge, iOS rubber-bands it instead of handing the gesture to the page, and the screen visibly shakes. Touch devices
// therefore get ordinary page flow (like the poster and the comic, which are stable); desktop keeps the window.
export const COARSE_QUERY = '(pointer: coarse)';

/** 'page' = the script flows in the page (touch); 'inner' = the fixed-height window with its own scroller (desktop / precise pointer) */
export const scriptWindowMode = ({ coarsePointer }) => (coarsePointer ? 'page' : 'inner');

/** class list of the script window's scroll container for a mode (the inner window keeps its look; page flow has no height / overflow / scrollbar styling) */
export function scriptWindowClasses(mode) {
  return mode === 'inner'
    ? 'h-[500px] md:h-[650px] overflow-y-auto overscroll-y-auto p-10 md:p-20 custom-scrollbar relative'
    : 'p-10 md:p-20 relative';
}
