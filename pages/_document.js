import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="he" style={{ backgroundColor: '#030712' }}>
      <Head>
        {/*
          GA4 Consent Mode v2 — must execute before the GA loader script.
          Reads the stored consent decision synchronously from localStorage so that:
          - Returning users who accepted  → analytics_storage: 'granted'  (no delay)
          - Returning users who declined  → analytics_storage: 'denied'   (no delay)
          - First-time visitors           → analytics_storage: 'denied' + wait_for_update: 500
            (the CookieConsent banner fires gtag('consent','update') on acceptance)
          Using dangerouslySetInnerHTML in <Head> is the correct Pages-Router pattern for
          scripts that must precede all other JS — this string runs in the browser, not on
          the server, so localStorage is available.
        */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            window.dataLayer = window.dataLayer || [];
            function gtag() { dataLayer.push(arguments); }
            window.gtag = gtag;

            var analyticsState = 'denied';
            var alreadyDecided = false;
            try {
              var stored = localStorage.getItem('lifescript_cookie_v2');
              if (stored !== null) {
                var parsed = JSON.parse(stored);
                analyticsState = parsed.analytics ? 'granted' : 'denied';
                alreadyDecided = true;
              }
            } catch (e) {}

            var consentOpts = { analytics_storage: analyticsState, ad_storage: 'denied' };
            if (!alreadyDecided) consentOpts.wait_for_update = 500;
            gtag('consent', 'default', consentOpts);
          })();
        `}} />

        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#030712" />

        {/*
          Google Fonts, loaded non-render-blocking. The old @import in
          globals.css forced the browser to wait on this fetch before
          painting ANYTHING — including the dark background set moments
          below — which was a direct contributor to the white-flash-on-load
          gap (measured on Android Chrome, confirmed user-visible on iOS
          Safari). preload+media=print is the standard loadCSS pattern: the
          browser fetches it at normal priority without blocking first
          paint, then the onload swap applies it once ready. <noscript>
          keeps the font working with JS disabled.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/*
          A JSX onLoad prop on a <link> here would silently do nothing —
          verified via the actual build output: Next.js's static Document
          renderer drops unrecognized onX props entirely rather than
          serializing them, which would have left this stylesheet stuck at
          media="print" (and the fonts never applying) forever. Building
          the <link> imperatively, matching the two other inline <script>
          blocks already in this file, guarantees a real onload handler.
        */}
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            var link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://fonts.googleapis.com/css2?family=Courier+Prime&family=Heebo:wght@300;400;700;900&display=swap';
            link.media = 'print';
            link.onload = function() { this.media = 'all'; };
            document.head.appendChild(link);
          })();
        `}} />
        <noscript>
          <link
            rel="stylesheet"
            href="https://fonts.googleapis.com/css2?family=Courier+Prime&family=Heebo:wght@300;400;700;900&display=swap"
          />
        </noscript>

        {/* Web App Manifest — must be in _document so iOS reads it before hydration */}
        <link rel="manifest" href="/manifest.json" />

        {/* iOS standalone PWA */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        {/*
          black-translucent: status bar overlaps the app (we reserve space via
          safe-area-inset). Use "default" only if you want a separate opaque bar.
        */}
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="LifeScript" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />

        {/*
          iOS's home-screen launch screen (standalone display mode) ignores
          manifest.json's background_color/theme_color entirely — that's a
          Chrome/Android convention, not one WebKit has ever adopted. iOS
          instead requires apple-touch-startup-image links, each matched to
          one exact device via media query, pointing to a full-screen PNG
          (not an app icon). The single unqualified /icon.png link this used
          to be was neither correctly sized nor targeted, so iOS fell back to
          its own default: a plain white screen with the icon centered —
          confirmed as the likely cause of the white flash reported on
          home-screen launches specifically (a separate code path from the
          regular-navigation white flash, which is TTFB/paint-holding-bound
          and unrelated to this). Images generated to public/splash/,
          #030712 background matching the app's fixed dark theme, icon
          centered — see the same fixed-dark-theme choice already made for
          the Android splash/splash-dark pair.
        */}
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1290-2796.png" media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1179-2556.png" media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1284-2778.png" media="(device-width: 428px) and (device-height: 926px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1170-2532.png" media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1125-2436.png" media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1242-2688.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-828-1792.png" media="(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-1242-2208.png" media="(device-width: 414px) and (device-height: 736px) and (-webkit-device-pixel-ratio: 3) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-750-1334.png" media="(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />
        <link rel="apple-touch-startup-image" href="/splash/apple-splash-640-1136.png" media="(device-width: 320px) and (device-height: 568px) and (-webkit-device-pixel-ratio: 2) and (orientation: portrait)" />

        <style dangerouslySetInnerHTML={{ __html: `
          html, body { 
            background: #030712 !important; 
            margin: 0; padding: 0; 
            height: 100%; width: 100%;
            overflow: hidden; 
          }
          #global-loader {
            background: #030712 !important;
            position: fixed; inset: 0;
            display: flex; justify-content: center; align-items: center;
            z-index: 99999;
            pointer-events: none;
          }
          @keyframes pulse {
            0% { transform: scale(0.95); opacity: 0.6; }
            50% { transform: scale(1); opacity: 1; }
            100% { transform: scale(0.95); opacity: 0.6; }
          }
        `}} />
      </Head>
      
      <body style={{ backgroundColor: '#030712' }}>
        <div id="global-loader">
          {/*
            Sized to roughly match the apple-touch-startup-image icon
            proportion (~32% of the shorter screen dimension) rather than a
            fixed 80px — on an iOS home-screen launch, this is the first
            thing shown right after the native splash hands off, and the
            previous fixed size made the icon visibly jump smaller the
            instant that handoff happened. min() caps it on wide/desktop
            viewports, where this loader can also briefly appear.
          */}
          <img
            src="/icon.png"
            alt="LifeScript"
            style={{
              width: 'min(32vw, 180px)', height: 'min(32vw, 180px)',
              animation: 'pulse 2s infinite ease-in-out',
              borderRadius: '20%'
            }}
          />
        </div>

        <Main />
        <NextScript />

        <script dangerouslySetInnerHTML={{
          __html: `
            (function() {
              var removed = false;
              function removeLoader() {
                if (removed) return;
                removed = true;
                var loader = document.getElementById('global-loader');
                if (loader) {
                  loader.style.transition = 'opacity 0.4s ease';
                  loader.style.opacity = '0';
                  setTimeout(function() {
                    loader.style.display = 'none';
                  }, 420);
                }
                document.body.style.overflow = 'auto';
                document.documentElement.style.overflow = 'auto';
              }
              if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', removeLoader);
              } else {
                removeLoader();
              }
            })();
          `
        }} />
      </body>
    </Html>
  );
}