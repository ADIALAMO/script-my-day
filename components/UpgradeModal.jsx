import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Crown, Check, Minus, Zap } from 'lucide-react';
import { TIER_LIMITS } from '../lib/quota.js';

// Feature rows for the Free vs Pro comparison.
// Values are read directly from TIER_LIMITS so this stays in sync automatically.
const FEATURES = [
  {
    labelEn: 'Scripts per day',
    labelHe: 'תסריטים ביום',
    free: TIER_LIMITS.free.script,
    pro:  TIER_LIMITS.pro.script,
  },
  {
    labelEn: 'Movie posters per day',
    labelHe: 'פוסטרים ביום',
    free: TIER_LIMITS.free.poster,
    pro:  TIER_LIMITS.pro.poster,
  },
  {
    labelEn: 'Comic books per day',
    labelHe: 'קומיקס ביום',
    free: TIER_LIMITS.free.comic,
    pro:  TIER_LIMITS.pro.comic,
  },
  {
    labelEn: 'Max comic panels',
    labelHe: 'מקסימום פאנלים',
    free: TIER_LIMITS.free.maxPanels,
    pro:  TIER_LIMITS.pro.maxPanels,
  },
  {
    labelEn: 'Reels generation',
    labelHe: 'יצירת רילז',
    free: false,
    pro:  true,
  },
  {
    labelEn: 'Priority rendering queue',
    labelHe: 'תור עיבוד מועדף',
    free: false,
    pro:  true,
  },
];

function FeatureValue({ value, isHe }) {
  if (value === Infinity) return (
    <span className="text-[#d4a373] font-black text-[11px] tracking-wider">
      {isHe ? 'ללא הגבלה' : 'Unlimited'}
    </span>
  );
  if (value === true)  return <Check size={13} className="text-emerald-400 mx-auto" />;
  if (value === false) return <Minus size={13} className="text-white/15 mx-auto" />;
  return <span className="text-white/70 font-bold text-[12px]">{value}</span>;
}

/**
 * Upgrade-to-Pro modal. Shown to authenticated free users.
 * The Stripe button placeholder is ready to be wired in Phase 3.
 *
 * Props:
 *   isOpen       — boolean
 *   onClose      — () => void
 *   lang         — 'en' | 'he'
 *   onStripeCheckout — () => void  (Phase 3: wire to Stripe Checkout session)
 */
export default function UpgradeModal({ isOpen, onClose, lang = 'en', onStripeCheckout }) {
  const isHe = lang === 'he';

  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  const modal = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="upgrade-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[8000] bg-black/85 backdrop-blur-md"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* Panel */}
          <div className="fixed inset-0 z-[8001] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              key="upgrade-modal"
              initial={{ opacity: 0, scale: 0.93, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 24 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              role="dialog"
              aria-modal="true"
              aria-label={isHe ? 'שדרוג לפרו' : 'Upgrade to Pro'}
              dir={isHe ? 'rtl' : 'ltr'}
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-sm pointer-events-auto"
            >
              {/* Amber glow */}
              <div className="absolute -inset-px rounded-[2.5rem] bg-gradient-to-b from-amber-500/20 to-transparent blur-sm pointer-events-none" />

              <div className="relative bg-[#080810] border border-amber-500/20 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.97)] overflow-hidden">
                {/* Amber top accent */}
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

                {/* Close */}
                <button
                  onClick={onClose}
                  aria-label={isHe ? 'סגור' : 'Close'}
                  className={`absolute top-5 z-10 text-white/25 hover:text-amber-400 transition-colors duration-200 p-1.5 rounded-full hover:bg-white/5 ${isHe ? 'left-5' : 'right-5'}`}
                >
                  <X size={18} />
                </button>

                <div className="px-7 pt-9 pb-6">
                  {/* Icon */}
                  <div className="flex justify-center mb-4">
                    <div className="relative w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.2)]">
                      <Crown className="text-amber-400 w-7 h-7" />
                    </div>
                  </div>

                  {/* Label */}
                  <p className="text-center text-[9px] font-black tracking-[0.35em] text-amber-400/50 uppercase mb-2">
                    {isHe ? 'מסלול פרו' : 'PRO PLAN'}
                  </p>

                  {/* Price */}
                  <div className="text-center mb-1">
                    <span className="text-[36px] font-black text-white leading-none">$9</span>
                    <span className="text-white/35 text-[13px] ml-1">
                      {isHe ? '/ חודש' : '/ month'}
                    </span>
                  </div>
                  <p className="text-center text-white/25 text-[11px] mb-6">
                    {isHe ? 'ביטול בכל עת' : 'Cancel anytime · No contracts'}
                  </p>

                  {/* Feature comparison table */}
                  <div className="rounded-2xl border border-white/[0.06] overflow-hidden mb-5">
                    {/* Header */}
                    <div className="grid grid-cols-3 bg-white/[0.03] border-b border-white/[0.06]">
                      <div className="px-3 py-2 text-[9px] font-black text-white/25 tracking-widest uppercase">
                        {isHe ? 'פיצ׳ר' : 'Feature'}
                      </div>
                      <div className="px-3 py-2 text-center text-[9px] font-black text-white/25 tracking-widest uppercase">
                        {isHe ? 'חינמי' : 'Free'}
                      </div>
                      <div className="px-3 py-2 text-center text-[9px] font-black text-amber-400/70 tracking-widest uppercase">
                        Pro ✦
                      </div>
                    </div>

                    {FEATURES.map((f, i) => (
                      <div
                        key={i}
                        className={`grid grid-cols-3 items-center ${i < FEATURES.length - 1 ? 'border-b border-white/[0.04]' : ''}`}
                      >
                        <div className="px-3 py-2.5 text-[11px] text-white/50 leading-tight">
                          {isHe ? f.labelHe : f.labelEn}
                        </div>
                        <div className="px-3 py-2.5 text-center">
                          <FeatureValue value={f.free} isHe={isHe} />
                        </div>
                        <div className="px-3 py-2.5 text-center bg-amber-500/[0.04]">
                          <FeatureValue value={f.pro} isHe={isHe} />
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* CTA — Phase 3: replace onClick with onStripeCheckout */}
                  <button
                    onClick={onStripeCheckout ?? undefined}
                    disabled={!onStripeCheckout}
                    className="relative w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/30 disabled:cursor-not-allowed active:scale-[0.98] text-black font-black text-[14px] px-5 py-3.5 rounded-2xl transition-all duration-150 shadow-[0_4px_20px_rgba(245,158,11,0.3)] select-none mb-3 overflow-hidden"
                  >
                    {/* Shimmer on the disabled/coming-soon state */}
                    {!onStripeCheckout && (
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse" />
                    )}
                    <Crown size={14} className="shrink-0" />
                    {onStripeCheckout
                      ? (isHe ? 'שדרג עכשיו — $9/חודש' : 'Upgrade Now — $9/month')
                      : (isHe ? '⏳ Stripe בקרוב' : '⏳ Payment coming soon')}
                  </button>

                  <p className="text-center text-white/20 text-[10px] leading-relaxed">
                    {onStripeCheckout
                      ? (isHe ? 'מאובטח על ידי Stripe. ביטול בלחיצה אחת.' : 'Secured by Stripe. Cancel in one click.')
                      : (isHe ? 'אינטגרציית Stripe היא השלב הבא בפיתוח. בקרוב!' : 'Stripe integration is the next milestone. Coming soon!')}
                  </p>
                </div>

                {/* Footer note */}
                <div className="px-7 pt-3 pb-5 border-t border-white/[0.04]">
                  <div className="flex items-center gap-2 justify-center">
                    <Zap size={10} className="text-amber-400/40" />
                    <p className="text-[10px] text-white/20 italic">
                      {isHe
                        ? '"בנוי על ידי אדם אחד שרצה לראות את חייו כסרט. עכשיו אתה יכול לראות את שלך."'
                        : '"Built by one person who wanted to see their life as a movie. Now you can see yours."'}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(modal, document.body);
}
