import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle } from 'lucide-react';
import { replaceCopy } from '../constants/replace-script-copy.js';
import { nextFocusIndex } from '../utils/focus-trap.js';

/**
 * In-app confirmation shown when "Create script" is tapped while a script is already on screen. A real in-app dialog, not the browser's confirm box.
 * Cancel (button, Escape, backdrop, Android Back via pages/index.js) changes nothing and sends nothing; Continue starts the generation.
 * Focus starts on Cancel (the safe default), Tab/Shift+Tab cycle inside the dialog, focus returns to the Create button afterwards. The page scroll uses the app's
 * existing modal lock (body overflow hidden, restored on close). The dialog is short and has no scroller of its own.
 */
export default function ConfirmReplaceDialog({ open, lang, onConfirm, onCancel }) {
  const he = lang === 'he';
  const cancelRef = useRef(null);
  const confirmRef = useRef(null);
  const returnFocusRef = useRef(null);

  // the app's modal scroll lock (same pattern as CharacterModal / the Distribution Hub)
  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev || 'hidden auto'; };
  }, [open]);

  // focus: into the dialog on open (Cancel), back to where it came from on close
  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    const id = requestAnimationFrame(() => cancelRef.current?.focus());
    return () => { cancelAnimationFrame(id); try { returnFocusRef.current?.focus?.(); } catch { /* element gone */ } };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
    if (e.key !== 'Tab') return;
    const order = [cancelRef.current, confirmRef.current].filter(Boolean);
    const at = order.indexOf(document.activeElement);
    e.preventDefault();
    order[nextFocusIndex(order.length, at, e.shiftKey)]?.focus();
  };

  return createPortal(
    <div className="fixed inset-0 z-[2600] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]" onKeyDown={onKeyDown}>
      <div data-replace-backdrop className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />
      <div
        role="alertdialog" aria-modal="true" aria-labelledby="replace-script-title" aria-describedby="replace-script-body"
        data-replace-dialog dir={he ? 'rtl' : 'ltr'}
        className={`relative w-full max-w-[380px] rounded-[2rem] bg-[#07070f] border border-[#d4a373]/25 shadow-[0_32px_90px_rgba(0,0,0,0.9)] p-6 ${he ? 'font-heebo' : ''}`}
      >
        <div className="flex items-center gap-2 mb-3 text-[#d4a373]">
          <AlertTriangle size={18} aria-hidden="true" />
          <h2 id="replace-script-title" className="text-white font-black text-[17px] leading-tight">{replaceCopy('title', lang)}</h2>
        </div>
        <div id="replace-script-body" className="space-y-2.5 text-[13px] leading-relaxed text-white/75">
          <p>{replaceCopy('lead', lang)}</p>
          <p>{replaceCopy('clears', lang)}</p>
          <p>{replaceCopy('keeps', lang)}</p>
          <p className="text-white/50">{replaceCopy('uses', lang)}</p>
        </div>
        <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2.5">
          <button ref={cancelRef} type="button" onClick={onCancel} style={{ minHeight: 44 }}
            className="flex-1 px-4 rounded-2xl border border-white/15 text-white/80 text-[13px] font-bold hover:bg-white/5">
            {replaceCopy('cancel', lang)}
          </button>
          <button ref={confirmRef} type="button" onClick={onConfirm} style={{ minHeight: 44 }}
            className="flex-1 px-4 rounded-2xl bg-[#d4a373] text-black text-[13px] font-black">
            {replaceCopy('confirm', lang)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
