import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { GO_TO_SCRIPT_LABEL, GO_TO_SCRIPT_ARIA, GO_TO_SCRIPT_MIN_PX, scriptWindowMostlyVisible, scriptWindowDirection, shouldShowGoToScript } from '../utils/go-to-script.js';
import { scrollToScriptWindow, findScriptWindow, stickyHeaderHeight } from '../utils/scroll-to-anchor.js';

/**
 * Small floating "Go to script" pill. Appears when the typewriter starts, brings the script window into view on tap, and disappears for good (for this script)
 * once the window has been mostly visible. Hidden during poster / comic generation and while any overlay locks the page (every modal / lightbox / History sets
 * body overflow:hidden — the iOS scroll rule in CLAUDE.md). It is position:fixed, so showing or hiding it never moves the page (no layout shift); the document stays the
 * only page scroller and nothing here nests a scroller. Touch target 44 px.
 */
export default function GoToScriptButton({ typingStarted, busy, lang, resetKey }) {
  const [visible, setVisible] = useState(false);   // the window is mostly on screen right now
  const [dir, setDir] = useState('down');
  const [seen, setSeen] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const cancelRef = useRef(null);

  // a new script starts over
  useEffect(() => { setSeen(false); setVisible(false); }, [resetKey]);

  // is the window on screen? IntersectionObserver wakes the check; the decision itself is the pure rule (navbar-aware)
  useEffect(() => {
    if (!typingStarted || seen) return undefined;
    let io; let raf = 0; let tries = 0;
    const check = () => {
      const el = findScriptWindow();
      if (!el) return;
      const rect = el.getBoundingClientRect(); const navH = stickyHeaderHeight(); const vh = window.innerHeight;
      const v = scriptWindowMostlyVisible({ rect, navH, vh });
      setVisible(v); setDir(scriptWindowDirection({ rect, navH }));
      if (v) setSeen(true);
    };
    const attach = () => {
      const el = findScriptWindow();
      if (!el) { if (tries++ < 60) raf = requestAnimationFrame(attach); return; }
      check();
      if (typeof IntersectionObserver === 'undefined') return;
      io = new IntersectionObserver(check, { threshold: Array.from({ length: 21 }, (_, i) => i / 20) });
      io.observe(el);
    };
    attach();
    window.addEventListener('resize', check);
    return () => { cancelAnimationFrame(raf); io?.disconnect(); window.removeEventListener('resize', check); };
  }, [typingStarted, seen, resetKey]);

  // overlays: any modal / lightbox / History locks the body scroll (style.overflow = 'hidden')
  useEffect(() => {
    const read = () => setOverlay(document.body.style.overflow === 'hidden');
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.body, { attributes: true, attributeFilter: ['style'] });
    return () => mo.disconnect();
  }, []);

  useEffect(() => () => cancelRef.current?.(), []);

  if (!shouldShowGoToScript({ typingStarted, seen, visible, busy, overlay })) return null;

  const he = lang === 'he';
  const Arrow = dir === 'up' ? ArrowUp : ArrowDown;
  // portalled to <body>: position:fixed must not be anchored to a transformed ancestor of the script screen
  return createPortal(
    <button
      type="button"
      data-go-to-script
      onClick={() => { cancelRef.current?.(); cancelRef.current = scrollToScriptWindow(); }}
      aria-label={GO_TO_SCRIPT_ARIA[he ? 'he' : 'en']}
      dir={he ? 'rtl' : 'ltr'}
      style={{ minHeight: GO_TO_SCRIPT_MIN_PX, minWidth: GO_TO_SCRIPT_MIN_PX, bottom: 'max(16px, env(safe-area-inset-bottom, 0px))' }}
      className={`fixed end-4 z-40 flex items-center justify-center gap-2 px-4 rounded-full bg-[#d4a373] text-black text-[11px] font-black uppercase tracking-wider shadow-[0_8px_28px_rgba(0,0,0,0.45)] active:scale-95 transition-transform ${he ? 'font-heebo' : ''}`}
    >
      <span>{GO_TO_SCRIPT_LABEL[he ? 'he' : 'en']}</span>
      <Arrow size={14} aria-hidden="true" />
    </button>,
    document.body,
  );
}
