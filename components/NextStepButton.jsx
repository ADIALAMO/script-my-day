import React, { useEffect, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import { tourText } from '../constants/tour.js';

const find = (anchor) => document.querySelector(`[data-tour="${anchor}"]`);
const reduced = () => { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

/**
 * Primary "next step" pill. Renders only while `show` is true AND the target is not already on screen
 * (IntersectionObserver; without it the pill simply stays visible). Click scrolls the target below the sticky navbar.
 */
export default function NextStepButton({ show, step, lang, className = '' }) {
  const [targetSeen, setTargetSeen] = useState(false);

  useEffect(() => {
    if (!show || typeof IntersectionObserver === 'undefined') { setTargetSeen(false); return undefined; }
    let io; let tries = 0; let raf = 0;
    const attach = () => {
      const el = find(step.target);
      if (!el) { if (tries++ < 30) raf = requestAnimationFrame(attach); return; }
      io = new IntersectionObserver(([e]) => {
        setTargetSeen(e.intersectionRatio >= 0.5 || e.intersectionRect.height >= window.innerHeight * 0.5);
      }, { threshold: [0, 0.25, 0.5, 0.75, 1] });
      io.observe(el);
    };
    attach();
    return () => { cancelAnimationFrame(raf); io?.disconnect(); };
  }, [show, step.target]);

  if (!show || targetSeen) return null;

  const go = () => {
    const el = find(step.target);
    if (!el) return;
    const nav = document.querySelector('nav');
    // scrollIntoView works whichever element scrolls (the page's body has its own overflow); the margin clears the sticky navbar
    const prev = el.style.scrollMarginTop;
    el.style.scrollMarginTop = `${(nav?.offsetHeight || 0) + 16}px`;
    el.scrollIntoView({ block: 'start', behavior: reduced() ? 'auto' : 'smooth' });
    setTimeout(() => { el.style.scrollMarginTop = prev; }, 1500);
  };

  return (
    <div className={`flex justify-center px-4 ${className}`}>
      <button
        type="button"
        onClick={go}
        dir={lang === 'he' ? 'rtl' : 'ltr'}
        className={`flex items-center gap-2 px-5 py-2.5 rounded-full bg-[#d4a373] text-black text-[11px] font-black uppercase tracking-wider shadow-[0_8px_28px_rgba(212,163,115,0.25)] active:scale-95 transition-transform ${lang === 'he' ? 'font-heebo' : ''}`}
      >
        <span>{tourText(step, lang)}</span>
        <ArrowDown size={14} />
      </button>
    </div>
  );
}
