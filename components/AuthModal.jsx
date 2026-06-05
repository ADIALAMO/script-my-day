import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { flushSync } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { signIn, getSession } from 'next-auth/react';
import { X, Film, Shield, Mail, ArrowRight, CheckCircle, Loader2 } from 'lucide-react';

const CONTEXT_COPY = {
  poster: {
    en: 'Poster generation requires a free account — takes 2 seconds.',
    he: 'יצירת פוסטרים מצריכה חשבון חינמי — לוקח 2 שניות.',
  },
  comic: {
    en: 'The comic book feature requires a free account.',
    he: 'פיצ׳ר הקומיקס מצריך חשבון חינמי.',
  },
  quota: {
    en: "You've reached your guest limit. Sign in to keep creating.",
    he: 'הגעת למכסת האורח. התחבר כדי להמשיך ליצור.',
  },
  upgrade: {
    en: 'Upgrade to Pro for unlimited scripts, 3 posters/day, and full comic books.',
    he: 'שדרג לפרו לתסריטים ללא הגבלה, 3 פוסטרים ביום וקומיקס מלא.',
  },
  general: {
    en: 'Sign in to save your scripts and unlock visual features.',
    he: 'התחבר כדי לשמור את התסריטים ולפתוח פיצ׳רים ויזואליים.',
  },
};

// Google's official brand colors as an inline SVG — no external image dependency.
const GoogleLogo = () => (
  <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" aria-hidden="true">
    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
  </svg>
);

// ── iOS PWA helpers ──────────────────────────────────────────────────────────

// Returns true when the app is running as an installed standalone PWA.
// In this context Safari opens magic links in an isolated process, so the
// session cookie is never shared back with the WKWebView. The relay-exchange
// flow is activated exclusively for this case.
function isStandalonePWA() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
}

// crypto.randomUUID is available on iOS ≥ 15.4. Fallback covers older devices.
function generateRelayToken() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * High-trust sign-in gate. Renders via createPortal.
 *
 * Props:
 *   isOpen    — boolean
 *   onClose   — () => void
 *   lang      — 'en' | 'he'
 *   context   — 'poster' | 'comic' | 'quota' | 'upgrade' | 'general'
 */
export default function AuthModal({ isOpen, onClose, lang = 'en', context = 'general' }) {
  const isHe = lang === 'he';
  const safeContext = context in CONTEXT_COPY ? context : 'general';
  const contextMsg  = CONTEXT_COPY[safeContext][lang] || CONTEXT_COPY[safeContext].en;

  // 'idle' | 'sending' | 'sent' | 'error' | 'authenticated'
  const [emailState, setEmailState] = useState('idle');
  const [email, setEmail]           = useState('');
  const [emailError, setEmailError] = useState('');

  // One relay token per sign-in attempt — generated fresh each time the modal opens.
  // Stored in a ref so it survives re-renders without causing extra renders itself.
  const relayTokenRef = useRef(null);

  // Reset internal state whenever the modal opens.
  useEffect(() => {
    if (isOpen) {
      setEmailState('idle');
      setEmail('');
      setEmailError('');
      relayTokenRef.current = generateRelayToken();
    }
  }, [isOpen]);

  // ── Cross-tab session watcher ─────────────────────────────────────────────
  // Problem: user clicks the magic link in a new tab (Window B). Window B
  // authenticates and sets a session cookie shared across all same-origin tabs.
  // Window A (this modal, showing "check your inbox") has no idea auth happened.
  //
  // Solution: while on the 'sent' screen, poll GET /api/auth/session every 3s.
  // Because all tabs share the cookie jar, getSession() returns the live session
  // as soon as Window B completes auth — no cross-tab messaging needed.
  // visibilitychange + focus fire an immediate check so the response is
  // near-instant when the user switches back from their email client.
  useEffect(() => {
    if (emailState !== 'sent' || !isOpen) return;

    let cancelled = false;

    const check = async () => {
      if (cancelled) return;
      try {
        const session = await getSession();
        if (session && !cancelled) setEmailState('authenticated');
      } catch {
        // Network blip — silent, retry on next tick.
      }
    };

    const poll            = setInterval(check, 3000);
    const onFocus         = () => check();
    const onVisibility    = () => { if (!document.hidden) check(); };
    // Stop after 10 min — matches the magic link token maxAge in lib/auth.js.
    const maxAgeTimer     = setTimeout(() => { cancelled = true; clearInterval(poll); }, 10 * 60 * 1000);

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(maxAgeTimer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [emailState, isOpen]);

  // ── iOS PWA relay-exchange poll ───────────────────────────────────────────
  // The getSession() poll above covers desktop / same-browser flows where all
  // tabs share the same cookie jar.
  //
  // This effect covers the iOS PWA case: the magic link opens in external
  // Safari (different WKWebView sandbox), authenticates there, and writes a
  // verified relay entry to Redis via /auth-relay-complete. Once the entry is
  // detected here, we call signIn('relay-exchange') to materialise a real
  // NextAuth JWT session cookie inside this PWA's WKWebView — no cookie
  // sharing or sandbox bypass required.
  //
  // Only activates when running as a standalone PWA (window.navigator.standalone
  // or display-mode: standalone) to avoid conflicting with the desktop flow.
  useEffect(() => {
    if (emailState !== 'sent' || !isOpen) return;
    if (!isStandalonePWA()) return;

    const relayToken = relayTokenRef.current;
    if (!relayToken) return;

    let cancelled = false;

    const attemptExchange = async () => {
      if (cancelled) return;
      try {
        const result = await signIn('relay-exchange', {
          relayToken,
          redirect: false,
        });
        if (result?.ok && !cancelled) setEmailState('authenticated');
      } catch {
        // Exchange failed — relay entry not ready or already consumed. Safe to retry.
      }
    };

    const checkRelay = async () => {
      if (cancelled) return;
      try {
        const res = await fetch(
          `/api/auth/relay-status?token=${encodeURIComponent(relayToken)}`,
          { cache: 'no-store' }
        );
        if (!res.ok) return;
        const { status } = await res.json();
        if (status === 'verified' && !cancelled) await attemptExchange();
      } catch {
        // Network blip — retry on next interval tick.
      }
    };

    const interval    = setInterval(checkRelay, 2500);
    // Stop after 10 min — matches the magic link maxAge in lib/auth.js.
    const maxAgeTimer = setTimeout(() => { cancelled = true; clearInterval(interval); }, 10 * 60 * 1000);
    // Immediate check when user switches back from Safari to the PWA.
    const onVisible   = () => { if (!document.hidden) checkRelay(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      clearTimeout(maxAgeTimer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [emailState, isOpen]);

  // ── Post-authentication reload ────────────────────────────────────────────
  // Once authenticated, show the confirmation screen briefly, then do a full
  // page reload. This re-hydrates useSession in every component (Navbar tier
  // badge, quota gates, etc.) cleanly without requiring prop drilling.
  useEffect(() => {
    if (emailState !== 'authenticated') return;
    const t = setTimeout(() => window.location.reload(), 1500);
    return () => clearTimeout(t);
  }, [emailState]);

  // Scroll lock is handled by index.js's global anyOpen effect, which tracks
  // showAuthModal. A duplicate lock here causes a race: this cleanup runs
  // after index.js restores '', overwriting it back to 'hidden'. Removed.

  const handleGoogleSignIn = () => {
    signIn('google', { callbackUrl: window.location.href });
  };

  const handleEmailSignIn = async (e) => {
    e?.preventDefault();
    if (emailState === 'sending') return; // guard against rapid double-tap
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setEmailError(isHe ? 'כתובת מייל לא תקינה' : 'Enter a valid email address');
      return;
    }
    setEmailError('');
    // flushSync forces React to commit this state update synchronously so the
    // loading spinner paints to the screen before the first async network call.
    // Without it, React may defer the re-render past the cold-start freeze.
    flushSync(() => setEmailState('sending'));
    try {
      // In standalone PWA mode, embed the relay_token in the callbackUrl so
      // that /auth-relay-complete can write the verified entry to Redis after
      // the user authenticates in Safari. In all other contexts, keep the
      // existing /auth-success flow (tab auto-close + getSession() polling).
      const callbackUrl = isStandalonePWA()
        ? `${window.location.origin}/auth-relay-complete?relay_token=${relayTokenRef.current}`
        : `${window.location.origin}/auth-success`;

      // redirect: false returns {ok, error} without leaving the page so our
      // modal can display the confirmation state directly.
      const result = await signIn('email', { email: trimmed, redirect: false, callbackUrl });
      if (result?.error) {
        setEmailState('error');
        setEmailError(isHe ? 'שגיאה בשליחת המייל. נסה שוב.' : 'Failed to send email. Please try again.');
      } else {
        setEmailState('sent');
      }
    } catch {
      setEmailState('error');
      setEmailError(isHe ? 'שגיאה בשליחת המייל. נסה שוב.' : 'Failed to send email. Please try again.');
    }
  };

  const modal = (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* ── Backdrop ── */}
          <motion.div
            key="auth-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[8000] bg-black/85 backdrop-blur-md"
            onClick={onClose}
            aria-hidden="true"
          />

          {/* ── Modal panel ── */}
          <div className="fixed inset-0 z-[8001] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
            <motion.div
              key="auth-modal"
              initial={{ opacity: 0, scale: 0.93, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 24 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              role="dialog"
              aria-modal="true"
              aria-label={isHe ? 'כניסה לחשבון' : 'Sign in'}
              dir={isHe ? 'rtl' : 'ltr'}
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-sm pointer-events-auto"
            >
              {/* Outer glow */}
              <div className="absolute -inset-px rounded-[2.5rem] bg-gradient-to-b from-[#d4a373]/20 to-transparent blur-sm pointer-events-none" />

              <div className="relative bg-[#080810] border border-[#d4a373]/15 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.97)] overflow-hidden">
                {/* Top accent line */}
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#d4a373]/40 to-transparent" />

                {/* Close */}
                <button
                  onClick={onClose}
                  aria-label={isHe ? 'סגור' : 'Close'}
                  className={`absolute top-5 z-10 text-white/25 hover:text-[#d4a373] transition-colors duration-200 p-1.5 rounded-full hover:bg-white/5 ${isHe ? 'left-5' : 'right-5'}`}
                >
                  <X size={18} />
                </button>

                {/* ── State panels ── */}
                <AnimatePresence mode="wait">
                  {emailState === 'authenticated' ? (

                    /* ── Authenticated: brief confirmation before reload ── */
                    <motion.div
                      key="authenticated"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="px-8 py-12 flex flex-col items-center text-center"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/20 flex items-center justify-center mb-5 shadow-[0_0_30px_rgba(212,163,115,0.15)]">
                        <Film className="text-[#d4a373] w-7 h-7" />
                      </div>
                      <p className="text-[9px] font-black tracking-[0.35em] text-[#d4a373]/60 uppercase mb-3">
                        {isHe ? 'מחובר בהצלחה' : 'SIGNED IN'}
                      </p>
                      <h2 className="text-[21px] font-black text-white leading-tight mb-3">
                        {isHe ? 'ברוך הבא לאולפן!' : 'Welcome to the Studio!'}
                      </h2>
                      <p className="text-white/35 text-[12px] leading-relaxed mb-5">
                        {isHe ? 'מכין את האולפן שלך...' : 'Setting up your studio…'}
                      </p>
                      <Loader2 size={18} className="text-[#d4a373]/40 animate-spin" />
                    </motion.div>

                  ) : emailState === 'sent' ? (

                    /* ── Sent: waiting for magic link click ── */
                    <motion.div
                      key="sent"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="px-8 py-12 flex flex-col items-center text-center"
                    >
                      <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-5">
                        <CheckCircle className="text-emerald-400 w-7 h-7" />
                      </div>
                      <p className="text-[9px] font-black tracking-[0.35em] text-emerald-400/60 uppercase mb-3">
                        {isHe ? 'המייל נשלח' : 'MAGIC LINK SENT'}
                      </p>
                      <h2 className="text-[21px] font-black text-white leading-tight mb-3">
                        {isHe ? 'בדוק את תיבת המייל שלך' : 'Check your inbox'}
                      </h2>
                      <p className="text-white/35 text-[12px] leading-relaxed mb-4">
                        {isHe
                          ? `שלחנו קישור כניסה לכתובת ${email}. הוא יפוג תוך 10 דקות.`
                          : `We sent a sign-in link to ${email}. It expires in 10 minutes.`}
                      </p>
                      {isStandalonePWA() && (
                        <p className="text-emerald-400/50 text-[11px] leading-relaxed mb-6 px-2">
                          {isHe
                            ? 'לחץ על הקישור במייל ואז חזור לאפליקציה — הכניסה תתבצע אוטומטית.'
                            : 'Tap the link in your email, then return here — sign-in completes automatically.'}
                        </p>
                      )}
                      {!isStandalonePWA() && <div className="mb-6" />}
                      <button
                        onClick={() => { setEmailState('idle'); setEmail(''); }}
                        className="text-white/25 hover:text-white/50 text-[11px] transition-colors"
                      >
                        {isHe ? 'שלח לכתובת אחרת' : 'Try a different email'}
                      </button>
                    </motion.div>

                  ) : (
                    <motion.div key="form" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                      {/* ── Body ── */}
                      <div className="px-8 pt-10 pb-6">
                        {/* Film icon */}
                        <div className="flex justify-center mb-5">
                          <div className="relative w-14 h-14 rounded-2xl bg-[#d4a373]/8 border border-[#d4a373]/20 flex items-center justify-center">
                            <div className="absolute inset-0 rounded-2xl bg-[#d4a373]/5 blur-md" />
                            <Film className="relative text-[#d4a373] w-7 h-7" />
                          </div>
                        </div>

                        {/* Label */}
                        <p className="text-center text-[9px] font-black tracking-[0.35em] text-[#d4a373]/50 uppercase mb-3">
                          {isHe ? 'גישה לאולפן' : 'STUDIO ACCESS'}
                        </p>

                        {/* Heading */}
                        <h2 className="text-center text-[21px] font-black text-white leading-[1.2] tracking-tight mb-2">
                          {isHe ? (
                            <>שמור את הסיפורים שלך<br />ופתח פיצ׳רים קולנועיים</>
                          ) : (
                            <>Save Your Stories &<br />Unlock Cinematic Features</>
                          )}
                        </h2>

                        {/* Context message */}
                        <p className="text-center text-white/35 text-[12px] leading-relaxed mb-6 px-2">
                          {contextMsg}
                        </p>

                        {/* ── Google CTA ── */}
                        <button
                          onClick={handleGoogleSignIn}
                          className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-50 active:scale-[0.97] text-[#111] font-semibold text-[14px] px-5 py-3.5 rounded-2xl transition-all duration-150 shadow-[0_4px_20px_rgba(0,0,0,0.4)] select-none"
                        >
                          <GoogleLogo />
                          {isHe ? 'המשך עם Google' : 'Continue with Google'}
                        </button>

                        {/* ── Divider ── */}
                        <div className="flex items-center gap-3 my-4">
                          <div className="flex-1 h-px bg-white/[0.07]" />
                          <span className="text-[10px] text-white/20 tracking-widest uppercase">
                            {isHe ? 'או' : 'or'}
                          </span>
                          <div className="flex-1 h-px bg-white/[0.07]" />
                        </div>

                        {/* ── Email magic link ── */}
                        <form onSubmit={handleEmailSignIn} noValidate>
                          <div className="relative mb-3">
                            <Mail
                              size={14}
                              className={`absolute top-1/2 -translate-y-1/2 text-white/20 pointer-events-none ${isHe ? 'right-3.5' : 'left-3.5'}`}
                            />
                            <input
                              type="email"
                              value={email}
                              onChange={e => { setEmail(e.target.value); setEmailError(''); }}
                              onKeyDown={e => e.key === 'Enter' && handleEmailSignIn()}
                              placeholder={isHe ? 'כתובת מייל שלך...' : 'your@email.com'}
                              dir={isHe ? 'rtl' : 'ltr'}
                              className={`w-full bg-white/[0.04] border ${emailError ? 'border-red-500/50' : 'border-white/10'} rounded-xl px-4 py-3 ${isHe ? 'pr-9 text-right' : 'pl-9'} text-white text-[13px] placeholder-white/20 focus:outline-none focus:border-[#d4a373]/40 transition-colors duration-200`}
                            />
                          </div>
                          {emailError && (
                            <p className="text-red-400/80 text-[11px] mb-2 px-1">
                              {emailError}
                            </p>
                          )}
                          <button
                            type="button"
                            disabled={emailState === 'sending'}
                            onClick={handleEmailSignIn}
                            className="w-full flex items-center justify-center gap-2 bg-white/[0.06] hover:bg-white/[0.1] active:scale-[0.97] border border-white/10 hover:border-white/20 text-white/70 hover:text-white text-[13px] font-medium px-5 py-3 rounded-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none touch-manipulation"
                          >
                            {emailState === 'sending' ? (
                              <>
                                <Loader2 size={14} className="animate-spin" />
                                {isHe ? 'שולח...' : 'Sending...'}
                              </>
                            ) : (
                              <>
                                {isHe ? 'שלח קישור כניסה' : 'Send magic link'}
                                <ArrowRight size={14} />
                              </>
                            )}
                          </button>
                        </form>

                        {/* Skip */}
                        <button
                          onClick={onClose}
                          className="w-full text-center text-white/20 hover:text-white/45 text-[11px] py-3 transition-colors duration-200"
                        >
                          {isHe ? 'המשך כאורח' : 'Continue as guest'}
                        </button>
                      </div>

                      {/* ── Trust row ── */}
                      <div className="px-8 pt-4 pb-6 border-t border-white/[0.04]">
                        <div className="flex items-center justify-center gap-1.5 mb-3">
                          <Shield size={10} className="text-white/20" />
                          <p className="text-[9px] text-white/20 tracking-[0.2em] uppercase">
                            {isHe ? 'מאובטח ומופעל על ידי' : 'SECURED & POWERED BY'}
                          </p>
                        </div>
                        <div className="flex items-center justify-center gap-5 mb-5">
                          {[
                            { label: 'Together AI', sub: 'image AI'  },
                            { label: 'Vercel',      sub: 'hosting'   },
                            { label: 'Stripe',      sub: 'payments'  },
                          ].map(({ label, sub }) => (
                            <div key={label} className="flex flex-col items-center gap-0.5">
                              <span className="text-[10px] font-bold text-white/35">{label}</span>
                              <span className="text-[8px] text-white/15 tracking-wider uppercase">{sub}</span>
                            </div>
                          ))}
                        </div>
                        <p className="text-center text-[11px] text-[#d4a373]/25 italic leading-relaxed">
                          {isHe
                            ? '"נבנה על ידי אדם אחד שרצה לראות את חייו כסרט. עכשיו אתה יכול לראות את שלך."'
                            : '"Built by one person who wanted to see their life as a movie. Now you can see yours."'}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
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
