import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Cookie } from 'lucide-react';

/**
 * GA4 Consent Mode v2 banner.
 *
 * Two actions — not a notice, a real consent gate:
 *   "Accept Analytics"  → stores {analytics:true},  calls gtag consent update → 'granted'
 *   "Essential Only"    → stores {analytics:false}, GA stays silent
 *
 * The X button is an alias for "Essential Only" (dismiss without analytics).
 *
 * Storage key: 'lifescript_cookie_v2' (JSON: {analytics: boolean}).
 * The _document.js <Head> script reads this key synchronously before GA loads,
 * so returning users who accepted see zero delay — no wait_for_update overhead.
 *
 * The "Privacy Policy" link goes to /privacy (standalone page) so it works
 * from any context, including native app WebView.
 *
 * Props: lang ('he' | 'en')
 * (onPolicyClick has been removed — link now points to /privacy directly)
 */

const STORAGE_KEY = 'lifescript_cookie_v2';

export default function CookieConsent({ lang = 'he' }) {
  const isHe = lang === 'he';
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY) === null) setVisible(true);
    } catch { /* localStorage blocked — skip banner */ }
  }, []);

  const persist = (analytics) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ analytics })); } catch {}
  };

  const handleAccept = () => {
    persist(true);
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: 'granted' });
    }
    setVisible(false);
  };

  const handleDecline = () => {
    persist(false);
    setVisible(false);
  };

  const banner = (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="cookie-banner"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ type: 'spring', damping: 28, stiffness: 320 }}
          dir={isHe ? 'rtl' : 'ltr'}
          className="fixed inset-x-0 bottom-0 z-[9000] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pointer-events-none"
        >
          <div className="pointer-events-auto w-full max-w-2xl bg-[#0a0a0a]/96 backdrop-blur-md border border-[#d4a373]/20 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] px-5 py-4">

            {/* Row: icon + text block + dismiss X */}
            <div className="flex items-start gap-3">

              {/* Cookie icon */}
              <div className="shrink-0 mt-0.5 w-8 h-8 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/20 flex items-center justify-center">
                <Cookie size={14} className="text-[#d4a373]" />
              </div>

              {/* Text + buttons */}
              <div className="flex-1 min-w-0">
                <p className="text-[11px] md:text-[12px] text-white/50 leading-snug mb-3">
                  {isHe
                    ? <>אנחנו משתמשים בעוגיות חיוניות ובGoogle Analytics לשיפור השירות.{' '}
                        <a href="/privacy" target="_blank" rel="noopener noreferrer"
                           className="text-[#d4a373] hover:text-[#e0b487] underline underline-offset-2 transition-colors font-semibold">
                          מדיניות פרטיות ↗
                        </a>
                      </>
                    : <>We use essential cookies and Google Analytics to improve the service.{' '}
                        <a href="/privacy" target="_blank" rel="noopener noreferrer"
                           className="text-[#d4a373] hover:text-[#e0b487] underline underline-offset-2 transition-colors font-semibold">
                          Privacy Policy ↗
                        </a>
                      </>
                  }
                </p>

                {/* Consent actions */}
                <div className="flex items-center gap-3 flex-wrap">
                  <button
                    onClick={handleDecline}
                    className="text-white/30 hover:text-white/60 text-[11px] underline underline-offset-2 transition-colors leading-none"
                  >
                    {isHe ? 'חיוניים בלבד' : 'Essential only'}
                  </button>

                  <button
                    onClick={handleAccept}
                    className="px-4 py-2 rounded-xl bg-[#d4a373] hover:bg-[#e0b487] active:scale-95 text-black text-[11px] md:text-[12px] font-black uppercase tracking-wide transition-all whitespace-nowrap select-none"
                  >
                    {isHe ? 'אשר אנליטיקה' : 'Accept Analytics'}
                  </button>
                </div>
              </div>

              {/* X = Essential Only — explicit 44×44 touch target */}
              <button
                onClick={handleDecline}
                aria-label={isHe ? 'דחה ותמשיך ללא אנליטיקה' : 'Decline analytics and continue'}
                className="shrink-0 w-11 h-11 -mt-1.5 flex items-center justify-center text-white/25 hover:text-white/60 transition-colors rounded-xl hover:bg-white/5"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M1 1l12 12M13 1L1 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
              </button>
            </div>

          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(banner, document.body);
}
