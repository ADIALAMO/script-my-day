import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Copyright, AlertCircle, Key, X, Download, Share2, Camera, MessageSquare, Send, Check } from 'lucide-react';
import Navbar from '../components/Navbar';
import LaunchTicket from '../components/LaunchTicket';
import ScriptForm from '../components/ScriptForm';
import ScriptOutput from '../components/ScriptOutput';
import { Analytics } from '@vercel/analytics/react';
import { track } from '@vercel/analytics';
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
  const [isTypingGlobal, setIsTypingGlobal] = useState(false);

  const [selectedGenre, setSelectedGenre] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [tempAdminKey, setTempAdminKey] = useState('');
  const [modalContent, setModalContent] = useState(null); // 'terms', 'privacy', 'support' או null
  const [showTips, setShowTips] = useState(false);
  const [showGallery, setShowGallery] = useState(true); // State חדש
  const [selectedPoster, setSelectedPoster] = useState(null);
  const [producerName, setProducerName] = useState('');  
// --- Director's Log Logic ---
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('idle'); // 'idle', 'sending', 'success'
const handleSendFeedback = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackStatus('sending');
    
    try {
      // פנייה ל-API שיצרנו ב-pages/api/feedback.js
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: feedbackText,
          lang: lang,
          producerName: producerName || (lang === 'he' ? 'אורח' : 'Guest')
        }),
      });

      if (response.ok) {
        setFeedbackStatus('success');
        
        // סגירה אוטומטית של התיבה אחרי הצלחה
        setTimeout(() => {
          setShowFeedback(false);
          setFeedbackStatus('idle');
          setFeedbackText('');
        }, 2500);
      } else {
        throw new Error('Server responded with error');
      }
    } catch (err) {
      console.error("Feedback error:", err);
      // במקרה של תקלה, נחזיר למצב רגיל כדי שיוכל לנסות שוב
      setFeedbackStatus('idle');
      alert(lang === 'he' ? 'תקלה בתקשורת עם השרת. נסה שוב.' : 'Communication error. Please try again.');
    }
  };

  useEffect(() => {
    setMounted(true);

    const unlockAudio = () => {
  let dramaAudio = document.getElementById('main-bg-music');
  
  if (!dramaAudio) {
    dramaAudio = new Audio('/audio/drama_bg.m4a');
    dramaAudio.id = 'main-bg-music';
    document.body.appendChild(dramaAudio); // הזרקה פיזית ל-DOM
  }
  
  dramaAudio.loop = true;
  dramaAudio.volume = 0.4;
  
  dramaAudio.play()
    .then(() => {
      console.log("Audio System Online");
      window.mainAudio = dramaAudio; // הופכים אותו לנגיש גלובלית
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    })
    .catch(e => console.log("Waiting for user gesture..."));
};

    window.addEventListener('click', unlockAudio);
    window.addEventListener('touchstart', unlockAudio);

    // ... שאר הקוד של ה-LocalStorage נשאר בדיוק אותו דבר ...
    const savedName = localStorage.getItem('lifescript_producer_name');
    if (savedName) setProducerName(savedName);

    const savedKey = localStorage.getItem('lifescript_admin_key');
    if (savedKey) setTempAdminKey(savedKey);

    if (!localStorage.getItem('lifescript_device_id')) {
      const newId = 'ds_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('lifescript_device_id', newId);
    }

    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
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
          producerName: producerName || (lang === 'he' ? 'אורח' : 'Guest'), // שם ברירת מחדל אם ריק
          deviceId: localStorage.getItem('lifescript_device_id'), // המזהה למכסה היומית
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
track('Script Created', { 
          genre: selectedGenre,
          language: lang,
          producer: producerName || 'Guest'
        });        console.log("✅ Script received successfully!");
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
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/95 backdrop-blur-xl px-6"
      onClick={() => setModalContent(null)}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0f1117] border border-[#d4a373]/20 p-8 md:p-12 pt-24 md:pt-32 rounded-[2.5rem] max-w-2xl w-full max-h-[85vh] overflow-y-auto relative custom-scrollbar shadow-2xl"
      >
       

        {modalContent === 'terms' && (
  <div className={lang === 'he' ? 'text-right' : 'text-left'} dir={lang === 'he' ? 'rtl' : 'ltr'}>
    <div className="flex items-center justify-between border-b border-[#d4a373]/10 pb-4 mb-6">
  <h2 className="text-[#d4a373] text-2xl font-black uppercase tracking-tighter italic">
{lang === 'he' ? 'תנאי שימוש - חוזה הפקה' : 'TERMS OF SERVICE - PRODUCTION CONTRACT'}  </h2>
  <button onClick={() => setModalContent(null)} className="text-white/20 hover:text-[#d4a373] transition-colors p-2">
    <X size={28} />
  </button>
</div>
    
    <div className="space-y-6 text-gray-300 text-sm md:text-base leading-relaxed overflow-y-auto max-h-[65vh] pr-2 custom-scrollbar">
      
      {/* 1. בעלות וקניין רוחני */}
      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? '1. בעלות על התוכן והיצירה' : '1. Ownership & Intellectual Property'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'כל זכויות הקניין הרוחני בתסריטים ובפוסטרים שנוצרו באמצעות LIFESCRIPT שייכות לך, המשתמש, באופן מלא ובלעדי. אתה חופשי לשתף, להפיץ ולהשתמש ביצירה לכל מטרה אישית.' 
            : 'All intellectual property rights in the scripts and posters created through LIFESCRIPT belong entirely and exclusively to you, the user. You are free to share, distribute, and use the work for any personal purpose.'}
        </p>
      </section>

      {/* 2. שימוש בבינה מלאכותית ואחריות לתוכן */}
      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? '2. טכנולוגיית AI ואחריות על התוכן' : '2. AI Technology & Content Responsibility'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'השירות מבוסס על מודלי בינה מלאכותית מתקדמים. המשתמש מבין כי התוכן עשוי להכיל אי-דיוקים עובדתיים, הטיות או טעויות גנרטיביות. האחריות על השימוש בתוכן והפצתו חלה על המשתמש בלבד.' 
            : 'The service is based on advanced AI models. The user understands that content may contain factual inaccuracies, biases, or generative errors. Responsibility for using and distributing the content lies solely with the user.'}
        </p>
      </section>

      {/* 3. הגבלות שימוש וקוד אתי */}
      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? '3. הגבלות שימוש וקוד אתי' : '3. Usage Restrictions & Ethics'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'חל איסור מוחלט להשתמש במערכת ליצירת תוכן פוגעני, אלים, מסית, פורנוגרפי או כזה המפר זכויות של צדדים שלישיים. המערכת שומרת לעצמה את הזכות לחסום גישה למשתמשים שיעשו שימוש לרעה בטכנולוגיה.' 
            : 'It is strictly forbidden to use the system to create offensive, violent, inciting, pornographic content, or content that violates the rights of third parties. The system reserves the right to block access to users who misuse the technology.'}
        </p>
      </section>

      {/* 4. הגבלת אחריות טכנית */}
      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? '4. הגבלת אחריות (Disclaimer)' : '4. Disclaimer of Warranties'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'השירות ניתן כפי שהוא ("AS IS"). LIFESCRIPT אינה מתחייבת לזמינות רציפה של השרתים או לכך שהתוצאה תתאים לציפיות המשתמש ב-100%. לא נהיה אחראים לכל נזק ישיר או עקיף הנובע מהשימוש באפליקציה.' 
            : 'The service is provided "AS IS". LIFESCRIPT does not guarantee continuous server availability or that the results will meet user expectations 100%. We will not be liable for any direct or indirect damage resulting from the use of the application.'}
        </p>
      </section>

      {/* 5. שינויים בשירות */}
      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? '5. עדכונים ושינויים' : '5. Updates & Changes'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'אנו שומרים לעצמנו את הזכות לעדכן את תנאי השימוש או לשנות את מאפייני השירות מעת לעת, ללא הודעה מוקדמת, בכדי להמשיך ולשפר את חווית ההפקה.' 
            : 'We reserve the right to update these terms or change service features from time to time, without prior notice, to continue improving the production experience.'}
        </p>
      </section>

      {/* 6. שימוש הוגן */}
      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? '6. מדיניות שימוש הוגן' : '6. Fair Use Policy'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'אנו מפעילים מדיניות שימוש הוגן בכדי למנוע עומס על המערכת. חל איסור על שימוש בבוטים או באמצעים אוטומטיים. אנו שומרים לעצמנו את הזכות להגביל את מכסת היצירה היומית לכל משתמש.' 
            : 'We operate a fair use policy to prevent system overload. The use of bots or automated tools is strictly prohibited. We reserve the right to limit the daily generation quota per user.'}
        </p>
      </section>

      {/* 7. מגבלת גיל */}
      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? '7. הגבלת גיל' : '7. Age Restriction'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'השימוש ב-LIFESCRIPT מיועד למשתמשים מעל גיל 13. בשימושך בשירות אתה מצהיר כי אתה עומד בתנאי הגיל הנדרשים.' 
            : 'Use of LIFESCRIPT is intended for users over the age of 13. By using the service, you represent that you meet the age requirements.'}
        </p>
      </section>

      {/* 8. שירותי צד ג' */}
      <section>
        <h3 className="text-white font-bold mb-2">
          {lang === 'he' ? '8. שירותי צד שלישי' : '8. Third-Party Services'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'השירות משתלב עם ספקי בינה מלאכותית חיצוניים (כגון OpenRouter, Cohere ו-Pollinations). LIFESCRIPT אינה אחראית לשינויים במדיניות או בזמינות של שירותים אלו.' 
            : 'The service integrates with third-party AI providers (e.g., OpenRouter, Cohere, and Pollinations). LIFESCRIPT is not responsible for changes in the policies or availability of these services.'}
        </p>
      </section>

      <div className="pt-6 text-center border-t border-white/5 opacity-50 text-[10px] tracking-widest uppercase">
        {lang === 'he' ? 'עודכן לאחרונה: ינואר 2026' : 'Last Updated: January 2026'}
      </div>

    </div>
  </div>
)}

       {modalContent === 'privacy' && (
  <div className={lang === 'he' ? 'text-right' : 'text-left'} dir={lang === 'he' ? 'rtl' : 'ltr'}>
    <div className="flex items-center justify-between border-b border-[#d4a373]/10 pb-4 mb-6">
  <h2 className="text-[#d4a373] text-2xl font-black uppercase tracking-tighter italic">
{lang === 'he' ? 'פרטיות וביטחון מידע' : 'PRIVACY & DATA SECURITY'}  </h2>
  <button onClick={() => setModalContent(null)} className="text-white/20 hover:text-[#d4a373] transition-colors p-2">
    <X size={28} />
  </button>
</div>
    
    <div className="space-y-6 text-gray-300 text-sm md:text-base leading-relaxed overflow-y-auto max-h-[65vh] pr-2 custom-scrollbar">
      
      {/* 1. מדיניות אי-אחסון */}
      <section>
        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#d4a373]"></span>
          {lang === 'he' ? '1. מדיניות "אפס אחסון" (Zero Storage)' : '1. Zero Storage Policy'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'התוכן האישי שלך הוא רכושך בלבד. הטקסטים שאתה מזין והתסריטים שנוצרים מעובדים בזמן אמת ונמחקים לצמיתות מהשרתים שלנו מיד עם סיום הסשן. אנחנו לא שומרים היסטוריית כתיבה מטעמי פרטיות.' 
            : 'Your personal content is yours alone. The texts you enter and the generated scripts are processed in real-time and permanently deleted from our servers immediately after the session ends. We do not store writing history for privacy reasons.'}
        </p>
      </section>

      {/* 2. קניין רוחני - חשוב מאוד ליוצרים */}
      <section>
        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#d4a373]"></span>
          {lang === 'he' ? '2. זכויות יוצרים וקניין רוחני' : '2. Intellectual Property'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'כל זכויות הקניין הרוחני על התסריטים שנוצרים באמצעות המערכת שייכות לך באופן מלא. LIFESCRIPT אינה טוענת לבעלות על הסיפורים, הדמויות או התכנים המופקים עבורך.' 
            : 'All intellectual property rights for the scripts generated through the system belong entirely to you. LIFESCRIPT claims no ownership over the stories, characters, or content produced for you.'}
        </p>
      </section>

      {/* 3. עיבוד AI - הניסוח המוגן שדיברנו עליו */}
      <section>
        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#d4a373]"></span>
          {lang === 'he' ? '3. עיבוד נתונים ע"י ספקי AI' : '3. AI Data Processing'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'המידע מועבר לספקי עיבוד מובילים (כגון Cohere ו-OpenRouter) בערוץ מוצפן. אנו בוחרים ספקים המחויבים חוזית לכך שהמידע המועבר אליהם אינו משמש לאימון מודלים ציבוריים ואינו נשמר לשימוש עתידי.' 
            : 'Data is transmitted to leading processors (e.g., Cohere and OpenRouter) via encrypted channels. We select providers who are contractually committed to ensuring that the data transmitted to them is not used for training public models and is not stored for future use.'}
        </p>
      </section>

      {/* 4. עוגיות ואבטחה מקומית */}
      <section>
        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#d4a373]"></span>
          {lang === 'he' ? '4. שימוש בטכנולוגיית אחסון מקומי' : '4. Local Storage Technology'}
        </h3>
        <p className="opacity-80">
          {lang === 'he' 
            ? 'המערכת משתמשת ב-LocalStorage כדי לשמור את מפתחות הגישה והגדרות השפה שלך על המכשיר האישי שלך בלבד. מידע זה אינו מועבר לצד שלישי ואינו משמש למעקב פרסומי.' 
            : 'The system uses LocalStorage to save your access keys and language settings on your personal device only. This information is not shared with third parties and is not used for advertising tracking.'}
        </p>
      </section>

      {/* הצהרה מסכמת */}
      <div className="bg-white/5 p-4 rounded-xl border border-white/5 mt-8 text-center italic text-[11px] md:text-xs text-[#d4a373]/80">
        {lang === 'he' 
          ? '"הפרטיות שלך היא התסריט הכי חשוב שאנחנו מגנים עליו."' 
          : '"Your privacy is the most important script we protect."'}
      </div>

    </div>
  </div>
)}

        {modalContent === 'support' && (
  <div className={lang === 'he' ? 'text-right' : 'text-left'} dir={lang === 'he' ? 'rtl' : 'ltr'}>
    <div className="flex items-center justify-between border-b border-[#d4a373]/10 pb-4 mb-6">
  <h2 className="text-[#d4a373] text-2xl font-black uppercase tracking-tighter italic">
{lang === 'he' ? 'מוקד תמיכה ופתרון תקלות' : 'PRODUCTION SUPPORT & FAQ'}  </h2>
  <button onClick={() => setModalContent(null)} className="text-white/20 hover:text-[#d4a373] transition-colors p-2">
    <X size={28} />
  </button>
</div>

    <div className="space-y-6 overflow-y-auto max-h-[65vh] pr-2 custom-scrollbar">
      
      {/* בעיה 1 - אורך טקסט */}
      <section className="bg-white/5 p-5 rounded-2xl border border-white/5 hover:border-[#d4a373]/20 transition-colors">
        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
          <span className="text-[#d4a373]">01.</span>
          {lang === 'he' ? 'הכפתור "צור תסריט" לא מגיב?' : 'Generate button not responding?'}
        </h3>
        <p className="text-gray-400 text-xs md:text-sm leading-relaxed">
          {lang === 'he' 
            ? 'הבינה המלאכותית זקוקה למינימום של 5 מילים כדי להתחיל לביים. הרחב מעט את התיאור ביומן והכפתור יפתח מיידית.' 
            : 'The AI needs at least 5 words to start directing. Expand your journal entry slightly and the button will activate.'}
        </p>
      </section>

      {/* בעיה 2 - פוסטר */}
      <section className="bg-white/5 p-5 rounded-2xl border border-white/5 hover:border-[#d4a373]/20 transition-colors">
        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
          <span className="text-[#d4a373]">02.</span>
          {lang === 'he' ? 'הפוסטר לא נטען או נראה ריק?' : 'Poster not loading or looks empty?'}
        </h3>
        <p className="text-gray-400 text-xs md:text-sm leading-relaxed">
          {lang === 'he' 
            ? 'רינדור גרפי הוא תהליך מורכב. אם הפוסטר לא הופיע תוך 10 שניות, לחץ שוב על כפתור היצירה. אין צורך לרענן את הדף.' 
            : 'Graphic rendering is a complex process. If the poster doesn\'t appear within 10 seconds, click Generate again. No need to refresh.'}
        </p>
      </section>

      {/* בעיה 3 - סאונד */}
      <section className="bg-white/5 p-5 rounded-2xl border border-white/5 hover:border-[#d4a373]/20 transition-colors">
        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
          <span className="text-[#d4a373]">03.</span>
          {lang === 'he' ? 'בעיות סאונד ומוזיקה?' : 'Sound or music issues?'}
        </h3>
        <p className="text-gray-400 text-xs md:text-sm leading-relaxed">
          {lang === 'he' 
            ? 'ודא שהמכשיר אינו על מצב שקט (Silent). בדפדפני מובייל, לעיתים יש ללחוץ על כפתור הרמקול בטופס כדי לאפשר למוזיקה להתחיל.' 
            : 'Ensure your device isn\'t on Silent mode. On mobile browsers, you might need to tap the speaker icon to enable audio.'}
        </p>
      </section>

      {/* בעיה 4 - הקפאה */}
      <section className="bg-white/5 p-5 rounded-2xl border border-white/5 hover:border-[#d4a373]/20 transition-colors">
        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
          <span className="text-[#d4a373]">04.</span>
          {lang === 'he' ? 'ההקלדה נעצרה באמצע?' : 'Typing stopped mid-way?'}
        </h3>
        <p className="text-gray-400 text-xs md:text-sm leading-relaxed">
          {lang === 'he' 
            ? 'במידה והתסריט הפסיק להיכתב, העתק את הטקסט שכתבת, רענן את הדף (Refresh) ונסה שוב. זה פותר 100% מתקלות התקשורת.' 
            : 'If the script stops writing, copy your text, refresh the page, and try again. This resolves 100% of connection issues.'}
        </p>
      </section>

      {/* הודעת סיום אסטרטגית */}
      <div className="pt-6 text-center border-t border-white/5">
        <p className="text-gray-500 text-[10px] uppercase tracking-widest mb-4">
          {lang === 'he' 
            ? 'אנחנו כרגע בשלב הרצה אקסקלוסיבית (Beta)' 
            : 'Currently in exclusive Beta phase'}
        </p>
        <div className="inline-block px-6 py-2 rounded-full bg-[#d4a373]/10 border border-[#d4a373]/20 text-[#d4a373] text-[11px] font-bold">
          {lang === 'he' ? 'המשך הפקה נעימה!' : 'Keep Directing!'}
        </div>
      </div>

    </div>
  </div>
)}

        {modalContent === 'about' && (
  <div className={lang === 'he' ? 'text-right' : 'text-left'} dir={lang === 'he' ? 'rtl' : 'ltr'}>
<div className="flex items-center justify-between border-b border-[#d4a373]/10 pb-4 mb-6">
  <h2 className="text-[#d4a373] text-2xl font-black uppercase tracking-tighter italic">
      {lang === 'he' ? 'אודות LIFESCRIPT: היומן הקולנועי הראשון מסוגו' : 'ABOUT LIFESCRIPT: THE FIRST CINEMATIC JOURNAL'}
</h2>
  <button onClick={() => setModalContent(null)} className="text-white/20 hover:text-[#d4a373] transition-colors p-2">
    <X size={28} />
  </button>
</div>    
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
  onSubmit={handleGenerateScript} 
  loading={loading || isTypingGlobal}
  lang={lang} 
  isTypingGlobal={isTypingGlobal}
  producerName={producerName}
  setProducerName={setProducerName}
  onInputChange={setIsTyping}
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

              {/* התיקון כאן: הגבלת גובה וגלילה פנימית */}
              <div className="max-h-[500px] overflow-y-auto overflow-x-hidden px-2 custom-gallery-scroll pb-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
                  {SHOWCASE_POSTERS.map((poster, index) => {
  // בדיקה אם הפוסטר הנוכחי נבחר (עבור אפקטים ויזואליים בגלריה)
  const isSelected = selectedPoster && selectedPoster.id === poster.id;
  return (
    <motion.div 
      key={poster.id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 }}
      // עדכון: לחיצה פותחת את המודל המוגדל עם האובייקט המלא
      onClick={() => setSelectedPoster(poster)}
      className={`group relative aspect-[2/3] overflow-hidden rounded-[2rem] border transition-all duration-500 cursor-pointer
        ${isSelected ? 'border-[#d4a373] shadow-[0_0_30px_rgba(212,163,115,0.2)]' : 'border-white/10 shadow-2xl hover:border-white/30'}`}
    >
      <img 
        src={poster.src} 
        alt={lang === 'he' ? poster.titleHe : poster.titleEn} 
        className={`w-full h-full object-cover transition-all duration-1000 
          ${isSelected ? 'scale-105 blur-[1px] brightness-[0.4]' : 'grayscale-[0.2] group-hover:grayscale-0'}`}
      />
      <div className={`absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent transition-all duration-500 flex flex-col justify-end p-4 md:p-6 text-right
        ${isSelected ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 md:group-hover:opacity-100 md:group-hover:translate-y-0'}`}>
        
        {/* כותרת ז'אנר בתוך הגלריה */}
        <div className="flex flex-col mb-1 md:mb-2">
          <span className="text-[#d4a373] text-[7px] md:text-[9px] font-black tracking-[0.2em] md:tracking-[0.3em] uppercase italic block">
            {lang === 'he' ? "ז'אנר:" : 'GENRE:'}
          </span>
          <span className="text-white text-[10px] md:text-xs font-bold tracking-widest uppercase">
            {lang === 'he' ? poster.titleHe : poster.titleEn}
          </span>
        </div>
        <div className={`h-[1px] md:h-[1.5px] bg-[#d4a373] transition-all duration-700 ${isSelected ? 'w-12 md:w-16' : 'w-0 group-hover:w-10'}`} />
      </div>
    </motion.div>
  );
})}
                </div>
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
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="mt-16 md:mt-24"
            >

<ScriptOutput 
  script={script} 
  lang={lang} 
  genre={selectedGenre} 
  setIsTypingGlobal={setIsTypingGlobal} // <--- שינינו מ-setIsTyping ל-setIsTypingGlobal
  producerName={producerName}
/>
         </motion.div>
          )}
        </AnimatePresence>
       {/* --- מודל הרחבה קטן ויוקרתי (Expanded Panel) --- */}
<AnimatePresence>
  {selectedPoster && (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => setSelectedPoster(null)}
      className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center p-6 pb-24 md:pb-10"
    >
      <motion.div 
        initial={{ scale: 0.9, y: 40 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 40 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0f1117]/95 border border-[#d4a373]/30 rounded-[2.5rem] shadow-[0_25px_100px_rgba(0,0,0,0.9)] w-full max-w-md overflow-hidden flex flex-col relative"
        style={{ maxHeight: '70vh' }} 
      >
        {/* כפתור סגירה (X) בלבד - אלמנט הניווט היחיד */}
        <button 
  onClick={(e) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectedPoster(null);
  }}
  /* הגדלנו את ה-Z-index והוספנו p-4 לשטח מגע גדול יותר */
  className="absolute right-6 text-white/40 hover:text-[#d4a373] transition-all duration-300 z-[9999] p-4 bg-black/20 backdrop-blur-md rounded-full group"
  style={{ 
    top: 'calc(var(--sat, 0px) + 16px)', // דוחף את הכפתור מתחת לשעון/אי הדינמי
    touchAction: 'manipulation'
  }}
>
  <X size={24} className="group-hover:rotate-90 transition-transform duration-500" />
</button>

        {/* תמונה מוקטנת למעלה עם גרדיאנט עמוק */}
        <div className="w-full h-40 relative">
          <img 
            src={selectedPoster.src} 
            className="w-full h-full object-cover opacity-50" 
            alt={selectedPoster.titleEn} 
          />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f1117] via-[#0f1117]/50 to-transparent" />
        </div>

        {/* תוכן הטקסט - מקסימום מקום לקריאה */}
        <div className="p-8 pt-0 pb-10 flex flex-col flex-grow overflow-hidden">
          <div className="mb-6">
            <span className="text-[#d4a373] text-[9px] font-black tracking-[0.3em] uppercase italic border-b border-[#d4a373]/20 pb-1">
              {lang === 'he' ? selectedPoster.titleHe : selectedPoster.titleEn}
            </span>
          </div>

          {/* אזור הטקסט עם גלילה פנימית חלקה */}
<div className="overflow-y-auto pr-3 custom-scrollbar flex-grow text-right">
  <p className="text-white/90 text-[1.1rem] md:text-xl leading-relaxed font-light whitespace-pre-line" 
     style={{ 
       fontFamily: "'Courier Prime', 'Courier New', monospace",
       direction: lang === 'he' ? 'rtl' : 'ltr',
       // whitespace-pre-line הוא המפתח כאן להפרדת השורות
     }}>
    {lang === 'he' ? selectedPoster.excerptHe : selectedPoster.excerptEn}
  </p>
</div>
        </div>
      </motion.div>
    </motion.div>
  )}
</AnimatePresence>
{/* --- Director's Log (Feedback Section) --- */}
<div className="mt-20 mb-4 w-full max-w-xl mx-auto px-6 relative z-50">
  <AnimatePresence mode='wait'>
    {!showFeedback ? (
      <motion.button
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        onClick={() => setShowFeedback(true)}
        className="w-full group relative overflow-hidden rounded-2xl bg-[#0f1117]/80 backdrop-blur-md border border-[#d4a373]/10 hover:border-[#d4a373]/40 transition-all duration-500 py-6 px-4 text-center cursor-pointer shadow-lg"
      >
        {/* אפקט ברק עדין ברקע */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#d4a373]/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
        
        <div className="flex flex-col items-center justify-center gap-2">
          <div className="p-2 rounded-full bg-[#d4a373]/10 text-[#d4a373] group-hover:scale-110 transition-transform duration-300">
            <MessageSquare size={20} />
          </div>
          <span className="text-[#d4a373] font-black tracking-[0.2em] text-xs uppercase">
            {lang === 'he' ? 'יומן הבמאי' : "DIRECTOR'S LOG"}
          </span>
          <p className="text-gray-500 text-[10px] font-light tracking-wide">
            {lang === 'he' ? 'יש לך הערות על ההפקה? שתף אותנו' : 'Notes on the production? Share with us'}
          </p>
        </div>
      </motion.button>
    ) : (
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        className="relative bg-[#0b0d12] border border-[#d4a373]/30 rounded-2xl shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden"
      >
        {/* פס זהב עליון */}
        <div className="absolute top-0 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-[#d4a373] to-transparent opacity-50" />
        
        {feedbackStatus === 'success' ? (
           <div className="py-10 flex flex-col items-center justify-center text-center animate-in fade-in zoom-in duration-500">
             <div className="w-14 h-14 rounded-full bg-[#d4a373]/10 border border-[#d4a373]/20 flex items-center justify-center mb-4 shadow-[0_0_30px_rgba(212,163,115,0.2)]">
               <Check className="text-[#d4a373]" size={24} />
             </div>
             <h3 className="text-white font-black tracking-[0.2em] uppercase text-sm mb-1">
               {lang === 'he' ? 'הפידבק התקבל' : "IT'S A WRAP!"}
             </h3>
             <p className="text-[#d4a373]/60 text-[10px] tracking-wider">
               {lang === 'he' ? 'תודה שעזרת לנו לביים טוב יותר.' : 'Thanks for helping us direct.'}
             </p>
           </div>
        ) : (
          <div className="p-5">
            <div className="flex justify-between items-center mb-4 border-b border-white/5 pb-3">
              <span className="text-[#d4a373] text-[10px] font-black tracking-[0.2em] uppercase">
                 {lang === 'he' ? 'הערות הפקה' : 'PRODUCTION NOTES'}
              </span>
              <button 
                onClick={() => setShowFeedback(false)}
                className="text-white/20 hover:text-white transition-colors p-1"
              >
                <X size={14} />
              </button>
            </div>
            
            <textarea
              autoFocus
              value={feedbackText}
              onChange={(e) => setFeedbackText(e.target.value)}
              placeholder={lang === 'he' 
                ? 'ספר לנו על החוויה... (באגים, רעיונות, או סתם מחשבות)' 
                : 'Tell us about the experience... (bugs, ideas, thoughts)'}
              className="w-full bg-[#030712] text-gray-300 text-sm p-4 rounded-xl border border-white/10 focus:border-[#d4a373]/40 outline-none resize-none h-32 custom-scrollbar placeholder:text-gray-700 placeholder:text-xs leading-relaxed transition-all"
              style={{ fontSize: '14px' }}
            />
            
            <div className="flex justify-between items-center mt-4">
               <span className="text-[9px] text-gray-600 uppercase tracking-widest">
                 {lang === 'he' ? 'נשלח ישירות לצוות הפיתוח' : 'Sent directly to dev team'}
               </span>
              <button
                onClick={handleSendFeedback}
                disabled={!feedbackText.trim() || feedbackStatus === 'sending'}
                className="flex items-center gap-2 bg-[#d4a373] text-black px-5 py-2 rounded-lg font-bold text-[10px] uppercase tracking-widest hover:bg-[#fefae0] transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(212,163,115,0.2)]"
              >
                {feedbackStatus === 'sending' ? (
                   <span className="animate-pulse">...</span>
                ) : (
                   <>
                     <span>{lang === 'he' ? 'שלח' : 'SEND'}</span>
                     <Send size={10} />
                   </>
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>
    )}
  </AnimatePresence>
</div>
      </main>
      
      {/* Footer המלוטש --- */}
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

        {/* קישורי משנה - גרסה דחוסה מקסימלית (Micro-Typography) */}
<div className={`flex flex-row justify-center items-center gap-0 w-full px-0.5 ${lang === 'he' ? 'flex-row-reverse' : 'flex-row'}`}>
  <button 
    onClick={() => setModalContent('about')}
    className="text-[#d4a373] hover:text-white transition-all duration-300 text-[6px] md:text-[9px] font-normal uppercase tracking-tighter whitespace-nowrap px-1"
  >
    {lang === 'he' ? 'אודות' : 'About'}
  </button>
  
  <span className="text-white/5 text-[5px] select-none opacity-50">|</span>

  <button 
    onClick={() => setModalContent('terms')}
    className="text-white/20 hover:text-[#d4a373]/50 transition-all duration-300 text-[6px] md:text-[9px] font-normal uppercase tracking-tighter whitespace-nowrap px-1"
  >
    {lang === 'he' ? 'תנאים' : 'Terms'}
  </button>

  <span className="text-white/5 text-[5px] select-none opacity-50">|</span>

  <button 
    onClick={() => setModalContent('privacy')}
    className="text-white/20 hover:text-[#d4a373]/50 transition-all duration-300 text-[6px] md:text-[9px] font-normal uppercase tracking-tighter whitespace-nowrap px-1"
  >
    {lang === 'he' ? 'פרטיות' : 'Privacy'}
  </button>

  <span className="text-white/5 text-[5px] select-none opacity-50">|</span>

  <button 
    onClick={() => setModalContent('support')}
    className="text-white/20 hover:text-[#d4a373]/50 transition-all duration-300 text-[6px] md:text-[9px] font-normal uppercase tracking-tighter whitespace-nowrap px-1"
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
   <Analytics />
   </div>
  );
}

export default HomePage;