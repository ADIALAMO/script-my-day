import React, { useEffect } from 'react';
import Head from 'next/head';
import { motion } from 'framer-motion';
import { CheckCircle } from 'lucide-react';

/**
 * Magic-link verification landing page.
 *
 * NextAuth redirects here (callbackUrl) after the user clicks the email link.
 * This tab's only job is to complete the auth handshake so the session cookie
 * is written to the browser. Window A (the original app tab) detects the new
 * session via its getSession() polling loop and re-hydrates automatically.
 *
 * window.close() is attempted after a short delay. Most browsers block it on
 * tabs that were not opened via window.open() — the UI copy is the intentional
 * fallback for those cases.
 */
export default function AuthSuccess() {
  useEffect(() => {
    const t = setTimeout(() => window.close(), 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <>
      <Head>
        <title>Verified · LifeScript Studio</title>
      </Head>

      <div className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden">

        {/* Ambient background glow */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[520px] h-[520px] rounded-full bg-[#d4a373]/6 blur-[110px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.93, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          className="relative z-10 w-full max-w-xs"
        >
          {/* Card */}
          <div className="relative bg-[#0a0a14] border border-[#d4a373]/15 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.95)] overflow-hidden px-8 pt-11 pb-9 text-center">

            {/* Top accent line */}
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#d4a373]/40 to-transparent" />

            {/* Verified icon */}
            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/20 flex items-center justify-center shadow-[0_0_40px_rgba(212,163,115,0.18)]">
                <CheckCircle className="text-[#d4a373] w-8 h-8" />
              </div>
            </div>

            {/* Label */}
            <p className="text-[9px] font-black tracking-[0.35em] text-[#d4a373]/55 uppercase mb-3">
              VERIFIED
            </p>

            {/* Heading */}
            <h1 className="text-[22px] font-black text-white leading-tight mb-4">
              You&rsquo;re signed in!
            </h1>

            {/* Primary instruction */}
            <p className="text-white/40 text-[13px] leading-relaxed">
              Return to your original window to continue.<br />
              This tab will close automatically.
            </p>

            {/* Divider */}
            <div className="my-7 h-px bg-white/[0.06]" />

            {/* Manual close fallback */}
            <p className="text-white/20 text-[11px] mb-3">
              Tab didn&rsquo;t close automatically?
            </p>
            <button
              onClick={() => window.close()}
              className="text-[#d4a373]/50 hover:text-[#d4a373] text-[12px] font-semibold transition-colors duration-200 touch-manipulation"
            >
              Close this tab &rarr;
            </button>

            {/* Brand mark */}
            <p className="mt-8 text-[9px] font-black tracking-[0.25em] text-white/10 uppercase">
              LifeScript Studio
            </p>

          </div>
        </motion.div>
      </div>
    </>
  );
}
