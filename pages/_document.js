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
        <link rel="apple-touch-startup-image" href="/icon.png" />

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
          <img 
            src="/icon.png" 
            alt="LifeScript" 
            style={{ 
              width: '80px', height: '80px', 
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