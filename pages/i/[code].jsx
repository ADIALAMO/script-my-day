import React, { useEffect } from 'react';
import Head from 'next/head';
import { motion } from 'framer-motion';
import { Film, Sparkles } from 'lucide-react';
import { lookupReferrer } from '../../lib/referral.js';

/**
 * Referral landing page — /i/<code>.
 *
 * SSR (getServerSideProps) so social crawlers (WhatsApp/FB/iMessage — which do NOT run JS)
 * receive a cinematic, personalized OG preview in the initial HTML. It also injects the
 * `ls_ref` cookie server-side (robust, no JS needed) so the referral is captured the moment
 * the invitee lands, then hands off to the normal app at `/`.
 */
export async function getServerSideProps(context) {
  const { code } = context.params;
  const base = (process.env.NEXTAUTH_URL || 'https://lifescript.app').replace(/\/$/, '');

  // Hebrew-first; fall back to English only when the browser clearly prefers it.
  const accept = (context.req.headers['accept-language'] || '').toLowerCase();
  const lang = accept.startsWith('en') ? 'en' : 'he';

  // Resolve the inviter (name personalizes the card). Unknown code → generic invite.
  const ref = await lookupReferrer(code);
  const name = ref?.name || '';

  // Inject the referral cookie server-side. (We intentionally do NOT set a public CDN cache
  // here — Set-Cookie + shared caching conflict — so attribution is always reliable.)
  const maxAge = 60 * 60 * 24 * 30; // 30 days
  context.res.setHeader('Set-Cookie', `ls_ref=${encodeURIComponent(code)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
  context.res.setHeader('Cache-Control', 'no-store');

  const ogImage = `${base}/api/og?name=${encodeURIComponent(name)}&lang=${lang}`;
  return { props: { code, name, lang, ogImage, inviteUrl: `${base}/i/${code}` } };
}

export default function InviteLanding({ code, name, lang, ogImage, inviteUrl }) {
  const isHe = lang === 'he';

  useEffect(() => {
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'referral_link_visit', { ref_code: code });
    }
  }, [code]);

  const ogTitle = isHe
    ? (name ? `הוזמנת על ידי ${name} לככב בפוסטר קולנועי משלך 🎬` : 'הוזמנת לככב בפוסטר קולנועי משלך 🎬')
    : (name ? `${name} invited you to star in your own movie poster 🎬` : "You're invited to star in your own movie poster 🎬");
  const ogDesc = isHe
    ? 'LIFESCRIPT הופך את היום שלך לתסריט קולנועי, פוסטר וקומיקס — עם הפנים שלך.'
    : 'LIFESCRIPT turns your day into a cinematic script, poster, and comic — starring you.';

  const heroTitle = isHe
    ? (name ? `${name} הזמין/ה אותך ל-LIFESCRIPT` : 'הוזמנת ל-LIFESCRIPT')
    : (name ? `${name} invited you to LIFESCRIPT` : "You're invited to LIFESCRIPT");
  const heroSub = isHe
    ? 'הפוך את היום שלך לפוסטר קולנועי — עם הפנים שלך ככוכב הראשי.'
    : 'Turn your day into a cinematic movie poster — starring your own face.';
  const cta = isHe ? 'התחל עכשיו →' : 'Start now →';
  const giftLine = isHe ? '🎁 חבר נתן לך פוסטר "לככב בסיפור" חינם' : '🎁 A friend gifted you a free "Star Yourself" poster';

  return (
    <>
      <Head>
        <title>{ogTitle}</title>
        <meta key="description" name="description" content={ogDesc} />
        <meta key="og:title" property="og:title" content={ogTitle} />
        <meta key="og:description" property="og:description" content={ogDesc} />
        <meta key="og:url" property="og:url" content={inviteUrl} />
        <meta key="og:image" property="og:image" content={ogImage} />
        <meta key="og:image:secure_url" property="og:image:secure_url" content={ogImage} />
        <meta key="twitter:title" name="twitter:title" content={ogTitle} />
        <meta key="twitter:description" name="twitter:description" content={ogDesc} />
        <meta key="twitter:image" name="twitter:image" content={ogImage} />
      </Head>

      <div dir={isHe ? 'rtl' : 'ltr'} className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden bg-[#030712] font-heebo">
        {/* Full-bleed brand backdrop — the studio title card behind everything */}
        <img src="/og-image.png" alt="" aria-hidden="true" className="absolute inset-0 w-full h-full object-cover" />
        {/* ~80% cinematic scrim — gradient lets the gold film-strip peek through the middle
            while keeping the floating card crisp and legible (darker top/bottom). */}
        <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-[#030712]/90 via-[#030712]/[0.76] to-[#030712]/95" />
        {/* Ambient amber glow for depth */}
        <div aria-hidden="true" className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[560px] h-[560px] rounded-full bg-[#d4a373]/10 blur-[120px]" />
        </div>

        <motion.div
          initial={{ opacity: 0, scale: 0.94, y: 22 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', damping: 26, stiffness: 300 }}
          className="relative z-10 w-full max-w-sm text-center"
        >
          <div className="relative bg-[#0a0a14] border border-[#d4a373]/15 rounded-[2.5rem] shadow-[0_40px_120px_rgba(0,0,0,0.95)] overflow-hidden px-8 pt-11 pb-9">
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-[#d4a373]/45 to-transparent" />

            <div className="flex justify-center mb-5">
              <div className="w-16 h-16 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/20 flex items-center justify-center shadow-[0_0_40px_rgba(212,163,115,0.18)]">
                <Film className="text-[#d4a373] w-8 h-8" />
              </div>
            </div>

            <p className="text-[9px] font-black tracking-[0.35em] text-[#d4a373]/55 uppercase mb-3">LIFESCRIPT</p>
            <h1 className="text-[22px] font-black text-white leading-tight mb-3">{heroTitle}</h1>
            <p className="text-white/45 text-[13px] leading-relaxed mb-5">{heroSub}</p>

            <div className="mb-6 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#d4a373]/10 border border-[#d4a373]/20">
              <Sparkles size={12} className="text-[#d4a373]" />
              <span className="text-[#d4a373] text-[11px] font-bold">{giftLine}</span>
            </div>

            <a
              href="/"
              className="block w-full bg-[#d4a373] hover:bg-[#e0b487] active:scale-[0.98] text-black font-black text-[15px] px-5 py-3.5 rounded-2xl transition-all duration-150 shadow-[0_4px_20px_rgba(212,163,115,0.3)]"
            >
              {cta}
            </a>

            <p className="mt-7 text-[9px] font-black tracking-[0.25em] text-white/10 uppercase">Adialamo Production</p>
          </div>
        </motion.div>
      </div>
    </>
  );
}
