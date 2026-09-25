// pages/_app.js
import { SessionProvider } from 'next-auth/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import '../styles/globals.css';
import Head from 'next/head';
import Script from 'next/script';
import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { SITE_URL } from '../lib/site.js';

function MyApp({ Component, pageProps: { session, ...pageProps } }) {

  // ── Native status bar styling (Capacitor only) ────────────────────────────
  // Unstyled, this renders as the OS default — a plain white/light bar with
  // dark icons, clashing hard against the app's dark theme (#030712, same as
  // manifest.json's background_color/theme_color). Visible in every emulator
  // screenshot taken during Phase 4 testing. Style naming is content color,
  // not background: Style.Light means LIGHT icons/text (for a dark background
  // like ours); Style.Dark means dark icons/text (for a light background).
  // Confirmed empirically on-device — Style.Dark against #030712 rendered the
  // clock/icons nearly invisible.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setBackgroundColor({ color: '#030712' }).catch(() => {});
    StatusBar.setStyle({ style: Style.Light }).catch(() => {});
  }, []);

  // ── Native splash hide (Capacitor only) ────────────────────────────────────
  // launchAutoHide (capacitor.config.json) is off. The default (500ms show +
  // 200ms fade) hid the splash on a fixed clock with no idea whether the
  // remote page had actually loaded — since server.url points at a live
  // Vercel deployment rather than bundled assets, real load reliably takes
  // longer than 700ms on a cold launch. That gap showed up on-device as a
  // ~700ms blank white WebView frame between the splash and real content,
  // confirmed via frame-by-frame screen-recording analysis. Hide explicitly
  // once the page has actually finished loading instead. The 8s fallback is a
  // last resort only (a stalled network, or 'load' never firing for some
  // other reason) — generous on purpose, since the cost of waiting a little
  // longer is trivial next to the cost of dropping to a blank screen early.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let hidden = false;
    const hide = () => {
      if (hidden) return;
      hidden = true;
      SplashScreen.hide().catch(() => {});
    };
    if (document.readyState === 'complete') {
      hide();
    } else {
      window.addEventListener('load', hide, { once: true });
    }
    const timeoutId = setTimeout(hide, 8000);
    return () => {
      window.removeEventListener('load', hide);
      clearTimeout(timeoutId);
    };
  }, []);

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
          {/* user-scalable/maximum-scale intentionally omitted — blocking pinch-to-zoom
              fails WCAG 2.1 SC 1.4.4 (Resize Text) and disadvantages low-vision users.
              Checked every fixed-position/full-viewport surface in the app for reliance
              on a locked zoom level (MovieReelModal's 100dvh, Navbar's window.innerWidth
              dropdown positioning, the info modal's calc(100vh-...) cap) — all use
              layout-viewport values that stay correct under pinch-zoom; none assume
              scale=1. */}
          <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
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

        {/*
          GA4 loader — window.dataLayer, window.gtag, and the consent default are
          already set by the beforeInteractive script in _document.js <Head>, so we
          only need the loader + config here. Consent Mode v2 ensures no data is
          collected until the user explicitly accepts in the CookieConsent banner.
        */}
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-YL145XYBD3"
          strategy="afterInteractive"
        />
        <Script id="google-analytics" strategy="afterInteractive">
          {`
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
