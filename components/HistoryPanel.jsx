import React, { memo, useEffect, useCallback, useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clapperboard, Trash2, Film, Clock, ChevronRight } from 'lucide-react';
import { getGenreMeta, FALLBACK_GENRE_META as FALLBACK_GENRE } from '../constants/genres.js';

// ─── Pure helpers ────────────────────────────────────────────────────────────
function getRelativeTime(ts, lang) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(diff / 86_400_000);
  if (m < 1)   return lang === 'he' ? 'עכשיו'            : 'Just now';
  if (m < 60)  return lang === 'he' ? `לפני ${m} דק׳`   : `${m}m ago`;
  if (h < 24)  return lang === 'he' ? `לפני ${h} שע׳`   : `${h}h ago`;
  if (d === 1) return lang === 'he' ? 'אתמול'            : 'Yesterday';
  if (d < 7)   return lang === 'he' ? `לפני ${d} ימים`  : `${d}d ago`;
  return new Date(ts).toLocaleDateString(
    lang === 'he' ? 'he-IL' : 'en-US',
    { month: 'short', day: 'numeric' }
  );
}

function extractTitle(script) {
  if (!script) return '—';
  const lines = script.split('\n').map(l => l.trim()).filter(Boolean);
  let t = lines[0] || '—';
  if (/^(תסריט|script|screenplay|scene|סצנה)[:\s-]*$/i.test(t)) t = lines[1] || t;
  return t.replace(/[*#_:]/g, '').replace(/\[.*?\]/g, '').trim().slice(0, 52) || '—';
}

// ─── Empty state ─────────────────────────────────────────────────────────────
function EmptyState({ lang }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15, ease: 'easeOut' }}
      className="flex flex-col items-center justify-center h-full min-h-[360px] px-8 text-center select-none"
    >
      {/* Animated clapperboard */}
      <div className="relative mb-8">
        <div className="w-[72px] h-[72px] rounded-[1.5rem] bg-[#d4a373]/5 border border-[#d4a373]/10 flex items-center justify-center">
          <motion.div
            animate={{ rotate: [0, -12, 4, 0] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut', repeatDelay: 3.5 }}
            style={{ transformOrigin: '50% 90%' }}
          >
            <Clapperboard size={30} className="text-[#d4a373]/25" strokeWidth={1.5} />
          </motion.div>
        </div>
        {/* Pulse ring */}
        <motion.div
          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 0, 0.5] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeOut' }}
          className="absolute inset-0 rounded-[1.5rem] border border-[#d4a373]/20"
        />
        {/* Status dot */}
        <div className="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#080810] border border-[#d4a373]/20 flex items-center justify-center">
          <motion.div
            animate={{ opacity: [0.3, 0.9, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
            className="w-1.5 h-1.5 rounded-full bg-[#d4a373]/50"
          />
        </div>
      </div>

      <h3 className="text-[#d4a373]/45 font-black text-[9px] uppercase tracking-[0.55em] mb-3">
        {lang === 'he' ? 'אין הפקות קודמות' : 'No Past Productions'}
      </h3>

      <p className="text-gray-600 text-[10.5px] leading-relaxed max-w-[188px]">
        {lang === 'he'
          ? 'התסריטים שלך יישמרו כאן אוטומטית לאחר כל הפקה'
          : 'Your scripts are saved here automatically after each generation'}
      </p>

      {/* Decorative divider */}
      <div className="mt-9 flex items-center gap-3 w-28">
        <div className="flex-1 h-[1px] bg-[#d4a373]/10" />
        <div className="w-1 h-1 rounded-full bg-[#d4a373]/20" />
        <div className="flex-1 h-[1px] bg-[#d4a373]/10" />
      </div>
      <p className="mt-4 text-[7.5px] text-gray-700 tracking-[0.65em] uppercase">
        LIFESCRIPT STUDIO
      </p>
    </motion.div>
  );
}

// ─── HistoryItem ─────────────────────────────────────────────────────────────
const HistoryItem = memo(function HistoryItem({ entry, onReload, onDelete, lang, isLast }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const confirmTimer = useRef(null);
  const gm = getGenreMeta(entry.genre);

  useEffect(() => () => clearTimeout(confirmTimer.current), []);

  const handleDeleteClick = useCallback((e) => {
    e.stopPropagation();
    if (isConfirming) {
      clearTimeout(confirmTimer.current);
      onDelete(entry.id);
    } else {
      setIsConfirming(true);
      confirmTimer.current = setTimeout(() => setIsConfirming(false), 3000);
    }
  }, [isConfirming, onDelete, entry.id]);

  const title = extractTitle(entry.script);
  const relTime = getRelativeTime(entry.createdAt, lang);
  const genreLabel = gm.label[lang] ?? gm.label.en;
  const isRtl = lang === 'he';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 28 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 44, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 340, damping: 28 }}
      className={`group relative ${!isLast ? 'border-b border-white/[0.04]' : ''}`}
    >
      {/* Delete-confirm tint — CSS transition, no AnimatePresence overhead */}
      <div
        className="absolute inset-0 pointer-events-none transition-all duration-300 rounded-none"
        style={{
          background: isConfirming ? 'rgba(239,68,68,0.06)' : 'transparent',
          borderLeft: isConfirming ? '2px solid rgba(239,68,68,0.35)' : '2px solid transparent',
        }}
      />

      {/* ── Main clickable row ─────────────────────────────────────────────── */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onReload(entry)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onReload(entry)}
        className="flex gap-3 p-4 pr-11 items-center cursor-pointer
          hover:bg-white/[0.022] active:bg-[#d4a373]/[0.04]
          transition-colors duration-150 outline-none
          focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#d4a373]/30
          relative z-[1]"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        {/* Thumbnail / genre placeholder */}
        <div
          className="shrink-0 relative w-11 rounded-xl overflow-hidden"
          style={{
            aspectRatio: '2 / 3',
            background: gm.bg,
            border: `1px solid ${gm.border}`,
          }}
        >
          {/* Icon fallback — always rendered beneath the img */}
          <div className="absolute inset-0 flex items-center justify-center">
            <Film size={13} style={{ color: gm.color, opacity: 0.45 }} />
          </div>
          {entry.posterUrl && (
            <img
              src={entry.posterUrl}
              alt=""
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
              onError={(e) => { e.currentTarget.style.display = 'none'; }}
            />
          )}
        </div>

        {/* Text content */}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          {/* Genre chip + timestamp */}
          <div className={`flex items-center gap-2 ${isRtl ? 'flex-row-reverse' : ''}`}>
            <span className={`text-[7px] font-black uppercase tracking-wider px-1.5 py-[3px] rounded-md ${gm.chipCls}`}>
              {genreLabel}
            </span>
            <span className={`flex items-center gap-1 text-[8.5px] text-gray-600 shrink-0 ${isRtl ? '' : 'ml-auto'}`}>
              <Clock size={7.5} className="opacity-50" />
              {relTime}
            </span>
          </div>

          {/* Script title */}
          <p
            className={`text-[10.5px] text-white/65 truncate leading-snug ${
              isRtl ? 'text-right' : 'text-left script-font'
            }`}
            title={title}
          >
            {title}
          </p>

          {/* Original journal preview — the raw diary this script was born from */}
          {entry.journalEntry && (
            <p
              className={`text-[8.5px] text-gray-600/70 italic truncate leading-snug ${isRtl ? 'text-right' : 'text-left'}`}
              title={entry.journalEntry}
            >
              📓 {entry.journalEntry}
            </p>
          )}

          {/* Producer credit */}
          {entry.producerName && (
            <p className={`text-[8px] text-[#d4a373]/28 uppercase tracking-widest truncate ${isRtl ? 'text-right' : ''}`}>
              {isRtl ? `בימוי: ${entry.producerName}` : `DIR: ${entry.producerName}`}
            </p>
          )}
        </div>

        {/* Reload chevron — subtle directional hint */}
        <ChevronRight
          size={12}
          className={`shrink-0 text-[#d4a373]/15 group-hover:text-[#d4a373]/45
            group-hover:translate-x-0.5 transition-all duration-300
            ${isRtl ? 'rotate-180 group-hover:-translate-x-0.5 group-hover:translate-x-0' : ''}`}
        />
      </div>

      {/* ── Delete button — absolute, outside div[role=button] ─────────────── */}
      <button
        className={`close-button absolute top-1/2 -translate-y-1/2 right-3 z-[2]
          p-[7px] rounded-lg transition-all duration-250
          ${isConfirming
            ? 'bg-red-500/18 text-red-400 scale-110'
            : 'text-gray-700 opacity-60 md:opacity-0 md:group-hover:opacity-100 hover:text-red-400 hover:bg-red-500/12'
          }`}
        onClick={handleDeleteClick}
        title={
          isConfirming
            ? (isRtl ? 'לחץ שוב למחיקה' : 'Tap again to delete')
            : (isRtl ? 'מחק' : 'Delete')
        }
        aria-label={isRtl ? 'מחק הפקה' : 'Delete production'}
      >
        <Trash2 size={11} />
      </button>

      {/* Confirm hint ribbon */}
      <AnimatePresence>
        {isConfirming && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="text-[8px] text-red-400/60 text-center tracking-widest uppercase overflow-hidden pb-2"
          >
            {isRtl ? '← לחץ שוב למחיקה' : 'Tap delete again to confirm →'}
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

// ─── HistoryPanel ─────────────────────────────────────────────────────────────
function HistoryPanel({ isOpen, onClose, history, onReload, onDelete, lang }) {
  // Prevent body scroll while panel is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Escape key closes the panel
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Closing the panel after reload is the parent's responsibility via onReload,
  // but we wire it here so the item doesn't need to know about the panel.
  const handleReload = useCallback((entry) => {
    onReload(entry);
    onClose();
  }, [onReload, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── Backdrop ──────────────────────────────────────────────────── */}
          <motion.div
            key="history-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[300] bg-black/55 backdrop-blur-[2px]"
            aria-hidden="true"
            onClick={onClose}
          />

          {/* ── Drawer ────────────────────────────────────────────────────── */}
          <motion.aside
            key="history-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 390, damping: 42, mass: 0.85 }}
            className="fixed right-0 top-0 bottom-0 z-[310]
              w-full md:w-[375px]
              flex flex-col
              bg-[#080810]/97 backdrop-blur-3xl
              border-l border-[#d4a373]/10
              shadow-[-28px_0_80px_rgba(0,0,0,0.75)]"
            aria-label={lang === 'he' ? 'ארכיון הפקות' : 'Production Archive'}
            role="complementary"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Top safe-area spacer (iOS notch) */}
            <div className="shrink-0 h-[env(safe-area-inset-top,0px)]" />

            {/* ── Header ──────────────────────────────────────────────────── */}
            <div
              className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-white/[0.055]"
              dir={lang === 'he' ? 'rtl' : 'ltr'}
            >
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/15 flex items-center justify-center shrink-0">
                  <Clapperboard size={14} className="text-[#d4a373]" strokeWidth={2} />
                </div>
                <div>
                  <h2 className="text-white font-black text-[10.5px] uppercase tracking-[0.3em]">
                    {lang === 'he' ? 'ארכיון הפקות' : 'PRODUCTION ARCHIVE'}
                  </h2>
                  {history.length > 0 && (
                    <p className="text-[#d4a373]/35 text-[8px] tracking-widest mt-0.5 uppercase">
                      {lang === 'he'
                        ? `${history.length} תסריטים שמורים`
                        : `${history.length} ${history.length === 1 ? 'script' : 'scripts'} saved`}
                    </p>
                  )}
                </div>
              </div>

              <button
                onClick={onClose}
                className="close-button p-2 rounded-xl text-gray-600
                  hover:text-[#d4a373] hover:bg-[#d4a373]/10
                  transition-all duration-300"
                aria-label={lang === 'he' ? 'סגור' : 'Close'}
              >
                <X size={17} />
              </button>
            </div>

            {/* ── Scrollable list ──────────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {history.length === 0 ? (
                <EmptyState lang={lang} />
              ) : (
                <AnimatePresence mode="popLayout" initial={false}>
                  {history.map((entry, index) => (
                    <HistoryItem
                      key={entry.id}
                      entry={entry}
                      onReload={handleReload}
                      onDelete={onDelete}
                      lang={lang}
                      isLast={index === history.length - 1}
                    />
                  ))}
                </AnimatePresence>
              )}
            </div>

            {/* ── Footer ───────────────────────────────────────────────────── */}
            {history.length > 0 && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="shrink-0 px-5 py-3 border-t border-white/[0.04]"
              >
                <p className="text-[7.5px] text-gray-700 text-center tracking-[0.5em] uppercase">
                  {lang === 'he'
                    ? 'נשמר מקומית · עד 20 הפקות'
                    : 'Saved locally · Up to 20 productions'}
                </p>
              </motion.div>
            )}

            {/* Bottom safe-area spacer (iOS home indicator) */}
            <div className="shrink-0 h-[env(safe-area-inset-bottom,0px)]" />
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}

export default HistoryPanel;
