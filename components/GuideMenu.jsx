import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CHAPTERS, TOUR_UI, tourText } from '../constants/tour.js';
import { chapterAvailable } from '../utils/tour-logic.js';

/**
 * Chapter list under the Guide button (portal, so the navbar's overflow can't clip it). Every row is tappable: a chapter whose stage was
 * reached starts; otherwise the row says, in a readable sentence, which stage to finish first (no silent greyed-out rows on phones).
 */
export default function GuideMenu({ anchor, lang, stages, onPick, onClose }) {
  const isHe = lang === 'he';
  const ref = useRef(null);
  const [style, setStyle] = useState({});
  const [note, setNote] = useState(null); // chapter id whose "not yet" sentence is open

  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(280, window.innerWidth - 24);
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

  useEffect(() => { ref.current?.querySelector('button')?.focus({ preventScroll: true }); }, []);

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
      <p className="px-4 pt-3 pb-1 text-[10px] font-black tracking-[0.3em] uppercase text-[#d4a373]/75">{tourText(TOUR_UI.menuTitle, lang)}</p>
      {CHAPTERS.map((chapter) => {
        const available = chapterAvailable(chapter, stages);
        return (
          <button
            key={chapter.id}
            type="button"
            role="menuitem"
            aria-disabled={!available}
            onClick={() => (available ? onPick(chapter.id) : setNote(chapter.id))}
            className={`w-full text-start px-4 py-2.5 flex flex-col gap-0.5 hover:bg-[#d4a373]/10 transition-colors ${available ? '' : 'opacity-80'}`}
          >
            <span className={`text-[13px] font-bold ${available ? 'text-white' : 'text-white/60'}`}>{chapter.id}. {tourText(chapter.name, lang)}</span>
            {!available && (
              <span role={note === chapter.id ? 'status' : undefined} className={`text-[11px] leading-snug ${note === chapter.id ? 'text-[#d4a373]' : 'text-white/60'}`}>
                {tourText(note === chapter.id ? chapter.note : chapter.unavailable, lang)}
              </span>
            )}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
