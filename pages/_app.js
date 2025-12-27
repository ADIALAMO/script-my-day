// pages/_app.js
import '../styles/globals.css';
import Head from 'next/head';
import { useEffect } from 'react';

function MyApp({ Component, pageProps }) {
  
  useEffect(() => {
    // טריק קטן עבורך, הבמאי:
    // אם תיכנס לאתר שלך ותוסיף בסוף הכתובת ?admin=true
    // (לדוגמה: lifescript.co.il?admin=true)
    // המכשיר שלך יירשם אוטומטית כמנהל ולא תצטרך לפתוח Console.
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('admin') === 'true') {
      localStorage.setItem('lifescript_admin_key', 'LifeScript_Admin_2025_Success');
      console.log("Admin mode activated on this device!");
      // מנקה את הכתובת כדי שזה יראה נקי
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  return (
    <>
      <Head>
        <title>LIFESCRIPT STUDIO</title>
        {/* אופטימיזציה למובייל - מבטיח ששום דבר לא יחתוך את ה-UI */}
        <meta 
          name="viewport" 
          content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0, viewport-fit=cover" 
        />
        <meta name="theme-color" content="#0a0a0a" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <link rel="icon" href="/favicon.ico" />
      </Head>
      
      <main className="min-h-screen bg-[#0a0a0a] selection:bg-[#d4a373]/30">
        <Component {...pageProps} />
      </main>
    </>
  );
}

export default MyApp;