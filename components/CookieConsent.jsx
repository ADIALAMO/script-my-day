import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie, X } from 'lucide-react';

/**
 * Notice-only cookie banner (ePrivacy/GDPR transparency).
 * Discreet, cinematic, RTL-aware. Persists dismissal in localStorage so it
 * shows once per device. Links to the Privacy modal via onPolicyClick.
 *
 * We use essential cookies (session, referral) + aggregate analytics — this is
 * a transparency notice, not a consent gate, so there is a single "Got it" action.
 *
 * Props: lang ('he' | 'en'), onPolicyClick (() => void — opens the privacy modal).
 */
const STORAGE_KEY = 'lifescript_cookie_notice_v1';

export default function CookieConsent({ lang = 'he', onPolicyClick }) {
  const isHe = lang === 'he';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Defer to the client so SSR never renders the banner; show only if unseen.
    try {
      if (!localStorage.getItem(STORAGE_KEY)) setVisible(true);
    } catch { /* localStorage blocked — skip the banner rather than crash */ }
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(STORAGE_KEY, '1'); } catch { /* ignore */ }
    setVisible(false);
  };

  const banner = (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="cookie-banner"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          dir={isHe ? 'rtl' : 'ltr'}
          className="fixed inset-x-0 bottom-0 z-[9000] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none"
        >
          <div className="pointer-events-auto w-full max-w-2xl bg-[#0a0a0a]/95 backdrop-blur-md border border-[#d4a373]/20 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] px-5 py-4 flex items-center gap-4">
            <div className="shrink-0 w-9 h-9 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/20 flex items-center justify-center">
              <Cookie size={16} className="text-[#d4a373]" />
            </div>

            <p className="flex-1 text-[11px] md:text-[12px] text-white/55 leading-snug">
              {isHe
                ? 'אנחנו משתמשים בעוגיות חיוניות ובאנליטיקה אנונימית כדי שהשירות יעבוד וישתפר. '
                : 'We use essential cookies and anonymous analytics to keep the service running and improving. '}
              <button
                onClick={onPolicyClick}
                className="text-[#d4a373] hover:text-[#e0b487] underline underline-offset-2 transition-colors font-semibold"
              >
                {isHe ? 'מדיניות הפרטיות' : 'Privacy Policy'}
              </button>
            </p>

            <button
              onClick={dismiss}
              className="shrink-0 px-4 py-2 rounded-xl bg-[#d4a373] hover:bg-[#e0b487] active:scale-95 text-black text-[11px] md:text-[12px] font-black uppercase tracking-wide transition-all whitespace-nowrap"
            >
              {isHe ? 'הבנתי' : 'Got it'}
            </button>

            <button
              onClick={dismiss}
              aria-label={isHe ? 'סגור' : 'Dismiss'}
              className="shrink-0 text-white/25 hover:text-white/60 transition-colors p-1"
            >
              <X size={14} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(banner, document.body);
}
