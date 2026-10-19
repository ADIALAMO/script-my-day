import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TOUR_UI, tourText, chapterById } from '../constants/tour.js';
import { findUsableAnchor, stepOutcome, chapterTotal, createStability, needsScroll, layoutFor, isUsableRect } from '../utils/tour-logic.js';

const TOUR_Z = 2400; // above the navbar (100) and page content; the tour never runs over a dialog or lightbox (they block it)
const PAD = 6;
const SETTLE_FRAMES = 3;      // the anchor must hold still this many animation frames before the spotlight shows
const SETTLE_MAX_MS = 1500;   // ...but never keep the user waiting longer than this (an anchor that animates forever)
const MANUAL_WAIT_CAP_MS = 1500; // a chapter started from the Guide menu does not wait long for anchors that are not on screen

const anchorEl = (anchor) => document.querySelector(`[data-tour="${anchor}"]`);
const anchorRect = (anchor) => { const el = anchorEl(anchor); return el ? el.getBoundingClientRect() : null; };
// Instant (never smooth) scroll that lands the anchor just under the sticky navbar: a smooth scroll on this long page takes seconds and the
// spotlight would be measured mid-flight. 'instant' throws on very old WebKit, then plain default scrolling is used.
function scrollToAnchor(el, navH) {
  const prev = el.style.scrollMarginTop;
  el.style.scrollMarginTop = `${navH + 16}px`;
  try { el.scrollIntoView({ block: 'start', behavior: 'instant' }); } catch { el.scrollIntoView({ block: 'start' }); }
  el.style.scrollMarginTop = prev;
}
const reducedMotion = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/**
 * Spotlight + bubble tour of ONE chapter over real UI. No body scroll lock (index.js owns that): the dim layer is touch-action:none instead.
 * A step shows once its anchor exists (it may still be on its way: `wait`), and is dropped silently if the anchor never comes or vanishes
 * while shown (e.g. the typewriter's Skip). An `interactive` step leaves its spotlighted control clickable.
 * onFinish('done' | 'skip') records the chapter; onAbort() closes without recording (nothing could be shown, a dialog opened).
 */
export default function GuidedTour({ chapter: chapterId, lang, manual = false, onFinish, onAbort }) {
  const isHe = lang === 'he';
  const t = (e) => tourText(e, lang);
  const chapter = chapterById(chapterId);
  const steps = chapter.steps;
  const [idx, setIdx] = useState(0);
  const [trail, setTrail] = useState([]);       // indexes of the steps shown so far, in order (Back walks it)
  const [dropped, setDropped] = useState([]);   // indexes dropped silently
  const [anchor, setAnchor] = useState(null);   // resolved anchor name while the current step is active
  const [ready, setReady] = useState(false);    // the anchor held still: spotlight + bubble may show
  const [place, setPlace] = useState(null);
  const [spot, setSpot] = useState(null);
  const bubbleRef = useRef(null);
  const nextRef = useRef(null);
  const probeRef = useRef(null);
  const frame = useRef(0);
  const live = useRef({});
  live.current = { trail, dropped, anchor };
  const step = steps[idx];

  // Layout of spotlight + bubble from the anchor's CURRENT rect (layout-viewport coordinates, like position:fixed), the visual viewport
  // offset (iOS toolbar / zoom) and the safe-area insets. Writes state only when something moved.
  const lastLayout = useRef('');
  const measureNow = useCallback(() => {
    if (!anchor) return null;
    const el = anchorEl(anchor);
    const r = el?.getBoundingClientRect();
    if (!isUsableRect(r)) return null;
    const vv = window.visualViewport;
    const vp = { w: vv?.width || window.innerWidth, h: vv?.height || window.innerHeight };
    const off = { x: vv?.offsetLeft || 0, y: vv?.offsetTop || 0 };
    const cs = probeRef.current ? getComputedStyle(probeRef.current) : null;
    const px = (v) => parseFloat(v) || 0;
    const insets = cs ? { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) } : {};
    const b = bubbleRef.current;
    const bubble = { w: b?.offsetWidth || 300, h: b?.offsetHeight || 150 };
    const { spot: sp, place: pl } = layoutFor({ rect: r, off, vp, insets, bubble, rtl: isHe, pad: PAD });
    const key = [sp.left, sp.top, sp.width, sp.height, pl.left, pl.top, pl.mode, pl.arrowLeft].map((n) => (typeof n === 'number' ? Math.round(n * 2) / 2 : n)).join('|');
    if (key !== lastLayout.current) { lastLayout.current = key; setSpot(sp); setPlace(pl); }
    return r;
  }, [anchor, isHe]);
  const measureRef = useRef(measureNow);
  measureRef.current = measureNow;

  // Poll the current step: show it when its anchor appears, drop it silently when it never comes or vanishes while shown.
  useEffect(() => {
    if (!step) { if (live.current.trail.length) onFinish?.('done'); else onAbort?.(); return undefined; }
    setAnchor(null); setSpot(null); setPlace(null); setReady(false); lastLayout.current = '';
    let over = false;
    const advance = () => {
      if (over) return;
      over = true;
      setDropped((d) => (d.includes(idx) ? d : [...d, idx]));
      setTrail((tr) => tr.filter((i) => i !== idx));
      setIdx(idx + 1);
    };
    if (live.current.dropped.includes(idx)) { advance(); return undefined; } // dropped before: never wait for it again
    const t0 = Date.now();
    let shown = false;
    let misses = 0;
    const tick = () => {
      if (over) return;
      const name = findUsableAnchor(step, anchorRect);
      if (name) misses = 0; else if (shown) misses += 1;
      const o = stepOutcome({ found: !!name, shown, elapsedMs: Date.now() - t0, waitMs: manual ? Math.min(step.wait || 0, MANUAL_WAIT_CAP_MS) : (step.wait || 0), misses });
      if (o === 'show') {
        shown = true;
        setAnchor(name);
        setTrail((tr) => (tr.includes(idx) ? tr : [...tr, idx]));
      } else if (o === 'keep') {
        if (name !== live.current.anchor) setAnchor(name);
      } else if (o === 'drop') advance();
    };
    const id = setInterval(tick, 200);
    tick();
    return () => { over = true; clearInterval(id); };
  }, [idx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Settle, then track. Show only after the anchor's rect held still for a few frames (scroll finished, entrance animations and image loads
  // done); then keep following it EVERY frame while the step is visible, so a later layout shift (images, fonts, framer-motion, the iOS
  // toolbar collapsing) moves the spotlight with it. rAF works for any scroller (body included) where scroll events may not fire.
  useEffect(() => {
    if (!anchor) return undefined;
    const tracker = createStability({ frames: SETTLE_FRAMES });
    const t0 = performance.now();
    let shown = false;
    let scrolls = 0;
    let id = 0;
    // Once the rect holds still, make sure the anchor is really visible (clear of the sticky navbar, room for the bubble): the page may have
    // scrolled itself meanwhile (e.g. the script output scrolling into view). If not, scroll INSTANTLY and settle again (at most twice).
    const settledOk = (r) => {
      if (step.fixed || scrolls >= 2) return true;
      const navH = document.querySelector('nav')?.offsetHeight || 0;
      const vh = window.visualViewport?.height || window.innerHeight;
      if (!needsScroll({ rect: r, navH, vh })) return true;
      scrolls += 1;
      scrollToAnchor(anchorEl(anchor), navH);
      tracker.reset();
      return false;
    };
    const frameFn = () => {
      const r = anchorEl(anchor)?.getBoundingClientRect();
      const settled = tracker.push(r);
      // every time the rect is still (also after the step is showing, e.g. once the page's own smooth scroll has ended) check it is clear of the navbar
      const clear = settled ? settledOk(r) : false;
      if (!shown) {
        const timedOut = isUsableRect(r) && performance.now() - t0 > SETTLE_MAX_MS;
        if ((settled && clear) || timedOut) { shown = true; measureRef.current(); setReady(true); }
      } else {
        measureRef.current();
      }
      id = requestAnimationFrame(frameFn);
    };
    id = requestAnimationFrame(frameFn);
    return () => cancelAnimationFrame(id);
  }, [anchor, step]);

  // belt and braces next to the loop: any scrollable ancestor (capture), visual viewport, resize, rotation, size changes of anchor / bubble
  useEffect(() => {
    const kick = () => measureRef.current();
    const vv = window.visualViewport;
    window.addEventListener('resize', kick);
    window.addEventListener('orientationchange', kick);
    window.addEventListener('scroll', kick, true);
    vv?.addEventListener('resize', kick);
    vv?.addEventListener('scroll', kick);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(kick) : null;
    const el = anchor && anchorEl(anchor);
    if (ro && el) ro.observe(el);
    if (ro && bubbleRef.current) ro.observe(bubbleRef.current);
    return () => {
      window.removeEventListener('resize', kick);
      window.removeEventListener('orientationchange', kick);
      window.removeEventListener('scroll', kick, true);
      vv?.removeEventListener('resize', kick);
      vv?.removeEventListener('scroll', kick);
      ro?.disconnect();
    };
  }, [anchor]);

  // Focus Next once the bubble is actually visible (on the first step of a chapter it did not exist yet when the step opened, so Enter did nothing)
  useEffect(() => { if (ready) nextRef.current?.focus({ preventScroll: true }); }, [ready, idx]);

  const go = useCallback((dir) => {
    if (dir > 0) { setIdx(idx + 1); return; }                      // past the last step the loop finishes the chapter
    const pos = trail.indexOf(idx);
    if (pos > 0) setIdx(trail[pos - 1]);
  }, [idx, trail]);

  // Esc = skip (permanent); Tab cycles inside the bubble
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onFinish?.('skip'); return; }
      if (e.key !== 'Tab') return;
      const items = bubbleRef.current ? [...bubbleRef.current.querySelectorAll('button:not([disabled])')] : [];
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      const active = document.activeElement;
      if (!bubbleRef.current.contains(active)) { e.preventDefault(); first.focus(); }
      else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onFinish]);

  if (!step || !anchor || typeof document === 'undefined') return null; // waiting for the anchor: nothing is dimmed, the page stays usable
  const last = idx === steps.length - 1;
  const total = chapterTotal(steps.length, dropped.length);
  const k = Math.max(1, trail.indexOf(idx) + 1);
  const motionOk = !reducedMotion();
  const Chev = isHe ? ChevronLeft : ChevronRight;
  const ChevBack = isHe ? ChevronRight : ChevronLeft;
  const bubbleW = 'min(320px, calc(100vw - 32px))';

  return createPortal(
    <div style={{ position: 'fixed', inset: 0, zIndex: TOUR_Z, pointerEvents: 'none' }} data-tour-layer data-tour-anchor={anchor}>
      <div ref={probeRef} aria-hidden style={{ position: 'fixed', visibility: 'hidden', pointerEvents: 'none', padding: 'env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' }} />
      {/* dim layer: swallows taps so the page underneath can't be used or scrolled mid-tour */}
      {ready && (step.interactive && spot ? (
        // the spotlighted control stays clickable: four blockers around the hole instead of one full-screen layer
        [
          { left: 0, top: 0, width: '100%', height: Math.max(0, spot.top) },
          { left: 0, top: spot.top + spot.height, width: '100%', height: '100%' },
          { left: 0, top: spot.top, width: Math.max(0, spot.left), height: spot.height },
          { left: spot.left + spot.width, top: spot.top, width: '100%', height: spot.height },
        ].map((r, i) => <div key={i} style={{ position: 'absolute', ...r, touchAction: 'none', pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()} />)
      ) : (
        <div style={{ position: 'absolute', inset: 0, touchAction: 'none', pointerEvents: 'auto' }} onClick={(e) => e.stopPropagation()} />
      ))}
      {ready && spot && (
        <div
          aria-hidden
          style={{
            position: 'fixed', left: spot.left, top: spot.top, width: spot.width, height: spot.height, borderRadius: 16, pointerEvents: 'none',
            boxShadow: '0 0 0 2px rgba(212,163,115,0.75), 0 0 24px 2px rgba(212,163,115,0.25), 0 0 0 9999px rgba(3,7,18,0.78)',
          }}
        />
      )}
      <div
        ref={bubbleRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(TOUR_UI.dialog)}
        dir={isHe ? 'rtl' : 'ltr'}
        className={`rounded-2xl border border-[#d4a373]/35 bg-[#0a0a12] p-4 shadow-[0_20px_60px_rgba(0,0,0,0.85)] ${isHe ? 'font-heebo' : ''}`}
        style={{
          position: 'fixed', width: bubbleW, left: place?.left ?? 16, top: place?.top ?? 16,
          visibility: ready && place ? 'visible' : 'hidden', pointerEvents: ready ? 'auto' : 'none', opacity: ready && place ? 1 : 0,
          transition: motionOk ? 'opacity .2s ease' : 'none', // no position transitions: the layer must stay glued to its target while the page scrolls
          textAlign: isHe ? 'right' : 'left',
        }}
      >
        {ready && place && place.mode !== 'dock' && (
          <span
            aria-hidden
            style={{
              position: 'absolute', width: 12, height: 12, background: '#0a0a12', transform: 'rotate(45deg)',
              left: place.arrowLeft - 6,
              ...(place.mode === 'bottom'
                ? { top: -7, borderTop: '1px solid rgba(212,163,115,0.35)', borderLeft: '1px solid rgba(212,163,115,0.35)' }
                : { bottom: -7, borderBottom: '1px solid rgba(212,163,115,0.35)', borderRight: '1px solid rgba(212,163,115,0.35)' }),
            }}
          />
        )}
        <p className="text-[10px] font-black tracking-[0.3em] uppercase text-[#d4a373]/75 mb-1.5">{t({ he: TOUR_UI.chapterLabel.he(chapter.id, k, total), en: TOUR_UI.chapterLabel.en(chapter.id, k, total) })}</p>
        <p aria-live="polite" className="text-[14px] leading-snug text-white/90 mb-4">{t(step.copy)}</p>
        <div className="flex items-center justify-between gap-2">
          <button type="button" onClick={() => onFinish?.('skip')} className="px-3 py-2 rounded-xl border border-white/20 text-white/80 hover:text-white hover:border-white/40 text-[11px] font-black uppercase tracking-wider transition-colors">
            {t(TOUR_UI.skip)}
          </button>
          <div className="flex items-center gap-2">
            {idx > 0 && (
              <button type="button" onClick={() => go(-1)} aria-label={t(TOUR_UI.back)} className="p-2 rounded-xl border border-white/15 text-white/60 hover:text-white transition-colors">
                <ChevBack size={16} />
              </button>
            )}
            <button ref={nextRef} type="button" onClick={() => go(1)} className="flex items-center gap-1 px-4 py-2 rounded-xl bg-[#d4a373] text-black text-xs font-black uppercase tracking-widest">
              {t(last ? TOUR_UI.done : TOUR_UI.next)}
              {!last && <Chev size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
