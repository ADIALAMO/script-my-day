import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html lang="he" style={{ backgroundColor: '#030712' }}>
      <Head>
        <meta name="color-scheme" content="dark" />
        <meta name="theme-color" content="#030712" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
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
              function removeLoader() {
                var loader = document.getElementById('global-loader');
                if (loader) {
                  loader.style.transition = 'opacity 0.4s ease';
                  loader.style.opacity = '0';
                  setTimeout(function() {
                    loader.style.display = 'none';
                    document.body.style.overflow = 'auto';
                  }, 400);
                }
              }
              if (document.readyState === 'complete') {
                removeLoader();
              } else {
                window.addEventListener('load', removeLoader);
              }
            })();
          `
        }} />
      </body>
    </Html>
  );
}