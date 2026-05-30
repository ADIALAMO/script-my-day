import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clapperboard } from 'lucide-react';
import { useRotatingMessages } from '../hooks/useRotatingMessages.js';

// ── Hollywood microcopy ───────────────────────────────────────────────────────

const QUOTES_EN = [
  "Writing a multi-million dollar third act plot twist...",
  "Bribing the lead actor's agent with espresso...",
  "Fixing it in post-production...",
  "Arguing with the studio executives over the budget...",
  "Negotiating streaming rights with three platforms simultaneously...",
  "Waiting for the director's 47th take on this exact moment...",
  "The writers' room just ordered their 6th pizza of the night...",
  "Consulting with the Cannes jury on narrative structure...",
  "Convincing the star to do the sequel for half the money...",
  "Running final ADR — the mic is too close to the craft table...",
  "Sourcing authentic period typewriters for the flashback scenes...",
  "The executive producer is on a 'creative retreat' in Malibu...",
  "Demanding the cinematographer reshoot the entire first act...",
  "The craft services budget ran out at the most critical scene...",
];

const QUOTES_HE = [
  "כותב עיקול עלילתי של מאות מיליוני דולרים...",
  "שוחד לסוכן של השחקן הראשי בקפה אספרסו...",
  "מתקן את הכול בפוסט-פרודקשן...",
  "ויכוח עם מנהלי האולפן על התקציב...",
  "מנהלים משא ומתן על זכויות סטרימינג עם שלוש פלטפורמות במקביל...",
  "מחכים לצילום ה-47 של הסצנה הזאת...",
  "חדר התסריטאים הזמין את הפיצה השישית של הלילה...",
  "מתייעצים עם חבר השופטים של קאן על המבנה הנרטיבי...",
  "מנסים לשכנע את הכוכב לעשות את הסרט הבא בחצי שכר...",
  "מריצים ADR אחרון — המיקרופון קרוב מדי לשולחן הקייטרינג...",
  "מחפשים מכונות כתיבה וינטאג׳ אותנטיות לסצנות הפלאשבק...",
  "המפיק הראשי נמצא ב׳ריטריט יצירתי׳ במליבו...",
  "הבמאי מבקש לצלם מחדש את כל המערכה הראשונה...",
  "תקציב הקייטרינג נגמר בדיוק בסצנה הכי חשובה...",
];

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Compact bottom status bar — renders as a fixed floating pill at the bottom
 * of the viewport. Does NOT overlay the page content.
 *
 * Props:
 *   isVisible      — drives AnimatePresence mount/unmount
 *   lang           — 'en' | 'he'
 *   producerName   — shown nowhere now, kept for API compat
 *   onCancel       — if provided, a cancel button appears after 3 s
 *   phase          — 'script' | 'storyboard' — changes the status label
 */
export default function CinematicLoader({
  isVisible,
  lang = 'en',
  producerName = '',
  onCancel,
  phase = 'script',
}) {
  const isHebrew = lang === 'he';
  const quotes   = isHebrew ? QUOTES_HE : QUOTES_EN;
  const quote    = useRotatingMessages(quotes, 2500, isVisible);

  const statusLabel = phase === 'storyboard'
    ? (isHebrew ? 'מפיק קומיקס...'  : 'COMPOSING...')
    : (isHebrew ? 'בהפקה...'        : 'IN PRODUCTION...');

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="cinematic-loader"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          // Floating pill fixed to bottom of viewport.
          // pointer-events-none so the page stays interactive; cancel btn re-enables.
          className="fixed bottom-6 left-4 right-4 z-[90] pointer-events-none"
          style={{ maxWidth: 560, margin: '0 auto' }}
        >
          <div
            className="relative rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(3,7,18,0.96)',
              border: '1px solid rgba(255,255,255,0.07)',
              boxShadow: '0 16px 48px rgba(0,0,0,0.72), 0 0 0 1px rgba(212,163,115,0.05)',
            }}
          >
            {/* Shimmer line along top edge */}
            <div className="absolute top-0 left-0 right-0 h-[1.5px] overflow-hidden">
              <motion.div
                className="absolute top-0 h-full w-[55%]"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(212,163,115,0.55), transparent)',
                }}
                animate={{ x: ['-100%', '270%'] }}
                transition={{ duration: 2.4, repeat: Infinity, ease: 'linear' }}
              />
            </div>

            {/* Single content row */}
            <div className={`flex items-center gap-3 px-4 py-[11px] ${isHebrew ? 'flex-row-reverse' : ''}`}>

              {/* Pulsing clapperboard icon */}
              <motion.div
                animate={{ opacity: [0.45, 1, 0.45] }}
                transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                className="shrink-0"
              >
                <Clapperboard size={14} strokeWidth={1.6} className="text-[#d4a373]" />
              </motion.div>

              {/* Status label */}
              <span
                className="shrink-0 text-[7.5px] font-black uppercase tracking-[0.24em]"
                style={{ color: 'rgba(212,163,115,0.65)' }}
              >
                {statusLabel}
              </span>

              {/* Separator */}
              <span className="shrink-0 text-[7px]" style={{ color: 'rgba(255,255,255,0.14)' }}>·</span>

              {/* Rotating quote — truncated to a single line */}
              <div className="flex-1 min-w-0 overflow-hidden">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={quote}
                    initial={{ opacity: 0, x: isHebrew ? -6 : 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: isHebrew ? 6 : -6 }}
                    transition={{ duration: 0.28, ease: 'easeOut' }}
                    className="text-[9.5px] font-light truncate"
                    style={{
                      color: 'rgba(255,255,255,0.35)',
                      fontFamily: "'Courier Prime','Courier New',monospace",
                      direction: isHebrew ? 'rtl' : 'ltr',
                    }}
                  >
                    {quote}
                  </motion.p>
                </AnimatePresence>
              </div>

              {/* Pulse dots */}
              <div className="flex gap-[3px] shrink-0">
                {[0, 0.35, 0.7].map((delay, i) => (
                  <motion.div
                    key={i}
                    className="w-[3.5px] h-[3.5px] rounded-full"
                    style={{ background: 'rgba(212,163,115,0.45)' }}
                    animate={{ opacity: [0.2, 1, 0.2], scale: [0.8, 1.25, 0.8] }}
                    transition={{ duration: 1.1, repeat: Infinity, delay, ease: 'easeInOut' }}
                  />
                ))}
              </div>

              {/* Cancel button — appears after 3 s, pointer-events re-enabled */}
              {onCancel && (
                <motion.button
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 3, duration: 0.35 }}
                  onClick={onCancel}
                  className="pointer-events-auto shrink-0 flex items-center gap-1 px-2.5 py-[5px] rounded-full text-[7px] font-black uppercase tracking-widest transition-colors duration-200"
                  style={{
                    border: '1px solid rgba(239,68,68,0.22)',
                    background: 'rgba(239,68,68,0.06)',
                    color: 'rgba(248,113,113,0.55)',
                  }}
                  onMouseEnter={e => {
                    e.currentTarget.style.color = 'rgba(248,113,113,0.9)';
                    e.currentTarget.style.borderColor = 'rgba(239,68,68,0.45)';
                    e.currentTarget.style.background = 'rgba(239,68,68,0.10)';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.color = 'rgba(248,113,113,0.55)';
                    e.currentTarget.style.borderColor = 'rgba(239,68,68,0.22)';
                    e.currentTarget.style.background = 'rgba(239,68,68,0.06)';
                  }}
                >
                  <X size={7} />
                  {isHebrew ? 'בטל' : 'CANCEL'}
                </motion.button>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
