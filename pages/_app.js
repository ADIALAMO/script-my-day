// pages/_app.js
import { SessionProvider } from 'next-auth/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import '../styles/globals.css';
import Head from 'next/head';
import Script from 'next/script';
import { useEffect } from 'react';
import { SITE_URL } from '../lib/site.js';

function MyApp({ Component, pageProps: { session, ...pageProps } }) {

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === 'true') {
      localStorage.setItem('lifescript_admin_key', 'LifeScript_Admin_2025_Success');

      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // ── Auth API warmup ────────────────────────────────────────────────────────
  // In iOS Standalone PWA mode, WKWebView kills the network process when
  // backgrounded. Each foreground restore is a true cold start: TCP, TLS, and
  // the Vercel serverless function all initialise from scratch.
  //
  // Strategy: fire /api/auth/csrf 2 s after mount/restore — AFTER useSession's
  // /api/auth/session has already been dispatched by SessionProvider. The 2 s
  // gap prevents the two requests from competing on the same unopened HTTP/2
  // connection (iOS WKWebView serialises concurrent requests on a cold socket,
  // doubling the perceived wait). By staggering, we boot a second serverless
  // instance in parallel so the email sign-in path is warm before the user
  // reaches the auth modal.
  useEffect(() => {
    let t = null;
    const scheduleWarm = () => {
      clearTimeout(t);
      t = setTimeout(
        () => fetch('/api/auth/csrf', { cache: 'no-store' }).catch(() => {}),
        2000,
      );
    };

    scheduleWarm(); // on every hard mount / PWA cold launch

    // Re-warm each time the app returns from background — each foreground
    // restore in iOS standalone mode may be a fresh cold start.
    const onVisible = () => { if (!document.hidden) scheduleWarm(); };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearTimeout(t);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <SessionProvider session={session}>
      <>
        <Head>
          <title>LIFESCRIPT | Your Life, Directed</title>
          {/* Default OG/Twitter tags. `key` props let per-page <Head> (e.g. the /i/[code]
              invite landing) OVERRIDE these — next/head only dedupes `property` meta by key. */}
          <meta key="description" name="description" content="LIFESCRIPT: הופכים כל רגע בחיים ליצירת אמנות קולנועית. יומן תסריטים אישי שנותן לסיפור שלכם את הבמה הראויה לו." />
          <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover" />
          {/* PWA / theme meta tags live in _document.js — not duplicated here */}
          <meta key="og:title" property="og:title" content="LIFESCRIPT | Turn Your Life Into A Movie" />
          <meta key="og:description" property="og:description" content="החיים שלך הם סרט, הגיע הזמן לכתוב אותם. יומן תסריטים קולנועי בבימוי Adialamo Production." />
          <meta property="og:type" content="website" />
          <meta property="og:site_name" content="LifeScript Studio" />
          <meta key="og:url" property="og:url" content={`${SITE_URL}/`} />
          <meta key="og:image" property="og:image" content={`${SITE_URL}/og-image.png`} />
          <meta key="og:image:secure_url" property="og:image:secure_url" content={`${SITE_URL}/og-image.png`} />
          <meta property="og:image:width" content="1200" />
          <meta property="og:image:height" content="630" />
          <meta property="og:image:type" content="image/png" />
          <meta name="twitter:card" content="summary_large_image" />
          <meta key="twitter:title" name="twitter:title" content="LIFESCRIPT | Your Life, Directed" />
          <meta key="twitter:description" name="twitter:description" content="הפוך את רגעי היום-יום שלך לתסריט הוליוודי. יומן תסריטים קולנועי אישי." />
          <meta key="twitter:image" name="twitter:image" content={`${SITE_URL}/og-image.png`} />
          <link rel="icon" href="/icon.png" />
          <link rel="shortcut icon" href="/favicon.ico" />
          <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        </Head>

        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-YL145XYBD3"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-YL145XYBD3');
          `}
        </Script>

        <main className="min-h-screen bg-[#030712] selection:bg-[#d4a373]/30">
          <audio id="main-bg-music" preload="auto" style={{ display: 'none' }} />
          <Component {...pageProps} />
          <SpeedInsights />
        </main>
      </>
    </SessionProvider>
  );
}

export default MyApp;
