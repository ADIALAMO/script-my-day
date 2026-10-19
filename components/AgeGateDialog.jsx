import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ShieldCheck, Check } from 'lucide-react';
import { ageGateCopy } from '../constants/age-gate-copy.js';
import { nextFocusIndex } from '../utils/focus-trap.js';

/**
 * One-time guest 18+ notice, shown before the first script of a visitor who is not signed in (pages/index.js decides; utils/age-gate.js stores the answer).
 * Same dialog pattern as ConfirmReplaceDialog: modal scroll lock, focus trap, Escape / backdrop / Android Back = cancel (nothing is sent). A self-declaration only.
 */
export default function AgeGateDialog({ open, lang, onConfirm, onCancel }) {
  const he = lang === 'he';
  const [checked, setChecked] = useState(false);
  const boxRef = useRef(null);
  const confirmRef = useRef(null);
  const cancelRef = useRef(null);
  const returnFocusRef = useRef(null);

  useEffect(() => { if (open) setChecked(false); }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev || 'hidden auto'; };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;
    const id = requestAnimationFrame(() => boxRef.current?.focus());
    return () => { cancelAnimationFrame(id); try { returnFocusRef.current?.focus?.(); } catch { /* element gone */ } };
  }, [open]);

  if (!open || typeof document === 'undefined') return null;

  const onKeyDown = (e) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); return; }
    if (e.key !== 'Tab') return;
    const order = [boxRef.current, ...Array.from(document.querySelectorAll('[data-age-link]')), confirmRef.current, cancelRef.current].filter((el) => el && !el.disabled);
    const at = order.indexOf(document.activeElement);
    e.preventDefault();
    order[nextFocusIndex(order.length, at, e.shiftKey)]?.focus();
  };
  const link = 'inline-flex items-center min-h-[44px] px-1 underline text-gray-400 hover:text-white';

  return createPortal(
    <div className="fixed inset-0 z-[2600] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]" onKeyDown={onKeyDown}>
      <div data-age-backdrop className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} aria-hidden="true" />
      <div
        role="dialog" aria-modal="true" aria-labelledby="age-gate-title" aria-describedby="age-gate-body"
        data-age-gate dir={he ? 'rtl' : 'ltr'}
        className={`relative w-full max-w-[380px] rounded-[2rem] bg-[#07070f] border border-[#d4a373]/25 shadow-[0_32px_90px_rgba(0,0,0,0.9)] p-6 ${he ? 'font-heebo' : ''}`}
      >
        <div className="flex items-center gap-2 mb-3 text-[#d4a373]">
          <ShieldCheck size={18} aria-hidden="true" />
          <h2 id="age-gate-title" className="text-white font-black text-[17px] leading-tight">{ageGateCopy('title', lang)}</h2>
        </div>
        <p id="age-gate-body" className="text-[13px] leading-relaxed text-white/75">{ageGateCopy('body', lang)}</p>
        <button
          ref={boxRef} type="button" role="checkbox" aria-checked={checked} onClick={() => setChecked((v) => !v)}
          className="mt-4 w-full min-h-[44px] flex items-center gap-2.5 text-start p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-[#d4a373]/30 transition-colors"
        >
          <span className={`shrink-0 w-5 h-5 rounded-[6px] border flex items-center justify-center ${checked ? 'bg-[#d4a373] border-[#d4a373]' : 'bg-transparent border-white/25'}`}>
            {checked && <Check size={13} className="text-black" />}
          </span>
          <span className="text-gray-200 text-[12px] font-bold">{ageGateCopy('checkbox', lang)}</span>
        </button>
        <p className="mt-2 text-gray-400 text-[10.5px] leading-relaxed">
          {ageGateCopy('agreeBefore', lang)}
          <a data-age-link href="/terms" target="_blank" rel="noopener noreferrer" className={link}>{ageGateCopy('terms', lang)}</a>
          {ageGateCopy('and', lang)}
          <a data-age-link href="/privacy" target="_blank" rel="noopener noreferrer" className={link}>{ageGateCopy('privacy', lang)}</a>
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button ref={confirmRef} type="button" disabled={!checked} onClick={onConfirm} style={{ minHeight: 44 }}
            className="w-full px-4 rounded-2xl bg-[#d4a373] text-black text-[13px] font-black disabled:opacity-40 disabled:cursor-not-allowed">
            {ageGateCopy('confirm', lang)}
          </button>
          <button ref={cancelRef} type="button" onClick={onCancel} style={{ minHeight: 44 }}
            className="w-full px-4 rounded-2xl border border-white/15 text-white/80 text-[13px] font-bold hover:bg-white/5">
            {ageGateCopy('cancel', lang)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
