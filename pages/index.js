import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Copyright, AlertCircle, Key, X, Download, Share2, Camera } from 'lucide-react';import Navbar from '../components/Navbar';
import ScriptForm from '../components/ScriptForm';
import ScriptOutput from '../components/ScriptOutput';
import { detectSuggestedGenre } from '../utils/input-processor';
import { SHOWCASE_POSTERS } from '../constants/showcase';const genreIcons = {
  sciFi: '🚀',
  horror: '👻',
  comedy: '😂',
  romance: '❤️',
  action: '🔥',
  drama: '🎭'
};

function HomePage() {
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('he');
  const [mounted, setMounted] = useState(false);
  
  const [selectedGenre, setSelectedGenre] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [tempAdminKey, setTempAdminKey] = useState('');
  const [modalContent, setModalContent] = useState(null); // 'terms', 'privacy', 'support' או null
  const [showTips, setShowTips] = useState(false);
  const [showGallery, setShowGallery] = useState(true); // State חדש

  useEffect(() => {
    setMounted(true);
    const savedKey = localStorage.getItem('lifescript_admin_key');
    if (savedKey) setTempAdminKey(savedKey);

    // יצירת/שליפת מזהה מכשיר קבוע - חיוני לעקיפת בעיות IP משתנה
    if (!localStorage.getItem('lifescript_device_id')) {
      const newId = 'ds_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('lifescript_device_id', newId);
    }
  }, []);
  
  const toggleLanguage = () => setLang(prev => prev === 'he' ? 'en' : 'he');

  const saveAdminKey = () => {
    const cleanKey = tempAdminKey.trim();
    
    if (cleanKey !== "") {
      // שמירת המפתח ב-LocalStorage
      localStorage.setItem('lifescript_admin_key', cleanKey);
      setTempAdminKey(cleanKey);
      setShowAdminPanel(false);
      
      // ניקוי שגיאות קודמות כדי להתחיל "דף חלק" עם המפתח החדש
      setError('');

      // הודעת עדכון קצרה ודינמית לפי שפה
      const updateMsg = lang === 'he' 
        ? 'המפתח עודכן. הוא ייבדק בעת יצירת התסריט.' 
        : 'Key updated. It will be verified during generation.';
      
      console.log(updateMsg);
      // אופציונלי: אפשר להשאיר alert קטן או להוריד אותו לגמרי כדי שיהיה יותר חלק
      // alert(updateMsg); 
    } else {
      setShowAdminPanel(false);
    }
  };
  const handleGenerateScript = async (journalEntry, genre) => {
    // 1. מניעת רענון ובדיקת תקינות בסיסית
    if (!journalEntry || journalEntry.trim().length < 5) return;
    
    setShowGallery(false);
    setLoading(true);
    setError('');
    setScript('');
    setSelectedGenre(genre);

    try {
      const savedAdminKey = localStorage.getItem('lifescript_admin_key') || '';
      const deviceId = localStorage.getItem('lifescript_device_id') || 'unknown';
      
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-key': savedAdminKey,
          'x-device-id': deviceId 
        },
        body: JSON.stringify({ 
          journalEntry, 
          genre,
          deviceId,
          adminKeyBody: savedAdminKey 
        }),
      });
      
      const data = await response.json();

      // 2. טיפול בשגיאות שרת מבלי להפיל את האפליקציה
      if (!response.ok) {
        throw new Error(data.message || data.error || 'Production Error');
      }
      
      // 3. חילוץ התסריט - תמיכה בכל הפורמטים האפשריים (script או output)
      const finalScript = data.script || data.output;
      
      if (finalScript) {
        setScript(finalScript);
        console.log("✅ Script received successfully!");
      } else {
        throw new Error('התקבלה תשובה ריקה מהשרת');
      }

    } catch (err) {
      console.error("Frontend Generation Error:", err);
      
      // זיהוי שגיאות נפוצות והצגתן למשתמש במקום רענון
      if (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized')) {
        setError(lang === 'he' 
          ? 'גישת מנהל נכשלה: הסיסמה שגויה או פגה.' 
          : 'Admin access failed: Incorrect or expired password.');
      } else if (err.message.includes('429')) {
        setError(lang === 'he' 
          ? 'המכסה היומית הסתיימה או שיש עומס. נסה שוב בעוד רגע.' 
          : 'Daily limit reached or system busy. Try again in a moment.');
      } else {
        setError(err.message || 'תקלה בתקשורת עם השרת');
      }
    } finally {
      setLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className={`min-h-screen text-white flex flex-col selection:bg-[#d4a373]/30 ${lang === 'he' ? 'font-heebo' : ''}`} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <Head>
        <title>LifeScript | Cinematic AI Studio</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="icon" href="/icon.png" />
       <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#030712" />
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@100;300;400;700;900&display=swap" rel="stylesheet" />
      </Head>

      {/* רקע גרדיאנט קולנועי */}
      <div className="mesh-gradient fixed inset-0 -z-10">
        <div className="mesh-sphere w-[600px] h-[600px] bg-purple-900/10 top-[-10%] left-[-10%]" />
        <div className="mesh-sphere w-[500px] h-[500px] bg-blue-900/10 bottom-[-10%] right-[-10%]" />
      </div>

      <Navbar lang={lang} onLanguageToggle={toggleLanguage} />

      <main className="container mx-auto pt-4 md:pt-8 pb-12 px-6 max-w-5xl flex-grow relative z-10">
        
      <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-6 md:mb-8 relative"
        >
        <div className="relative inline-block mb-4 group">
          {/* הילה חיצונית ופנימית - צומצמו מעט כדי לחסוך מקום אנכי */}
          <div className="absolute inset-[-15px] bg-[#d4a373]/10 blur-[30px] rounded-full opacity-50 pointer-events-none" />
          <div className="absolute inset-4 bg-[#d4a373]/20 blur-[20px] rounded-full pointer-events-none" />

          {/* גודל האייקון נשאר מרשים אך מותאם */}
          <div className="relative z-10 w-20 h-20 md:w-28 md:h-28 mx-auto rounded-[2rem] overflow-hidden border border-[#d4a373]/30 shadow-2xl backdrop-blur-sm bg-black/20 transition-transform duration-700 group-hover:scale-105">
            <img 
              src="/icon.png" 
              alt="LifeScript Studio Logo" 
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        <div className="block mb-4 relative">
          <div className="inline-block px-6 py-1.5 rounded-full border border-[#d4a373]/20 bg-gradient-to-r from-transparent via-[#d4a373]/5 to-transparent backdrop-blur-xl text-[#d4a373] text-[9px] md:text-[10px] font-black tracking-[0.4em] uppercase italic">
            {lang === 'he' ? 'חזון קולנועי' : 'Cinematic Vision'}
          </div>
        </div>
          
         <h1 
          onClick={() => setShowAdminPanel(!showAdminPanel)}
          className="text-5xl md:text-[7.5rem] font-black mb-3 bg-gradient-to-b from-[#d4a373] via-[#fefae0] to-[#d4a373] bg-clip-text text-transparent italic tracking-tighter uppercase leading-[0.8] cursor-pointer select-none drop-shadow-[0_10px_30px_rgba(212,163,115,0.2)]"
          style={{ 
            paddingLeft: '0.15em',
            paddingRight: '0.25em', 
            paddingTop: '0.05em',
            paddingBottom: '0.05em',
            display: 'inline-block'
          }}
        >
          LIFESCRIPT
        </h1>
          
          <p className="text-gray-400 text-lg md:text-xl font-light max-w-xl mx-auto leading-tight px-4 opacity-80">
            {lang === 'he' ? 'הפוך את היום שלך לתסריט קולנועי מרתק' : 'Turn your day into a captivating cinematic script'}
          </p>
        </motion.header>

        {/* פאנל ניהול סודי */}
       <AnimatePresence>
  {showAdminPanel && (
    <motion.div 
      initial={{ opacity: 0 }} 
      animate={{ opacity: 1 }} 
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl px-6"
      onClick={() => setShowAdminPanel(false)}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()} 
        className="bg-[#0f1117] border border-[#d4a373]/30 p-8 md:p-12 rounded-[2.5rem] shadow-2xl w-full max-w-lg relative text-center"
      >
        {/* כפתור סגירה */}
        <button 
          onClick={() => setShowAdminPanel(false)} 
          className="absolute top-6 right-6 text-white/20 hover:text-[#d4a373] transition-colors p-2"
        >
          <X size={24} />
        </button>

        <Key className="text-[#d4a373] mx-auto mb-4" size={48} />
        
        {/* כותרת דינמית */}
        <h2 className="text-3xl font-black text-white uppercase tracking-tighter">
          {lang === 'he' ? 'גישת מנהל' : 'ADMIN ACCESS'}
        </h2>
        
        {/* תיאור משני דינמי */}
        <p className="text-[#d4a373]/40 text-xs tracking-widest mt-2 uppercase">
          {lang === 'he' ? 'מורשים בלבד' : 'AUTHORIZED PERSONNEL ONLY'}
        </p>
        
        <div className="mt-10 space-y-6">
          {/* שדה הזנה עם Placeholder דינמי */}
          <input 
            type="password"
            value={tempAdminKey}
            autoFocus
            onChange={(e) => setTempAdminKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveAdminKey()}
            placeholder={lang === 'he' ? 'הזן קוד סודי...' : 'ENTER SECRET KEY...'}
            className="w-full bg-black/50 border border-white/10 p-6 rounded-2xl text-2xl text-white outline-none focus:border-[#d4a373] text-center tracking-[0.4em]"
          />
          
          {/* כפתור אישור דינמי */}
          <button 
            onClick={saveAdminKey} 
            className="w-full bg-[#d4a373] text-black py-6 rounded-2xl font-black text-xl hover:bg-white transition-all active:scale-95 shadow-xl shadow-[#d4a373]/20 uppercase"
          >
            {lang === 'he' ? 'אישור כניסה' : 'AUTHORIZE'}
          </button>
          
          {/* כפתור ביטול דינמי */}
          <button 
            onClick={() => setShowAdminPanel(false)} 
            className="text-white/30 hover:text-white text-sm uppercase tracking-widest block mx-auto transition-colors"
          >
            {lang === 'he' ? 'ביטול' : 'CANCEL'}
          </button>
        </div>
     </motion.div>
    </motion.div>
  )}
</AnimatePresence>
{/* --- Modal משפטי/תמיכה קולנועי --- */}
<AnimatePresence>
  {modalContent && (
    <motion.div 
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/95 backdrop-blur-xl px-6"
      onClick={() => setModalContent(null)}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0f1117] border border-[#d4a373]/20 p-8 md:p-12 pt-24 md:pt-32 rounded-[2.5rem] max-w-2xl w-full max-h-[85vh] overflow-y-auto relative custom-scrollbar shadow-2xl"
      >
        {/* כפתור סגירה משופר ומונמך כדי שלא יוסתר על ידי הלוגו */}
        <button 
          onClick={() => setModalContent(null)} 
          className="absolute top-8 right-6 md:top-10 md:right-10 text-white/40 hover:text-[#d4a373] transition-all duration-300 p-3 bg-white/5 hover:bg-white/10 rounded-full z-[210] group"
        >
          <X size={24} className="group-hover:rotate-90 transition-transform duration-500" />
        </button>

        {/* שאר התוכן של ה-About... */}

        {modalContent === 'terms' && (
          <div className={lang === 'he' ? 'text-right' : 'text-left'}>
            <h2 className="text-[#d4a373] text-2xl font-black mb-6 uppercase tracking-tighter border-b border-[#d4a373]/10 pb-4 italic">
              {lang === 'he' ? 'תנאי שימוש - חוזה הפקה' : 'TERMS OF SERVICE'}
            </h2>
            <div className="space-y-6 text-gray-400 text-sm leading-relaxed">
              <section>
                <h3 className="text-white font-bold mb-1">{lang === 'he' ? '1. בעלות על התוכן' : '1. Content Ownership'}</h3>
                <p>{lang === 'he' ? 'כל זכויות הקניין הרוחני בתסריטים ובפוסטרים שנוצרו שייכות למשתמש באופן מלא. LIFESCRIPT אינה טוענת לבעלות על היצירות שלך.' : 'All intellectual property rights for the generated content belong entirely to the user.'}</p>
              </section>
              <section>
                <h3 className="text-white font-bold mb-1">{lang === 'he' ? '2. שימוש בבינה מלאכותית' : '2. AI Generation'}</h3>
                <p>{lang === 'he' ? 'השירות משתמש במודלי שפה וגרפיקה מתקדמים. המשתמש מבין כי התוכן עשוי להכיל אי-דיוקים והוא באחריותו הבלעדית.' : 'Users acknowledge that AI content may contain inaccuracies and is their sole responsibility.'}</p>
              </section>
            </div>
          </div>
        )}

        {modalContent === 'privacy' && (
          <div className={lang === 'he' ? 'text-right' : 'text-left'}>
            <h2 className="text-[#d4a373] text-2xl font-black mb-6 uppercase tracking-tighter border-b border-[#d4a373]/10 pb-4 italic">
              {lang === 'he' ? 'פרטיות - הצהרת חיסוי' : 'PRIVACY POLICY'}
            </h2>
            <div className="space-y-6 text-gray-400 text-sm leading-relaxed">
              <section>
                <h3 className="text-white font-bold mb-1">{lang === 'he' ? '1. מדיניות אי-שמירה' : '1. Zero Storage'}</h3>
                <p>{lang === 'he' ? 'אנחנו לא שומרים את התסריטים או הפוסטרים שלך על השרתים שלנו. המידע מעובד ונמחק בסיום הסשן.' : 'We do not store your scripts or posters. Everything is processed and deleted after your session.'}</p>
              </section>
              <section>
                <h3 className="text-white font-bold mb-1">{lang === 'he' ? '2. אבטחה מקומית' : '2. Local Security'}</h3>
                <p>{lang === 'he' ? 'מפתחות הגישה (Admin Keys) נשמרים בדפדפן שלך בלבד ואינם מועברים לצד שלישי.' : 'Admin keys are stored locally on your device only.'}</p>
              </section>
            </div>
          </div>
        )}

        {modalContent === 'support' && (
          <div className="text-center py-4">
            <Camera className="text-[#d4a373] mx-auto mb-4 opacity-50" size={48} />
            <h2 className="text-[#d4a373] text-2xl font-black mb-6 uppercase tracking-tighter italic">
              {lang === 'he' ? 'תמיכה טכנית' : 'TECHNICAL SUPPORT'}
            </h2>
            <div className="bg-white/5 p-8 rounded-[2rem] border border-white/5">
              <p className="text-gray-300 mb-4">{lang === 'he' ? 'זקוק לעזרה בהפקה?' : 'Need assistance?'}</p>
              <a href="mailto:support@lifescript.studio" className="text-xl md:text-2xl font-bold text-white hover:text-[#d4a373] transition-colors break-words">
                support@lifescript.studio
              </a>
              <p className="text-[10px] text-gray-600 uppercase tracking-[0.3em] mt-8">Response time: 24h</p>
            </div>
          </div>
        )}
        {modalContent === 'about' && (
  <div className={lang === 'he' ? 'text-right' : 'text-left'} dir={lang === 'he' ? 'rtl' : 'ltr'}>
    <h2 className="text-[#d4a373] text-2xl font-black mb-6 uppercase tracking-tighter border-b border-[#d4a373]/10 pb-4 italic">
  {lang === 'he' ? 'אודות LIFESCRIPT: היומן הקולנועי הראשון מסוגו' : 'ABOUT LIFESCRIPT: THE FIRST CINEMATIC JOURNAL'}
</h2>
    
    <div className="space-y-8 text-gray-300 text-sm md:text-base leading-relaxed overflow-y-auto max-h-[65vh] pr-2 custom-scrollbar">
      <section>
        <h3 className="text-white font-bold mb-2 text-lg">
          {lang === 'he' ? 'החזון שלנו' : 'Our Vision'}
        </h3>
        <p>
          {lang === 'he' 
            ? 'כולנו חיים בתוך סיפור, אבל לעיתים קרובות מדי אנחנו שוכחים שאנחנו אלו שמחזיקים בעט. LIFESCRIPT נולדה כדי להעניק לך את הכיסא של הבמאי. זהו לא רק יומן אישי, אלא סטודיו לחיים – מרחב שבו המציאות היומיומית שלך פוגשת את הקסם של הקולנוע.' 
            : 'We all live in a story, but too often we forget that we hold the pen. LIFESCRIPT was born to give you the director’s chair. It’s not just a personal journal, but a life studio – a space where your daily reality meets the magic of cinema.'}
        </p>
      </section>

      <section className="bg-white/5 p-6 rounded-2xl border border-[#d4a373]/10">
        <h3 className="text-[#d4a373] font-bold mb-3 uppercase tracking-widest text-sm">
          {lang === 'he' ? "הלב שבפרויקט: תרפיה דרך עדשת הז'אנר" : 'The Heart of the Project: Genre Therapy'}
        </h3>
        <p className="mb-4">
          {lang === 'he' 
            ? 'לפעמים החיים מאתגרים, מתסכלים או שגרתיים. הלב של LIFESCRIPT הוא היכולת לבצע Reframing (מסגור מחדש) לחוויה האנושית:' 
            : 'Sometimes life is challenging, frustrating, or just routine. The heart of LIFESCRIPT is the ability to perform "Reframing" on the human experience:'}
        </p>
        <ul className="space-y-3 opacity-90">
          <li>• <strong>{lang === 'he' ? 'משבר הופך לקומדיה:' : 'Crisis to Comedy:'}</strong> {lang === 'he' ? 'להפוך יום עמוס בכעסים ל"קומדיה של טעויות" ותלמד לצחוק על מה שפעם הכעיס.' : 'Turn a day of anger into a "Comedy of Errors" and learn to laugh at what once frustrated you.'}</li>
          <li>• <strong>{lang === 'he' ? 'קושי הופך לגבורה:' : 'Hardship to Heroism:'}</strong> {lang === 'he' ? 'להפוך התמודדות מורכבת ל"סרט אקשן" שבו אתה הגיבור המנצח כנגד כל הסיכויים.' : 'Turn a complex struggle into an "Action Movie" where you are the hero winning against all odds.'}</li>
          <li>• <strong>{lang === 'he' ? 'שגרה הופכת לשירה:' : 'Routine to Poetry:'}</strong> {lang === 'he' ? 'להפוך רגעים פשוטים ל"סרט דוקומנטרי" פיוטי או ל"דרמה" מרגשת. השימוש בז\'אנרים מאפשר לקבל נקודת מבט חדשה.' : 'Turn simple moments into a poetic "Documentary" or a moving "Drama". Using different genres allows for a new, empowering perspective.'}</li>
        </ul>
      </section>

      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? 'מניצוץ אנושי לטכנולוגיה עם נשמה' : 'From Human Spark to Technology with Soul'}
        </h3>
        <p>
          {lang === 'he' 
            ? 'הפרויקט נולד מתוך מסע אישי של אמן ויוצר. בתהליך העבודה על אחת מיצירותיי, גיליתי את כוחו של ה-AI לא כתחליף ליצירה, אלא כשותף לדיאלוג שמאפשר לזקק רגש גולמי לחזון ויזואלי. LIFESCRIPT היא התוצאה: האינטואיציה של האמן והדיוק של הטכנולוגיה, בשירות הסיפור שלך.' 
            : 'This project was born from an artist\'s journey. While working on one of my pieces, I discovered the power of AI not as a replacement for creativity, but as a dialogue partner that refines raw emotion into visual vision. LIFESCRIPT is the result: Artist intuition meets technological precision, in service of your story.'}
        </p>
      </section>

      <section className="border-t border-white/5 pt-6">
        <h3 className="text-[#d4a373] font-bold mb-3">
          {lang === 'he' ? 'איך להפיק את המיטב מהחוויה?' : 'How to Get the Most Out of the Experience?'}
        </h3>
        <ul className="space-y-2">
          <li><strong>1. {lang === 'he' ? 'כתוב בכנות:' : 'Write Honestly:'}</strong> {lang === 'he' ? 'שפוך את מחשבות היום לתוך היומן בלי פילטרים.' : 'Pour your daily thoughts into the journal without filters.'}</li>
          <li><strong>2. {lang === 'he' ? 'בחר זווית חדשה:' : 'Choose a New Angle:'}</strong> {lang === 'he' ? 'בחר ז\'אנר שיעזור לך לראות את היום שעבר באור אחר.' : 'Pick a genre that helps you see your day in a different light.'}</li>
          <li><strong>3. {lang === 'he' ? 'שמור את הפוסטר:' : 'Save the Poster:'}</strong> {lang === 'he' ? 'בנה לעצמך ארכיון ויזואלי של מסע החיים שלך – יצירת אמנות אחת בכל יום.' : 'Build a visual archive of your life journey – one piece of art every day.'}</li>
        </ul>
      </section>

      <p className="text-center text-[10px] tracking-[0.6em] text-[#d4a373]/40 uppercase py-4">
        Don't just live your life. Direct it.
      </p>
    </div>
  </div>
)}
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
{/* --- התחלת הטמעה: מחליף את ה-motion.section הקיים --- */}
<motion.section 
  initial={{ opacity: 0, scale: 0.98 }}
  animate={{ opacity: 1, scale: 1 }}
  className={`glass-panel rounded-[3rem] overflow-hidden shadow-2xl relative ${(loading || isTyping) ? 'ai-loading-active' : ''}`}
>
  {/* כפתור הטיפים - ממוקם מעל המסגרת, צמוד למרכז */}
<div className="w-full flex justify-center mb-2 mt-4 relative z-[100]">
  <div className="flex flex-col items-center">
    <button 
      type="button"
      onClick={() => setShowTips(!showTips)}
      className="flex flex-col items-center gap-2 group transition-all duration-500"
    >
      <div className="w-10 h-10 rounded-full border border-[#d4a373]/30 flex items-center justify-center bg-[#030712] group-hover:bg-[#d4a373]/20 group-hover:border-[#d4a373] shadow-[0_0_20px_rgba(212,163,115,0.15)] transition-all duration-500">
        <span className="text-sm">💡</span>
      </div>
      <span className="text-[9px] font-black tracking-[0.3em] uppercase text-[#d4a373]/60 group-hover:text-[#d4a373] transition-all duration-300">
        {lang === 'he' ? 'טיפים להפקה' : 'PRODUCTION TIPS'}
      </span>
    </button>

    <AnimatePresence>
      {showTips && (
        <div key="global-overlay-wrapper">
          {/* Overlay גלובלי - חוסם את כל המסך לסגירה חלקה */}
          <div 
            className="fixed inset-0 w-screen h-screen bg-transparent z-[9998]" 
            onClick={(e) => {
              e.preventDefault();
              setShowTips(false);
            }}
          />

          {/* חלונית הטיפים - מופיעה מתחת לכפתור, מעל המסגרת */}
          <motion.div 
            initial={{ opacity: 0, y: 10, x: '-50%', scale: 0.95 }}
            animate={{ opacity: 1, y: 0, x: '-50%', scale: 1 }}
            exit={{ opacity: 0, y: 10, x: '-50%', scale: 0.95 }}
            className="absolute top-20 left-1/2 w-80 bg-[#0b0d12]/95 border border-[#d4a373]/30 p-8 rounded-[2rem] shadow-[0_25px_100px_rgba(0,0,0,0.8)] z-[9999] backdrop-blur-3xl"
            dir={lang === 'he' ? 'rtl' : 'ltr'}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#d4a373] text-[8px] font-black px-3 py-1 rounded-full text-black tracking-widest uppercase">
              {lang === 'he' ? 'הנחיות בימוי' : 'Director Notes'}
            </div>

            <h4 className="text-[#d4a373] font-black text-xs mb-6 uppercase tracking-widest italic border-b border-[#d4a373]/10 pb-3 text-center">
              {lang === 'he' ? 'איך להפיק את המיטב?' : 'HOW TO DIRECT?'}
            </h4>
            
            <ul className="space-y-5">
              {[
                { 
                  id: "01", 
                  title: lang === 'he' ? 'כתוב בכנות' : 'Write Honestly', 
                  desc: lang === 'he' ? 'שפוך את מחשבות היום בלי פילטרים.' : 'Pour your thoughts without filters.' 
                },
                { 
                  id: "02", 
                  title: lang === 'he' ? 'בחר זווית חדשה' : 'Pick a New Angle', 
                  desc: lang === 'he' ? 'בחר ז\'אנר שיעזור לך לראות את היום באור אחר.' : 'Pick a genre for a new perspective.' 
                },
                { 
                  id: "03", 
                  title: lang === 'he' ? 'שמור את הפוסטר' : 'Save the Poster', 
                  desc: lang === 'he' ? 'בנה ארכיון ויזואלי של מסע החיים שלך.' : 'Build a visual archive of your journey.' 
                }
              ].map((item) => (
                <li key={item.id} className="flex items-start gap-3">
                  <span className="text-[10px] font-black text-[#d4a373]">{item.id}.</span>
                  <p className="text-[11px] leading-relaxed text-gray-300">
                    <strong className="text-white block mb-0.5">{item.title}</strong>
                    {item.desc}
                  </p>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  </div>
</div>
     <div className="bg-[#030712]/60 backdrop-blur-3xl p-8 md:p-16 relative">
 <ScriptForm
      onGenerateScript={handleGenerateScript} 
      loading={loading} 
      lang={lang} 
      isTyping={isTyping}
      selectedGenre={selectedGenre} // הוספנו את זה כדי שהטופס ידע מה האייקון הנוכחי
      genreIcons={genreIcons}
      onInputChange={(text) => {
        const suggested = detectSuggestedGenre(text);
        if (suggested !== selectedGenre) setSelectedGenre(suggested);
      }}
    />

    {/* שמירה על מנגנון השגיאות המקורי שלך */}
    <AnimatePresence>
      {error && (
        <motion.div 
          initial={{ opacity: 0, y: 10 }} 
          animate={{ opacity: 1, y: 0 }} 
          exit={{ opacity: 0, y: -10 }} 
          className="mt-10 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-4 text-red-400 text-xl md:text-2xl font-bold text-center"
        >
          <AlertCircle size={28} />
          <span>{error}</span>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
</motion.section>
{/* --- גלריית השראות קולנועית --- */}
<AnimatePresence>
  {showGallery && !script && (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
      className="mt-16 mb-10"
    >
      <div className="text-center mb-10">
        <h3 className="text-[#d4a373] text-[10px] font-black tracking-[0.5em] uppercase mb-2 opacity-60">
          {lang === 'he' ? 'גלריית הפקות' : 'PRODUCTION SAMPLES'}
        </h3>
        <div className="h-[1px] w-20 bg-[#d4a373]/30 mx-auto" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8 px-4">
  {SHOWCASE_POSTERS.map((poster, index) => (
    <motion.div 
      key={poster.id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }} // אפקט כניסה מדורג ויוקרתי
      className="group relative aspect-[2/3] overflow-hidden rounded-[2rem] border border-white/10 shadow-2xl transition-all duration-500 hover:border-[#d4a373]/50"
    >
      <img 
        src={poster.src} 
        alt={lang === 'he' ? poster.titleHe : poster.titleEn} 
        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110 grayscale-[0.2] group-hover:grayscale-0"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 flex flex-col justify-end p-6">
        <span className="text-[#d4a373] text-[10px] font-black tracking-widest uppercase italic mb-1">
          {lang === 'he' ? 'ז\'אנר:' : 'GENRE:'}
        </span>
        <span className="text-white text-xs font-bold tracking-wider">
          {lang === 'he' ? poster.titleHe : poster.titleEn}
        </span>
      </div>
    </motion.div>
  ))}
</div>
    </motion.section>
  )}
</AnimatePresence>

        {/* תצוגת התסריט והפוסטר */}
       <AnimatePresence mode="wait">
          {script && !loading && (
            <motion.div 
              initial={{ opacity: 0, y: 40 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.8, ease: "easeOut" }} // הוסף את השורה הזו
              className="mt-16 md:mt-24"
            >
              <ScriptOutput script={script} lang={lang} genre={selectedGenre} setIsTypingGlobal={setIsTyping} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

     {/* Footer המלוטש - היררכיה הוליוודית קבועה */}
      <footer className="py-12 md:py-16 text-center border-t border-white/[0.03] bg-black/40 mt-10 px-4">
        <div className="flex flex-col items-center justify-center">
          
          {/* מיתוג ראשי */}
          <div className="flex items-center gap-3 mb-4 opacity-90">
            <img 
              src="/icon.png" 
              className="w-6 h-6 md:w-7 md:h-7 rounded-md opacity-80 grayscale hover:grayscale-0 transition-all duration-700" 
              alt="Studio Icon" 
            />
            <span className="text-white font-black tracking-[0.4em] md:tracking-[0.5em] text-sm md:text-lg italic uppercase leading-none">
              LIFESCRIPT STUDIO
            </span>
          </div>

          {/* שורת זכויות יוצרים */}
          <p className="text-gray-500 text-[8px] md:text-[10px] tracking-[0.15em] uppercase flex items-center gap-2 mb-6 opacity-40 font-medium">
            <Copyright size={9} /> 2025 BY ADIALAMO • ALL RIGHTS RESERVED
          </p>

          {/* קישורי משנה - מותאמים לשורה אחת במובייל */}
          <div className={`flex flex-row justify-center items-center gap-3 md:gap-8 text-[7px] md:text-[9px] font-bold tracking-[0.1em] md:tracking-widest ${lang === 'he' ? 'flex-row-reverse' : 'flex-row'}`}>
            <button 
              onClick={() => setModalContent('about')}
              className="text-[#d4a373] hover:text-white transition-all duration-500 border-b border-[#d4a373]/30 pb-0.5 uppercase whitespace-nowrap"
            >
              {lang === 'he' ? 'אודות' : 'About'}
            </button>
            <button 
              onClick={() => setModalContent('terms')}
              className="text-white/20 hover:text-[#d4a373]/50 transition-all duration-500 border-b border-transparent hover:border-[#d4a373]/20 pb-0.5 uppercase whitespace-nowrap"
            >
              {lang === 'he' ? 'תנאי שימוש' : 'Terms'}
            </button>
            <button 
              onClick={() => setModalContent('privacy')}
              className="text-white/20 hover:text-[#d4a373]/50 transition-all duration-500 border-b border-transparent hover:border-[#d4a373]/20 pb-0.5 uppercase whitespace-nowrap"
            >
              {lang === 'he' ? 'פרטיות' : 'Privacy'}
            </button>
            <button 
              onClick={() => setModalContent('support')}
              className="text-white/20 hover:text-[#d4a373]/50 transition-all duration-500 border-b border-transparent hover:border-[#d4a373]/20 pb-0.5 uppercase whitespace-nowrap"
            >
              {lang === 'he' ? 'תמיכה' : 'Support'}
            </button>
          </div>

        </div>
      </footer>

      <style jsx global>{`
        :root { font-size: 18px; }
        @media (min-width: 768px) { :root { font-size: 20px; } }
        .font-heebo { font-family: 'Heebo', sans-serif !important; }
        .glass-panel {
          border: 1px solid rgba(212, 163, 115, 0.15);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        input, textarea, select, button { font-size: 1.2rem !important; }
        @media screen and (max-width: 768px) {
          input, textarea, select { font-size: 16px !important; }
        }
        .custom-scrollbar::-webkit-scrollbar { width: 6px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(212, 163, 115, 0.2); border-radius: 10px; }
      `}</style>
    </div>
  );
}

export default HomePage;