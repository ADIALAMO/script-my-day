import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Crown, Check, Minus, Zap, Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import { TIER_LIMITS } from '../lib/quota.js';

// Feature rows — values read from TIER_LIMITS so this stays in sync automatically.
const FEATURES = [
  { labelEn: 'Scripts per day',       labelHe: 'תסריטים ביום',      free: TIER_LIMITS.free.script,    pro: TIER_LIMITS.pro.script    },
  { labelEn: 'Movie posters per day', labelHe: 'פוסטרים ביום',      free: TIER_LIMITS.free.poster,    pro: TIER_LIMITS.pro.poster    },
  { labelEn: 'Comic books per day',   labelHe: 'קומיקס ביום',       free: TIER_LIMITS.free.comic,     pro: TIER_LIMITS.pro.comic     },
  { labelEn: 'Max comic panels',      labelHe: 'מקסימום פאנלים',    free: TIER_LIMITS.free.unlockedPanels, pro: TIER_LIMITS.pro.unlockedPanels },
  { labelEn: 'Reels generation',      labelHe: 'יצירת רילז',        free: false,                      pro: true                      },
  { labelEn: 'Priority queue',        labelHe: 'תור עיבוד מועדף',   free: false,                      pro: true                      },
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
 * Upgrade-to-Pro modal for authenticated free users.
 * Owns the full checkout flow: POST /api/checkout → redirect to Stripe.
 *
 * Checkout states:
 *   idle       — default, button active
 *   loading    — waiting for /api/checkout response
 *   redirecting — session URL received, navigating to Stripe
 *   already_pro — 409: user is already subscribed
 *   error      — 401 / 5xx / network failure
 *
 * Props:
 *   isOpen  — boolean
 *   onClose — () => void
 *   lang    — 'en' | 'he'
 */
export default function UpgradeModal({ isOpen, onClose, lang = 'en' }) {
  const isHe = lang === 'he';

  // 'idle' | 'loading' | 'redirecting' | 'already_pro' | 'error'
  const [checkoutState, setCheckoutState] = useState('idle');
  const [errorMsg, setErrorMsg]           = useState('');

  // Reset internal state every time the modal opens so stale error/loading
  // states from a previous session don't bleed through.
  useEffect(() => {
    if (isOpen) {
      setCheckoutState('idle');
      setErrorMsg('');
    }
  }, [isOpen]);

  // Scroll lock is handled by index.js's global anyOpen effect, which tracks
  // showUpgradeModal. A duplicate lock here causes a race: this cleanup runs
  // after index.js restores '', overwriting it back to 'hidden'. Removed.

  const handleUpgrade = async () => {
    setCheckoutState('loading');
    setErrorMsg('');

    try {
      const res  = await fetch('/api/checkout', { method: 'POST' });
      const data = await res.json();

      if (res.status === 401) {
        setCheckoutState('error');
        setErrorMsg(isHe
          ? 'יש להתחבר לחשבון כדי לשדרג.'
          : 'Please sign in before upgrading.'
        );
        return;
      }

      if (res.status === 409 && data.code === 'ALREADY_PRO') {
        setCheckoutState('already_pro');
        return;
      }

      if (!res.ok || !data.url) {
        throw new Error(data.error || 'Unexpected server response.');
      }

      // Show a brief "Redirecting…" state so the user knows something is
      // happening before the page navigates away.
      setCheckoutState('redirecting');
      window.location.href = data.url;

    } catch (err) {
      console.error('Checkout initiation error:', err.message);
      setCheckoutState('error');
      setErrorMsg(isHe
        ? 'אירעה שגיאה. אנא נסה שוב.'
        : 'Something went wrong. Please try again.'
      );
    }
  };

  const isButtonBusy = checkoutState === 'loading' || checkoutState === 'redirecting';

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
            onClick={!isButtonBusy ? onClose : undefined}
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
              {/* Amber outer glow */}
              <div className="absolute -inset-px rounded-[2.5rem] bg-gradient-to-b from-amber-500/20 to-transparent blur-sm pointer-events-none" />

              <div className="relative bg-[#080810] border border-amber-500/20 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.97)] overflow-hidden">
                {/* Amber top accent line */}
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

                {/* Close — locked while checkout is in flight */}
                {!isButtonBusy && (
                  <button
                    onClick={onClose}
                    aria-label={isHe ? 'סגור' : 'Close'}
                    className={`absolute top-5 z-10 text-white/25 hover:text-amber-400 transition-colors duration-200 p-1.5 rounded-full hover:bg-white/5 ${isHe ? 'left-5' : 'right-5'}`}
                  >
                    <X size={18} />
                  </button>
                )}

                <div className="px-7 pt-9 pb-6">
                  {/* Crown icon */}
                  <div className="flex justify-center mb-4">
                    <div className="relative w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.2)]">
                      <Crown className="text-amber-400 w-7 h-7" />
                    </div>
                  </div>

                  {/* Label + price */}
                  <p className="text-center text-[9px] font-black tracking-[0.35em] text-amber-400/50 uppercase mb-2">
                    {isHe ? 'מסלול פרו' : 'PRO PLAN'}
                  </p>
                  <div className="text-center mb-1">
                    <span className="text-[36px] font-black text-white leading-none">$9</span>
                    <span className="text-white/35 text-[13px] ml-1">
                      {isHe ? '/ חודש' : '/ month'}
                    </span>
                  </div>
                  <p className="text-center text-white/25 text-[11px] mb-6">
                    {isHe ? 'ביטול בכל עת · ללא חוזים' : 'Cancel anytime · No contracts'}
                  </p>

                  {/* Feature comparison table */}
                  <div className="rounded-2xl border border-white/[0.06] overflow-hidden mb-5">
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

                  {/* ── Already Pro state ── */}
                  {checkoutState === 'already_pro' && (
                    <div className="mb-4 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-center">
                      <p className="text-amber-400 text-[12px] font-bold mb-1">
                        {isHe ? '✦ אתה כבר חבר פרו!' : '✦ You are already Pro!'}
                      </p>
                      <p className="text-white/35 text-[11px]">
                        {isHe ? 'רענן את הדף כדי לראות את הסטטוס המעודכן.' : 'Refresh the page to see your updated status.'}
                      </p>
                      <button
                        onClick={() => window.location.reload()}
                        className="mt-2 flex items-center gap-1.5 mx-auto text-amber-400/60 hover:text-amber-400 text-[11px] transition-colors"
                      >
                        <RefreshCw size={11} />
                        {isHe ? 'רענן' : 'Refresh'}
                      </button>
                    </div>
                  )}

                  {/* ── Error state ── */}
                  {checkoutState === 'error' && errorMsg && (
                    <div className="mb-4 p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-start gap-2.5">
                      <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-red-400/90 text-[12px] leading-snug">{errorMsg}</p>
                    </div>
                  )}

                  {/* ── CTA button ── */}
                  {checkoutState !== 'already_pro' && (
                    <button
                      onClick={handleUpgrade}
                      disabled={isButtonBusy}
                      className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/40 disabled:cursor-not-allowed active:scale-[0.98] text-black font-black text-[14px] px-5 py-3.5 rounded-2xl transition-all duration-150 shadow-[0_4px_20px_rgba(245,158,11,0.3)] select-none mb-3"
                    >
                      {checkoutState === 'loading' && (
                        <Loader2 size={15} className="animate-spin shrink-0" />
                      )}
                      {checkoutState === 'redirecting' && (
                        <Loader2 size={15} className="animate-spin shrink-0" />
                      )}
                      {checkoutState === 'idle' && (
                        <Crown size={14} className="shrink-0" />
                      )}
                      {checkoutState === 'error' && (
                        <Crown size={14} className="shrink-0" />
                      )}

                      {checkoutState === 'idle'       && (isHe ? 'שדרג עכשיו — $9/חודש'  : 'Upgrade Now — $9/month')}
                      {checkoutState === 'loading'    && (isHe ? 'מתחבר לStripe...'        : 'Connecting to Stripe...')}
                      {checkoutState === 'redirecting'&& (isHe ? 'מועבר לדף התשלום...'    : 'Redirecting to checkout...')}
                      {checkoutState === 'error'      && (isHe ? 'נסה שוב'                 : 'Try Again')}
                    </button>
                  )}

                  {/* Trust line */}
                  <p className="text-center text-white/20 text-[10px] leading-relaxed">
                    {isHe
                      ? 'מאובטח על ידי Stripe · ביטול בלחיצה אחת'
                      : 'Secured by Stripe · Cancel in one click'}
                  </p>
                </div>

                {/* Footer */}
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
