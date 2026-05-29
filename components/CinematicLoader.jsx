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

// ── Film strip — scrolling perforations ──────────────────────────────────────
// Renders as a narrow column on the left or right edge of the parent container.
// Uses absolute inset-y positioning, so it adapts to any container height.

const HOLE_H = 52;

function FilmStrip({ side }) {
  return (
    <div
      aria-hidden="true"
      className={`absolute inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} w-6 sm:w-8 overflow-hidden`}
      style={{
        background: '#030303',
        [side === 'left' ? 'borderRight' : 'borderLeft']: '1px solid rgba(255,255,255,0.05)',
      }}
    >
      <motion.div
        className="absolute top-0 left-0 right-0 flex flex-col items-center"
        animate={{ y: `-${HOLE_H}px` }}
        initial={{ y: '0px' }}
        transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
      >
        {Array.from({ length: 80 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: HOLE_H, width: '100%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <div style={{
              width: 11, height: 17,
              background: 'rgba(0,0,0,0.9)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: 2,
            }} />
          </div>
        ))}
      </motion.div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Inline cinematic loader — renders as `absolute inset-0` over its parent.
 *
 * The parent MUST have `position: relative` and ideally `overflow: hidden`
 * so the film strips and blur are clipped correctly.
 *
 * Props:
 *   isVisible      — drives AnimatePresence mount/unmount
 *   lang           — 'en' | 'he'
 *   producerName   — shown in the director credit line
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
    ? (isHebrew ? 'מפיק קומיקס...'  : 'COMPOSING STORYBOARD...')
    : (isHebrew ? 'בהפקה...'        : 'IN PRODUCTION...');

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          key="cinematic-loader"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          // Inline overlay — covers the parent container only, not the viewport.
          // Parent must be position:relative + overflow:hidden.
          className="absolute inset-0 z-[50] overflow-hidden bg-black/90 backdrop-blur-md"
        >
          {/* Subtle film-flicker overlay */}
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 bg-white pointer-events-none"
            animate={{ opacity: [0, 0.012, 0, 0.008, 0, 0.014, 0] }}
            transition={{ duration: 6, repeat: Infinity, times: [0, 0.08, 0.16, 0.5, 0.58, 0.82, 1] }}
          />

          {/* Vertical film strips — left and right edges */}
          <FilmStrip side="left" />
          <FilmStrip side="right" />

          {/* ── Centre content ───────────────────────────────────────────── */}
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-10 sm:px-14 pb-6 text-center pointer-events-none">

            {/* Clapperboard — slow breathe pulse */}
            <motion.div
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
              className="w-[68px] h-[68px] rounded-[1.5rem] flex items-center justify-center shrink-0"
              style={{
                background: 'rgba(212,163,115,0.07)',
                border: '1px solid rgba(212,163,115,0.2)',
                boxShadow: '0 0 32px rgba(212,163,115,0.07)',
              }}
            >
              <Clapperboard size={30} strokeWidth={1.5} className="text-[#d4a373]" />
            </motion.div>

            {/* Studio + status labels */}
            <div className="space-y-1.5">
              <p className="text-[7.5px] font-black tracking-[0.55em] uppercase"
                 style={{ color: 'rgba(212,163,115,0.38)' }}>
                LIFESCRIPT STUDIO
              </p>
              <p className="text-[9.5px] font-black tracking-[0.3em] uppercase"
                 style={{ color: 'rgba(255,255,255,0.16)' }}>
                {statusLabel}
              </p>
            </div>

            {/* Rotating Hollywood quote */}
            <div className="min-h-[60px] flex items-center justify-center w-full max-w-[260px] sm:max-w-sm">
              <AnimatePresence mode="wait">
                <motion.p
                  key={quote}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.36, ease: 'easeOut' }}
                  className="text-[13px] sm:text-sm font-light italic leading-relaxed"
                  style={{
                    color: 'rgba(255,255,255,0.58)',
                    fontFamily: "'Courier Prime','Courier New',monospace",
                    direction: isHebrew ? 'rtl' : 'ltr',
                  }}
                >
                  &ldquo;{quote}&rdquo;
                </motion.p>
              </AnimatePresence>
            </div>

            {/* Director credit */}
            {producerName && (
              <p className="text-[7.5px] tracking-[0.35em] uppercase"
                 style={{ color: 'rgba(255,255,255,0.13)' }}>
                {isHebrew
                  ? `בימוי: ${producerName}`
                  : `DIRECTED BY ${producerName.toUpperCase()}`}
              </p>
            )}
          </div>

          {/* Cancel button — pointer-events re-enabled, appears after 3 s */}
          {onCancel && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 3, duration: 0.4 }}
              className="absolute bottom-6 left-0 right-0 flex justify-center pointer-events-auto"
            >
              <button
                onClick={onCancel}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full text-[8.5px] font-black uppercase tracking-widest transition-all duration-250"
                style={{
                  border: '1px solid rgba(239,68,68,0.22)',
                  background: 'rgba(239,68,68,0.06)',
                  color: 'rgba(248,113,113,0.52)',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.color = 'rgba(248,113,113,0.88)';
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.45)';
                  e.currentTarget.style.background = 'rgba(239,68,68,0.10)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.color = 'rgba(248,113,113,0.52)';
                  e.currentTarget.style.borderColor = 'rgba(239,68,68,0.22)';
                  e.currentTarget.style.background = 'rgba(239,68,68,0.06)';
                }}
              >
                <X size={9} />
                {isHebrew ? 'בטל הפקה' : 'CANCEL PRODUCTION'}
              </button>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
