import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Flag, X } from 'lucide-react';
import { useReportContent } from '../hooks/useReportContent.js';
import { REPORT_COPY, reportText } from '../constants/report-copy.js';

const REASONS = ['sexual', 'violent', 'other'];

/**
 * Small "Report" control + bottom-sheet dialog. `sources` = the image URL(s) / data URI(s) on screen (a reel passes its frames).
 * `galleryRef` ('poster:<id>' / 'reel:<id>') reports a static gallery item: hidden for this user only, the team is notified (copy says so).
 * `dialogZ` lifts the dialog above a lightbox. The dialog renders in a portal so a transformed ancestor cannot trap its fixed overlay.
 * `scriptRef` ({genre, lang}) reports a generated SCRIPT (text): nothing is stored on our side; the caller hides the script on this device.
 * On success it calls onReported() — the caller replaces the image with a "hidden" tile.
 */
export default function ReportButton({ kind = 'panel', sources, galleryRef, scriptRef, lang, onReported, compact = false, className = '', dialogZ = 'z-[80]' }) {
  const isHebrew = lang === 'he';
  const t = (entry) => reportText(entry, isHebrew ? 'he' : 'en');
  const isScript = kind === 'script';
  const { submit, sending } = useReportContent();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('sexual');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const close = () => { setOpen(false); setError(''); };

  const send = async () => {
    setError('');
    const r = await submit({ kind, reason, sources, galleryRef, scriptRef });
    if (!r.ok) { setError(t(REPORT_COPY.errors[isScript && r.error === 'invalid' ? 'invalidScript' : r.error] || REPORT_COPY.errors.failed)); return; }
    setDone(true);
    setTimeout(() => { setOpen(false); setDone(false); onReported?.(); }, 1400);
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(true); }}
        aria-label={t(isScript ? REPORT_COPY.buttonAriaScript : REPORT_COPY.buttonAria)}
        title={t(isScript ? REPORT_COPY.buttonAriaScript : REPORT_COPY.buttonAria)}
        className={`flex items-center gap-1.5 ${compact ? `p-2 rounded-lg bg-black/55 text-white/55 hover:text-red-300${/!p-/.test(className) ? '' : " relative after:absolute after:-inset-[9px] after:content-['']"}` : 'px-3 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest text-white/35 hover:text-red-300'} transition-colors ${className}`}
      >
        <Flag size={compact ? 11 : 12} />
        {!compact && <span>{t(REPORT_COPY.button)}</span>}
      </button>

      {typeof document !== 'undefined' && createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className={`fixed inset-0 ${dialogZ} flex items-end sm:items-center justify-center bg-black/70 p-3`}
            onClick={(e) => { e.stopPropagation(); if (!sending && !done) close(); }}
            role="dialog" aria-modal="true" aria-label={t(REPORT_COPY.title[kind] || REPORT_COPY.title.panel)}
          >
            <motion.div
              initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              dir={isHebrew ? 'rtl' : 'ltr'}
              className={`w-full max-w-sm rounded-3xl border border-white/10 bg-[#0a0a12] p-5 ${isHebrew ? 'font-heebo' : ''}`}
            >
              {done ? (
                <p className="text-green-400 text-sm font-bold text-center py-6">{t(isScript ? REPORT_COPY.doneScript : galleryRef ? REPORT_COPY.doneGallery : REPORT_COPY.done)}</p>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="text-[#d4a373] font-black text-sm">{t(REPORT_COPY.title[kind] || REPORT_COPY.title.panel)}</h3>
                    <button type="button" onClick={close} disabled={sending} aria-label={t(REPORT_COPY.cancel)} className="p-1 text-white/30 hover:text-white/70"><X size={16} /></button>
                  </div>
                  <p className="text-white/50 text-xs leading-relaxed mb-4">{t(isScript ? REPORT_COPY.introScript : galleryRef ? REPORT_COPY.introGallery : REPORT_COPY.intro)}</p>
                  <div className="space-y-2 mb-4">
                    {REASONS.map((r) => (
                      <label key={r} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer text-xs ${reason === r ? 'border-[#d4a373]/60 bg-[#d4a373]/10 text-white' : 'border-white/10 text-white/60'}`}>
                        <input type="radio" name="report-reason" value={r} checked={reason === r} onChange={() => setReason(r)} className="accent-[#d4a373]" />
                        <span>{t(REPORT_COPY.reasons[r])}</span>
                      </label>
                    ))}
                  </div>
                  {error && <p role="alert" className="text-red-400 text-xs mb-3">{error}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={send} disabled={sending} className="flex-1 py-2.5 rounded-xl bg-red-500/80 text-white text-xs font-black uppercase tracking-widest disabled:opacity-50">
                      {sending ? t(REPORT_COPY.sending) : t(REPORT_COPY.send)}
                    </button>
                    <button type="button" onClick={close} disabled={sending} className="px-4 py-2.5 rounded-xl border border-white/10 text-white/60 text-xs font-black uppercase tracking-widest">
                      {t(REPORT_COPY.cancel)}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>,
      document.body)}
    </>
  );
}
