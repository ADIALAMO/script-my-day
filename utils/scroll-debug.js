// Pure helpers behind the ?debug=1 scroll overlay (components/ScrollDebug.jsx) — unit-tested in tests/scroll-mode.test.js.

/** events per second over a sliding window; hit() records an event, rate() reads it. `now` is injectable for tests */
export function createRateCounter({ windowMs = 1000, now = () => Date.now() } = {}) {
  let hits = [];
  const prune = (t) => { const from = t - windowMs; let i = 0; while (i < hits.length && hits[i] <= from) i += 1; if (i) hits = hits.slice(i); };
  return {
    hit() { const t = now(); hits.push(t); prune(t); },
    rate() { const t = now(); prune(t); return Math.round((hits.length * 1000) / windowMs * 10) / 10; },
    reset() { hits = []; },
  };
}

/**
 * Which element scrolls the page, from numbers read off the DOM:
 * 'document' = the usual model (window.scrollY moves); 'body' = the body is a scroll container of its own (the page scrolls INSIDE the body: window.scrollY stays 0).
 * snap = { docScrollHeight, docClientHeight, bodyScrollHeight, bodyClientHeight }
 */
export function pageScroller(snap) {
  const bodyScrolls = snap.bodyScrollHeight > snap.bodyClientHeight + 1;
  const docScrolls = snap.docScrollHeight > snap.docClientHeight + 1;
  if (bodyScrolls && !docScrolls) return 'body';
  if (docScrolls) return 'document';
  return 'none';
}

/**
 * Is the script box mounted, and if it renders as page flow (or is not there), WHY — for the overlay.
 * st = { mounted, mode ('inner'|'page'), coarse, off (the ?variant=off flag), source ('url'|'stored'|'none') }
 */
export function explainScriptBox(st) {
  if (!st.mounted) return 'not mounted: no script on screen yet (generate one, or open one from History)';
  if (st.mode === 'inner') return st.coarse ? 'mounted: INNER window (touch default)' : 'mounted: INNER window (desktop default)';
  if (st.off) return `mounted as legacy PAGE FLOW: ?variant=off is set (flags source: ${st.source}) — open ?variant=on to undo`;
  return 'mounted as PAGE FLOW although the default is the window (unexpected)';
}

/** one-line verdict for the overlay */
export function verdict({ scroller, innerMode, variant = null }) {
  const parts = [];
  if (variant) parts.push(variant === 'off' ? 'LEGACY (?variant=off)' : 'default');
  parts.push(scroller === 'body' ? 'page scroller: BODY (nested in the viewport)' : scroller === 'document' ? 'page scroller: document' : 'page scroller: none yet');
  parts.push(innerMode === 'inner' ? 'script box: INNER scroll' : 'script box: page flow');
  return parts.join(' | ');
}
