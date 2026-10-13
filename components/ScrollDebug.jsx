import React, { useEffect, useRef, useState } from 'react';
import { createRateCounter, pageScroller, verdict } from '../utils/scroll-debug.js';

/**
 * ?debug=1 overlay: read on the phone WHICH element scrolls and how busy scrolling is, to tell the iOS "shake" causes apart.
 *   page scroller   body vs document (window.scrollY stays 0 when the page scrolls INSIDE the body)
 *   scroll events/s  anywhere (capture) and on the script box; a feedback loop shows as a high, never-settling rate
 *   script box       scrollTop / scrollHeight / clientHeight (only when the box is its own scroller)
 *   visual viewport  height / offsetTop / scale (the Safari toolbar collapsing shows here)
 *   layout           how often the page height changed in the last second (a layout shift while scrolling shows here)
 * Pure display: passive listeners, no writes to the page, no network.
 */
export default function ScrollDebug() {
  const any = useRef(createRateCounter());
  const box = useRef(createRateCounter());
  const heights = useRef({ last: 0, changes: createRateCounter() });
  const [s, setS] = useState(null);

  useEffect(() => {
    const onScroll = (e) => {
      any.current.hit();
      const t = e.target;
      if (t && t.nodeType === 1 && t.hasAttribute?.('data-script-scroller')) box.current.hit();
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    const tick = () => {
      const de = document.documentElement;
      const body = document.body;
      const vv = window.visualViewport;
      const inner = document.querySelector('[data-script-scroller]');
      const h = body.scrollHeight;
      if (heights.current.last && Math.abs(h - heights.current.last) > 1) heights.current.changes.hit();
      heights.current.last = h;
      const scroller = pageScroller({ docScrollHeight: de.scrollHeight, docClientHeight: de.clientHeight, bodyScrollHeight: body.scrollHeight, bodyClientHeight: body.clientHeight });
      const mode = inner?.getAttribute('data-script-scroller') || '-';
      setS({
        verdict: verdict({ scroller, innerMode: mode, variant: inner?.getAttribute('data-script-variant') || null }),
        scrollY: Math.round(window.scrollY), bodyTop: Math.round(body.scrollTop), htmlTop: Math.round(de.scrollTop),
        evAny: any.current.rate(), evBox: box.current.rate(), layoutChanges: heights.current.changes.rate(),
        box: inner && mode === 'inner' ? `${Math.round(inner.scrollTop)} / ${inner.scrollHeight} / ${inner.clientHeight}` : 'page flow',
        boxStyle: inner && mode === 'inner' ? `h=${getComputedStyle(inner).height} overscroll-y=${getComputedStyle(inner).overscrollBehaviorY || 'n/a'}` : '-',
        flags: window.location.search || '(none)',
        vv: vv ? `${Math.round(vv.height)} (+${Math.round(vv.offsetTop)}) x${vv.scale.toFixed(2)}` : 'n/a',
        inner: window.innerHeight, doc: `${body.scrollHeight}/${body.clientHeight}`,
        rootscroll: /[?&]rootscroll=1/.test(window.location.search),
      });
    };
    tick();
    const id = setInterval(tick, 250);
    return () => { window.removeEventListener('scroll', onScroll, { capture: true }); clearInterval(id); };
  }, []);

  if (!s) return null;
  const row = (k, v) => <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ opacity: 0.6 }}>{k}</span><span>{v}</span></div>;
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed', left: 6, bottom: 'max(6px, env(safe-area-inset-bottom))', zIndex: 99998, pointerEvents: 'none',
        background: 'rgba(0,0,0,0.82)', color: '#9ef0b0', border: '1px solid rgba(158,240,176,0.4)', borderRadius: 8,
        font: '10px/1.35 ui-monospace, Menlo, monospace', padding: '6px 8px', width: 'min(300px, calc(100vw - 12px))',
      }}
    >
      <div style={{ color: '#fff', marginBottom: 2 }}>{s.verdict}{s.rootscroll ? ' | rootscroll=1' : ''}</div>
      {row('window.scrollY / body.scrollTop / html', `${s.scrollY} / ${s.bodyTop} / ${s.htmlTop}`)}
      {row('scroll events/s (any | script box)', `${s.evAny} | ${s.evBox}`)}
      {row('script box top/height/client', s.box)}
      {row('script box css', s.boxStyle)}
      {row('url flags', s.flags)}
      {row('visualViewport h (+top) scale | inner', `${s.vv} | ${s.inner}`)}
      {row('page height scrollH/clientH | changes/s', `${s.doc} | ${s.layoutChanges}`)}
    </div>
  );
}
