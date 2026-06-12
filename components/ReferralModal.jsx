import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Gift, Copy, Check, Share2, Loader2, AlertCircle } from 'lucide-react';
import { withUtmMedium } from '../utils/referral-link.js';
import { shareData, exportCapabilities } from '../utils/export-image.js';

/**
 * "Invite friends" modal — the referral loop entry point for signed-in users.
 * Fetches the user's invite link + live stats from GET /api/referral and offers
 * copy / native-share / WhatsApp sharing. Reward: each friend who signs up and makes
 * their first poster earns the inviter +1 free "Star Yourself" poster.
 *
 * Props: isOpen, onClose, lang ('en' | 'he').
 */
export default function ReferralModal({ isOpen, onClose, lang = 'en' }) {
  const isHe = lang === 'he';

  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'error'
  const [data, setData]   = useState(null);      // { code, link, referrals, bonusCredits }
  const [copied, setCopied] = useState(false);

  // Localized share message (the link is appended by each share path).
  const shareText = isHe
    ? 'הפכתי את היום שלי לפוסטר קולנועי ב-LIFESCRIPT 🎬 תיצור גם אחד עם הפנים שלך:'
    : 'I turned my day into a cinematic movie poster on LIFESCRIPT 🎬 Make one with your own face:';

  useEffect(() => {
    if (!isOpen) return;
    let alive = true;
    setState('loading');
    setCopied(false);
    fetch('/api/referral', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { if (alive) { setData(d); setState('ready'); } })
      .catch(() => { if (alive) setState('error'); });
    return () => { alive = false; };
  }, [isOpen]);

  // GA4 viral-funnel: the "send" side of the loop. method = the share channel used.
  const trackShare = (method) => {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'referral_link_shared', { method });
    }
  };

  const copyLink = async () => {
    if (!data?.link) return;
    try {
      await navigator.clipboard.writeText(withUtmMedium(data.link, 'copy'));
      setCopied(true);
      trackShare('copy');
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked — user can still select the link manually */ }
  };

  const nativeShare = async () => {
    if (!data?.link) return;
    // shareData owns the re-entrancy latch + dismiss handling (see utils/export-image.js),
    // so re-tapping after dismissing the sheet never freezes the button. Returns false only
    // when Web Share is unavailable → fall back to copying the link.
    if (await shareData({ title: 'LIFESCRIPT', text: shareText, url: withUtmMedium(data.link, 'native') })) {
      trackShare('native');
      return;
    }
    copyLink();
  };

  const shareWhatsApp = () => {
    if (!data?.link) return;
    const msg = `${shareText} ${withUtmMedium(data.link, 'whatsapp')}`;
    trackShare('whatsapp');
    const encoded = encodeURIComponent(msg);
    const webUrl  = `https://wa.me/?text=${encoded}`;

    // Mobile: wa.me deep-links straight into the installed WhatsApp app — keep it.
    if (!exportCapabilities().isDesktop) {
      window.open(webUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    // Desktop: wa.me shows WhatsApp's "download / Continue to Chat" interstitial even when
    // the desktop app IS installed (the MacBook complaint). The whatsapp:// protocol opens
    // the installed app directly. If the protocol isn't registered (no app), the page stays
    // focused, so after a short grace period we fall back to opening wa.me in a new tab.
    let opened = false;
    const onHide  = () => { if (document.hidden) { opened = true; cleanup(); } };
    const cleanup = () => { document.removeEventListener('visibilitychange', onHide); clearTimeout(timer); };
    const timer   = setTimeout(() => {
      cleanup();
      if (!opened && !document.hidden) window.open(webUrl, '_blank', 'noopener,noreferrer');
    }, 1500);
    document.addEventListener('visibilitychange', onHide);
    window.location.href = `whatsapp://send?text=${encoded}`;
  };

  const modal = (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="referral-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[8000] bg-black/85 backdrop-blur-md"
            onClick={onClose}
            aria-hidden="true"
          />

          <div className="fixed inset-0 z-[8001] flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none">
            <motion.div
              key="referral-modal"
              initial={{ opacity: 0, scale: 0.93, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.93, y: 24 }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              role="dialog"
              aria-modal="true"
              aria-label={isHe ? 'הזמן חברים' : 'Invite friends'}
              dir={isHe ? 'rtl' : 'ltr'}
              onClick={(e) => e.stopPropagation()}
              className="relative w-full max-w-sm pointer-events-auto"
            >
              <div className="absolute -inset-px rounded-[2.5rem] bg-gradient-to-b from-[#d4a373]/20 to-transparent blur-sm pointer-events-none" />

              <div className="relative bg-[#080810] border border-[#d4a373]/20 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.97)] overflow-hidden">
                <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#d4a373]/50 to-transparent" />

                <button
                  onClick={onClose}
                  aria-label={isHe ? 'סגור' : 'Close'}
                  className={`absolute top-5 z-10 text-white/25 hover:text-[#d4a373] transition-colors duration-200 p-1.5 rounded-full hover:bg-white/5 ${isHe ? 'left-5' : 'right-5'}`}
                >
                  <X size={18} />
                </button>

                <div className="px-7 pt-9 pb-7">
                  {/* Gift icon */}
                  <div className="flex justify-center mb-4">
                    <div className="relative w-14 h-14 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/25 flex items-center justify-center shadow-[0_0_30px_rgba(212,163,115,0.2)]">
                      <Gift className="text-[#d4a373] w-7 h-7" />
                    </div>
                  </div>

                  <h2 className="text-center text-white font-black text-[20px] leading-tight mb-2">
                    {isHe ? 'הזמן חברים, קבל פוסטרים' : 'Invite friends, earn posters'}
                  </h2>
                  <p className="text-center text-white/40 text-[12px] leading-relaxed mb-6">
                    {isHe
                      ? 'על כל חבר שנרשם ויוצר פוסטר ראשון — אתה מקבל פוסטר "לככב בסיפור" חינם נוסף. 🎬'
                      : 'For every friend who signs up and makes their first poster, you earn another free "Star Yourself" poster. 🎬'}
                  </p>

                  {/* Loading */}
                  {state === 'loading' && (
                    <div className="flex items-center justify-center gap-2 py-8 text-white/40">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-[12px]">{isHe ? 'טוען את הקישור שלך…' : 'Loading your link…'}</span>
                    </div>
                  )}

                  {/* Error */}
                  {state === 'error' && (
                    <div className="mb-2 p-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-start gap-2.5">
                      <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                      <p className="text-red-400/90 text-[12px] leading-snug">
                        {isHe
                          ? 'לא הצלחנו לטעון את קישור ההזמנה. ודא שאתה מחובר ונסה שוב.'
                          : 'Could not load your invite link. Make sure you are signed in and try again.'}
                      </p>
                    </div>
                  )}

                  {/* Ready */}
                  {state === 'ready' && data && (
                    <>
                      {/* Stats */}
                      <div className="grid grid-cols-2 gap-2.5 mb-5">
                        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 py-3 text-center">
                          <p className="text-[#d4a373] font-black text-[22px] leading-none">{data.referrals}</p>
                          <p className="text-white/35 text-[10px] mt-1.5 leading-tight">
                            {isHe ? 'חברים הצטרפו' : 'Friends joined'}
                          </p>
                        </div>
                        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] px-3 py-3 text-center">
                          <p className="text-[#d4a373] font-black text-[22px] leading-none">{data.bonusCredits}</p>
                          <p className="text-white/35 text-[10px] mt-1.5 leading-tight">
                            {isHe ? 'פוסטרים שהרווחת' : 'Posters earned'}
                          </p>
                        </div>
                      </div>

                      {/* Link + copy */}
                      <div className="flex items-stretch gap-2 mb-4">
                        <div className="flex-1 min-w-0 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3.5 flex items-center">
                          <span dir="ltr" className="text-white/55 text-[12px] truncate w-full">{data.link}</span>
                        </div>
                        <button
                          onClick={copyLink}
                          aria-label={isHe ? 'העתק קישור' : 'Copy link'}
                          className="shrink-0 flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-[#d4a373]/15 hover:bg-[#d4a373]/25 text-[#d4a373] font-bold text-[12px] transition-colors duration-150 active:scale-[0.97]"
                        >
                          {copied ? <Check size={14} /> : <Copy size={14} />}
                          {copied ? (isHe ? 'הועתק' : 'Copied') : (isHe ? 'העתק' : 'Copy')}
                        </button>
                      </div>

                      {/* Share actions */}
                      <div className="grid grid-cols-2 gap-2.5">
                        <button
                          onClick={nativeShare}
                          className="flex items-center justify-center gap-2 bg-[#d4a373] hover:bg-[#e0b487] active:scale-[0.98] text-black font-black text-[13px] px-4 py-3 rounded-2xl transition-all duration-150 shadow-[0_4px_20px_rgba(212,163,115,0.3)]"
                        >
                          <Share2 size={14} className="shrink-0" />
                          {isHe ? 'שתף' : 'Share'}
                        </button>
                        <button
                          onClick={shareWhatsApp}
                          className="flex items-center justify-center gap-2 bg-emerald-500/90 hover:bg-emerald-500 active:scale-[0.98] text-black font-black text-[13px] px-4 py-3 rounded-2xl transition-all duration-150"
                        >
                          WhatsApp
                        </button>
                      </div>
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
