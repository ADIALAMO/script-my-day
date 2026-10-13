// Programmatic page scrolls to an element (the document is the page scroller, see CLAUDE.md "iOS scroll rule"; element APIs work with any scroller).
// Shared by the "next step" pills (NextStepButton) and the "Go to script window" button (GoToScriptButton) so the sticky-header offset, the safe area and
// prefers-reduced-motion are handled in ONE place. Browser-only helpers; the decisions that can be tested without a DOM live in utils/go-to-script.js.
import { createStability } from './tour-logic.js';

export const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/** height of the sticky navbar (0 when absent) */
export const stickyHeaderHeight = () => document.querySelector('nav')?.offsetHeight || 0;

/**
 * Scrolls `el` to the top of the visible page, below the sticky navbar (+ `gap` px, + the top safe area). Smooth unless the user prefers reduced motion.
 * scroll-margin-top is set for the duration of the scroll only (a smooth scroll reads it while it runs).
 */
export function scrollToAnchor(el, { gap = 16, behavior } = {}) {
  if (!el) return;
  const prev = el.style.scrollMarginTop;
  el.style.scrollMarginTop = `calc(${stickyHeaderHeight() + gap}px + env(safe-area-inset-top, 0px))`;
  el.scrollIntoView({ block: 'start', behavior: behavior || (reducedMotion() ? 'auto' : 'smooth') });
  setTimeout(() => { el.style.scrollMarginTop = prev; }, 1500);
}

export const findScriptWindow = () => document.querySelector('[data-script-scroller]');

/**
 * Brings the script window into view. `settle` waits (up to `maxMs`) until the window's rect has held still for a few frames before scrolling: right after a
 * script appears the loading panels are still collapsing, and a smooth scroll aimed at the layout of that moment ends hundreds of px off (measured: the window's top
 * 230 px under the navbar). Returns a cancel function.
 */
export function scrollToScriptWindow({ settle = false, maxMs = 2000, behavior } = {}) {
  let raf = 0; let cancelled = false;
  const go = () => { if (!cancelled) scrollToAnchor(findScriptWindow(), { behavior }); };
  if (!settle) { go(); return () => { cancelled = true; }; }
  const stab = createStability({ frames: 4 });
  const t0 = performance.now();
  const tick = () => {
    if (cancelled) return;
    const el = findScriptWindow();
    const ok = el ? stab.push(el.getBoundingClientRect()) : false;
    if (ok || performance.now() - t0 > maxMs) { if (el) go(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { cancelled = true; cancelAnimationFrame(raf); };
}
