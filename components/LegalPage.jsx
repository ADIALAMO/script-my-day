import Head from 'next/head';
import Link from 'next/link';
import { useState } from 'react';
import { MODAL_DATA } from '../constants/modalData';
import { SITE_URL } from '../lib/site';

const PAGE_META = {
  privacy: {
    slug: 'privacy',
    he: {
      title: 'מדיניות פרטיות — LIFESCRIPT',
      desc:  'מדיניות הפרטיות המלאה של LIFESCRIPT Studio — מה אנחנו אוספים, איך אנחנו מגינים על המידע שלך, והזכויות שלך.',
    },
    en: {
      title: 'Privacy Policy — LIFESCRIPT',
      desc:  'Full Privacy Policy of LIFESCRIPT Studio — what we collect, how we protect your data, and your rights.',
    },
  },
  terms: {
    slug: 'terms',
    he: {
      title: 'תנאי שימוש — LIFESCRIPT',
      desc:  'תנאי השימוש המלאים של LIFESCRIPT Studio — בעלות על יצירות, מסלולים, חיוב וביטול.',
    },
    en: {
      title: 'Terms of Service — LIFESCRIPT',
      desc:  'Full Terms of Service for LIFESCRIPT Studio — content ownership, plans, billing, and cancellation.',
    },
  },
};

const SIBLING = { privacy: 'terms', terms: 'privacy' };

/**
 * Shared layout for /privacy and /terms static pages.
 *
 * Rendered server-side (getStaticProps on each page), so the full HTML is
 * present in the initial response — no JS required to read the content.
 * Language defaults to Hebrew (matching the app) and is togglable client-side.
 *
 * Used by pages/privacy.js and pages/terms.js.
 */
export default function LegalPage({ contentKey }) {
  const [lang, setLang] = useState('he');
  const isHe   = lang === 'he';
  const data   = MODAL_DATA[contentKey][lang];
  const meta   = PAGE_META[contentKey][lang];
  const slug   = PAGE_META[contentKey].slug;
  const sib    = SIBLING[contentKey];

  return (
    <>
      <Head>
        <title>{meta.title}</title>
        <meta name="description" content={meta.desc} />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={`${SITE_URL}/${slug}`} />
        {/* Override the app-level OG tags for these pages */}
        <meta key="og:title"       property="og:title"       content={meta.title} />
        <meta key="og:description" property="og:description" content={meta.desc} />
        <meta key="og:url"         property="og:url"         content={`${SITE_URL}/${slug}`} />
        <meta property="og:type" content="website" />
      </Head>

      <div
        dir={isHe ? 'rtl' : 'ltr'}
        style={{ fontFamily: '"Heebo", "Segoe UI", sans-serif' }}
        className="min-h-screen bg-[#030712] text-white"
      >
        {/* ── Sticky navigation bar ──────────────────────────────────────────── */}
        <header className="sticky top-0 z-40 bg-[#030712]/92 backdrop-blur-sm border-b border-white/[0.06]">
          <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link
              href="/"
              className="text-[#d4a373] hover:text-[#e0b487] transition-colors text-[13px] font-semibold"
            >
              {isHe ? 'חזרה לאפליקציה →' : '← Back to App'}
            </Link>

            {/* Language toggle */}
            <button
              onClick={() => setLang(isHe ? 'en' : 'he')}
              aria-label={isHe ? 'Switch to English' : 'עבור לעברית'}
              className="text-white/35 hover:text-white/70 text-[11px] font-mono tracking-widest transition-colors px-3 py-1.5 rounded-full border border-white/10 hover:border-white/25"
            >
              {isHe ? 'EN' : 'HE'}
            </button>
          </div>
        </header>

        {/* ── Page content ──────────────────────────────────────────────────── */}
        <main className="max-w-2xl mx-auto px-6 py-14">

          {/* Header block */}
          <div className="mb-10 pb-8 border-b border-white/[0.06]">
            <p className="text-[10px] font-black tracking-[0.35em] text-[#d4a373]/50 uppercase mb-3">
              LIFESCRIPT Studio
            </p>
            <h1 className="text-3xl font-black tracking-wide text-white leading-tight">
              {data.title}
            </h1>
            {data.summary && (
              <p className="mt-3 text-white/30 text-[12px] leading-relaxed">
                {data.summary}
              </p>
            )}
          </div>

          {/* Sections — rendered in static HTML, readable without JS */}
          <div className="space-y-0">
            {data.sections.map((section, i) => (
              <section
                key={i}
                className="border-b border-white/[0.05] py-8 last:border-none"
              >
                <h2 className="text-[#d4a373] font-bold text-[14px] mb-3 leading-snug">
                  {section.h}
                </h2>
                <p className="text-white/58 text-[13px] leading-[1.85]">
                  {section.p}
                </p>
              </section>
            ))}
          </div>

          {/* Footer links */}
          <div className="mt-14 pt-8 border-t border-white/[0.06] flex flex-col items-center gap-3 text-center">
            <p className="text-[10px] tracking-[0.3em] font-black text-white/15 uppercase">
              LIFESCRIPT Studio
            </p>
            <a
              href="mailto:adialamo@gmail.com"
              className="text-[#d4a373]/45 hover:text-[#d4a373] text-[12px] transition-colors"
            >
              adialamo@gmail.com
            </a>
            <Link
              href={`/${sib}`}
              className="text-white/20 hover:text-white/50 text-[11px] transition-colors"
            >
              {sib === 'privacy'
                ? (isHe ? 'מדיניות פרטיות' : 'Privacy Policy')
                : (isHe ? 'תנאי שימוש'     : 'Terms of Service')}
            </Link>
          </div>
        </main>
      </div>
    </>
  );
}
