import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Crown, Check, Loader2, AlertCircle, Mail } from 'lucide-react';
import { HONEYPOT_FIELD } from '../lib/waitlist.js';
import { WAITLIST_COPY } from '../constants/waitlist-copy.js';

/**
 * Pro waitlist modal — shown instead of the checkout while billing is gated
 * (BILLING_ENABLED=false). Captures an email via POST /api/waitlist so we have a
 * warm list to convert when Stripe goes Live. No payment, no test card, zero
 * budget exposure to the public.
 *
 * Props: isOpen, onClose, lang ('he'|'en'), defaultEmail (prefill from session).
 */
export default function WaitlistModal({ isOpen, onClose, lang = 'en', defaultEmail = '' }) {
  const isHe = lang === 'he';

  const [email, setEmail]   = useState(defaultEmail);
  const [state, setState]   = useState('idle'); // 'idle' | 'sending' | 'success' | 'error'
  const [errorMsg, setErrorMsg] = useState('');
  const trapRef = useRef(null);   // honeypot: real people never see or fill it
  const L = isHe ? 'he' : 'en';

  // Reset on open; prefill with the signed-in email when available.
  useEffect(() => {
    if (isOpen) {
      setEmail(defaultEmail || '');
      setState('idle');
      setErrorMsg('');
    }
  }, [isOpen, defaultEmail]);

  const submit = async () => {
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setState('error');
      setErrorMsg(WAITLIST_COPY.errors.invalid[L]);
      return;
    }
    setState('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: clean, lang, [HONEYPOT_FIELD]: trapRef.current?.value || '' }),
      });
      if (res.ok) { setState('success'); return; }
      // 503 = not saved (retryable): never show the success screen for it
      setState('error');
      setErrorMsg(res.status === 503 ? WAITLIST_COPY.errors.unavailable[L]
        : res.status === 429 ? WAITLIST_COPY.errors.rateLimited[L]
        : res.status === 400 ? WAITLIST_COPY.errors.invalid[L]
        : WAITLIST_COPY.errors.generic[L]);
    } catch {
      setState('error');
      setErrorMsg(WAITLIST_COPY.errors.unavailable[L]);
    }
  };

  const modal = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="waitlist-backdrop"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[8000] bg-black/85 backdrop-blur-md"
            onClick={onClose}
            aria-hidden="true"
          />

          <div className="fixed inset-0 z-[8001] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
            <motion.div
              key="waitlist-modal"
              initial={{ opacity: 0, scale: 0.93, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 24 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              role="dialog"
              aria-modal="true"
              aria-label={isHe ? 'רשימת המתנה לפרו' : 'Pro waitlist'}
              dir={isHe ? 'rtl' : 'ltr'}
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-sm pointer-events-auto"
            >
              <div className="absolute -inset-px rounded-[2.5rem] bg-gradient-to-b from-amber-500/20 to-transparent blur-sm pointer-events-none" />

              <div className="relative bg-[#080810] border border-amber-500/20 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.97)] overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/50 to-transparent" />

                <button
                  onClick={onClose}
                  aria-label={isHe ? 'סגור' : 'Close'}
                  className={`absolute top-5 z-10 text-white/25 hover:text-amber-400 transition-colors duration-200 p-1.5 rounded-full hover:bg-white/5 ${isHe ? 'left-5' : 'right-5'}`}
                >
                  <X size={18} />
                </button>

                <div className="px-7 pt-9 pb-7">
                  {/* Crown icon */}
                  <div className="flex justify-center mb-4">
                    <div className="relative w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/25 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.2)]">
                      <Crown className="text-amber-400 w-7 h-7" />
                    </div>
                  </div>

                  <p className="text-center text-[9px] font-black tracking-[0.35em] text-amber-400/50 uppercase mb-2">
                    {isHe ? 'מסלול פרו · בקרוב' : 'PRO PLAN · COMING SOON'}
                  </p>

                  {state === 'success' ? (
                    <>
                      <div className="flex justify-center my-5">
                        <div className="w-12 h-12 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                          <Check size={22} className="text-emerald-400" />
                        </div>
                      </div>
                      <h2 className="text-center text-white font-black text-[19px] leading-tight mb-2">
                        {isHe ? 'נרשמתם לרשימה! 🎬' : "You're on the list! 🎬"}
                      </h2>
                      <p className="text-center text-white/40 text-[12px] leading-relaxed mb-6">
                        {isHe
                          ? 'נעדכן אתכם ברגע ש-Pro ייפתח. עד אז אפשר להמשיך להפיק במסלול החינמי.'
                          : "We'll let you know the moment Pro opens. Until then — keep creating on the Free plan."}
                      </p>
                      <button
                        onClick={onClose}
                        className="w-full bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-black font-black text-[14px] px-5 py-3.5 rounded-2xl transition-all duration-150 shadow-[0_4px_20px_rgba(245,158,11,0.3)]"
                      >
                        {isHe ? 'חזרה לסט' : 'Back to set'}
                      </button>
                    </>
                  ) : (
                    <>
                      <h2 className="text-center text-white font-black text-[19px] leading-tight mb-2">
                        {isHe ? 'היו הראשונים לקבל Pro' : 'Be first to get Pro'}
                      </h2>
                      <p className="text-center text-white/40 text-[12px] leading-relaxed mb-6">
                        {isHe
                          ? 'יותר תסריטים, פוסטרים וקומיקסים ביום. השאירו אימייל ונעדכן אתכם ברגע שזה עולה לאוויר.'
                          : 'More scripts, posters & comics a day. Drop your email and we’ll tell you the moment it goes live.'}
                      </p>

                      <div className="relative mb-3">
                        <Mail size={15} className={`absolute top-1/2 -translate-y-1/2 text-white/25 ${isHe ? 'right-4' : 'left-4'}`} />
                        <input
                          type="email"
                          value={email}
                          onChange={e => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
                          onKeyDown={e => { if (e.key === 'Enter' && state !== 'sending') submit(); }}
                          placeholder={isHe ? 'האימייל שלך' : 'your@email.com'}
                          aria-label={isHe ? 'האימייל שלך' : 'Your email address'}
                          dir="ltr"
                          disabled={state === 'sending'}
                          className={`w-full bg-white/[0.04] border border-white/10 rounded-2xl py-3.5 text-white text-[13px] placeholder-white/25 outline-none focus:border-amber-500/40 transition-colors disabled:opacity-50 ${isHe ? 'pr-11 pl-4 text-right' : 'pl-11 pr-4'}`}
                        />
                        {/* Honeypot: off-screen (NOT display:none), no autofill, not focusable, hidden from assistive tech. Name = HONEYPOT_FIELD (not an autofill token). */}
                        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', top: 'auto', width: '1px', height: '1px', overflow: 'hidden' }}>
                          <input ref={trapRef} type="text" name={HONEYPOT_FIELD} defaultValue="" tabIndex={-1} autoComplete="off" />
                        </div>
                      </div>

                      {state === 'error' && errorMsg && (
                        <div className="mb-3 p-3 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-start gap-2.5">
                          <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                          <p className="text-red-400/90 text-[12px] leading-snug">{errorMsg}</p>
                        </div>
                      )}

                      <button
                        onClick={submit}
                        disabled={state === 'sending'}
                        className="w-full flex items-center justify-center gap-2 bg-amber-500 hover:bg-amber-400 disabled:bg-amber-500/40 disabled:cursor-not-allowed active:scale-[0.98] text-black font-black text-[14px] px-5 py-3.5 rounded-2xl transition-all duration-150 shadow-[0_4px_20px_rgba(245,158,11,0.3)] select-none"
                      >
                        {state === 'sending'
                          ? <><Loader2 size={15} className="animate-spin shrink-0" />{isHe ? 'מצטרפים...' : 'Joining…'}</>
                          : (isHe ? 'הצטרפות לרשימת ההמתנה' : 'Join the waitlist')}
                      </button>

                      <p className="text-center text-white/35 text-[10px] leading-relaxed mt-3">
                        {WAITLIST_COPY.purpose[L].before}
                        <a href="/data-deletion" target="_blank" rel="noopener noreferrer" className="underline text-white/55 hover:text-white">{WAITLIST_COPY.purpose[L].link}</a>
                        {WAITLIST_COPY.purpose[L].after}
                      </p>
                    </>
                  )}
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
