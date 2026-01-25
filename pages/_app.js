// pages/_app.js
import { SpeedInsights } from '@vercel/speed-insights/react'; // ייבוא הרכיב החדש
import '../styles/globals.css';
import Head from 'next/head';
import { useEffect } from 'react';

function MyApp({ Component, pageProps }) {
  
  useEffect(() => {
    // מנגנון זיהוי מנהל מערכת - שומר על הפונקציונליות הקיימת
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === 'true') {
      localStorage.setItem('lifescript_admin_key', 'LifeScript_Admin_2025_Success');
      console.log("Admin mode activated on this device!");
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <>
      <Head>
  {/* יסודות ה-SEO והמותג */}
  <title>LIFESCRIPT | Your Life, Directed</title>
  <meta name="description" content="LIFESCRIPT: הופכים כל רגע בחיים ליצירת אמנות קולנועית. יומן תסריטים אישי שנותן לסיפור שלכם את הבמה הראויה לו." />

  {/* הגדרות תצוגה למובייל */}
  <meta 
    name="viewport" 
    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover" 
  />
  <meta name="theme-color" content="#030712" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />

  {/* הגדרות שיתוף גלובליות (Facebook, Instagram, WhatsApp) */}
  <meta property="og:title" content="LIFESCRIPT | Turn Your Life Into A Movie" />
  <meta property="og:description" content="החיים שלך הם סרט, הגיע הזמן לכתוב אותם. יומן תסריטים קולנועי בבימוי Adialamo Production." />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="LifeScript Studio" />
  <meta property="og:url" content="https://my-life-script.vercel.app/" />
  
  {/* התיקון הקריטי: כתובת מלאה לתמונה */}
  <meta property="og:image" content="https://my-life-script.vercel.app/og-image.png" />
  <meta property="og:image:secure_url" content="https://my-life-script.vercel.app/og-image.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />

  {/* אופטימיזציה לטוויטר / X */}
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="LIFESCRIPT | Your Life, Directed" />
  <meta name="twitter:description" content="הפוך את רגעי היום-יום שלך לתסריט הוליוודי. יומן תסריטים קולנועי אישי." />
  <meta name="twitter:image" content="https://my-life-script.vercel.app/og-image.png" />

  {/* נכסים ויזואליים של המערכת */}
  <link rel="icon" href="/icon.png" />
  <link rel="shortcut icon" href="/favicon.ico" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
</Head>
      
      {/* המבנה הראשי של האתר עם צבעי המותג והגדרות הבחירה */}
      <main className="min-h-screen bg-[#030712] selection:bg-[#d4a373]/30">
        <Component {...pageProps} />
      <SpeedInsights />
      </main>
    </>
  );
}

export default MyApp;