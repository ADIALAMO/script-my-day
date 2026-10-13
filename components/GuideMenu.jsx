import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHAPTERS, TOUR_UI, tourText } from '../constants/tour.js';
import { chapterAvailable } from '../utils/tour-logic.js';

const hasAnchor = (name) => {
  const r = document.querySelector(`[data-tour="${name}"]`)?.getBoundingClientRect();
  return !!r && r.width > 0 && r.height > 0;
};

/**
 * Chapter list under the Guide button (portal, so the navbar's overflow can't clip it). A chapter whose screen is not there yet is shown
 * disabled with what to do first. Same placement approach as the account dropdown.
 */
export default function GuideMenu({ anchor, lang, onPick, onClose }) {
  const isHe = lang === 'he';
  const ref = useRef(null);
  const [style, setStyle] = useState({});
  const [items] = useState(() => CHAPTERS.map((c) => ({ chapter: c, available: chapterAvailable(c, hasAnchor) })));

  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(260, window.innerWidth - 24);
    const left = Math.min(Math.max(12, isHe ? rect.left : rect.right - width), window.innerWidth - width - 12);
    setStyle({ position: 'fixed', top: rect.bottom + 8, left, width });
  }, [anchor, isHe]);

  useEffect(() => {
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) onClose(); };
    const onKey = (e) => { if (e.key === 'Escape') { onClose(); anchor?.focus?.(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('touchstart', onDown); document.removeEventListener('keydown', onKey); };
  }, [anchor, onClose]);

  useEffect(() => { ref.current?.querySelector('button:not([disabled])')?.focus({ preventScroll: true }); }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={ref}
      style={style}
      role="menu"
      aria-label={tourText(TOUR_UI.menuTitle, lang)}
      dir={isHe ? 'rtl' : 'ltr'}
      className={`z-[9999] bg-[#0a0a12] border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] overflow-hidden ${isHe ? 'font-heebo' : ''}`}
    >
      <p className="px-4 pt-3 pb-1 text-[9px] font-black tracking-[0.3em] uppercase text-[#d4a373]/60">{tourText(TOUR_UI.menuTitle, lang)}</p>
      {items.map(({ chapter, available }) => (
        <button
          key={chapter.id}
          type="button"
          role="menuitem"
          disabled={!available}
          onClick={() => onPick(chapter.id)}
          className="w-full text-start px-4 py-2.5 flex flex-col gap-0.5 hover:bg-[#d4a373]/10 disabled:hover:bg-transparent disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <span className="text-[13px] font-bold text-white">{chapter.id}. {tourText(chapter.name, lang)}</span>
          {!available && <span className="text-[10px] text-white/50">{tourText(chapter.unavailable, lang)}</span>}
        </button>
      ))}
    </div>,
    document.body,
  );
}
