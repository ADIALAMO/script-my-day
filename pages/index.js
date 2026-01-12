import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Copyright, AlertCircle, Key, X, Download, Share2, Camera } from 'lucide-react';import Navbar from '../components/Navbar';
import ScriptForm from '../components/ScriptForm';
import ScriptOutput from '../components/ScriptOutput';
import { detectSuggestedGenre } from '../utils/input-processor';

const genreIcons = {
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
    setLoading(true);
    setError('');
    setScript('');
    setSelectedGenre(genre);

    try {
      const savedAdminKey = localStorage.getItem('lifescript_admin_key') || '';
      const deviceId = localStorage.getItem('lifescript_device_id') || 'unknown';
      
      // שליחת הבקשה ל-API עם כל המזהים הנדרשים
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
      if (!response.ok) throw new Error(data.message || 'Error');
      
      setScript(data.script);
    } catch (err) {
      // זיהוי שגיאת אימות (401) מה-API בוורסל
      if (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized')) {
        setError(lang === 'he' 
          ? 'גישת מנהל נכשלה: הסיסמה שגויה או פגה.' 
          : 'Admin access failed: Incorrect or expired password.');
      } else {
        setError(err.message);
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

      <main className="container mx-auto py-12 md:py-24 px-6 max-w-5xl flex-grow relative z-10">
        
      <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12 md:mb-20 relative"
        >
          {/* האייקון בגודל המקורי והמרשים */}
          <div className="relative inline-block mb-8">
            <div className="absolute inset-0 bg-[#d4a373] blur-[50px] opacity-20" />
            
            <div className="relative w-24 h-24 md:w-32 md:h-32 mx-auto rounded-[2rem] overflow-hidden border-2 border-[#d4a373]/30 shadow-2xl">
              <img 
                src="/icon.png" 
                alt="LifeScript Studio Logo" 
                className="w-full h-full object-cover"
              />
            </div>
          </div>

          <div className="block mb-6">
            <div className="inline-block px-6 py-2 rounded-full border border-[#d4a373]/30 bg-[#d4a373]/5 text-[#d4a373] text-sm md:text-base font-bold tracking-[0.3em] uppercase">
              {lang === 'he' ? 'חזון קולנועי' : 'Cinematic Vision'}
            </div>
          </div>
          
          <h1 
            onClick={() => setShowAdminPanel(!showAdminPanel)}
            className="text-6xl md:text-[9rem] font-black mb-6 bg-gradient-to-b from-[#d4a373] via-[#fefae0] to-[#d4a373] bg-clip-text text-transparent italic tracking-tighter uppercase leading-[0.85] pt-4 cursor-pointer select-none drop-shadow-[0_10px_30px_rgba(212,163,115,0.2)]"
          >
            LIFESCRIPT
          </h1>
          
          <p className="text-gray-300 text-2xl md:text-3xl font-light max-w-2xl mx-auto leading-relaxed px-4 opacity-90">
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
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/95 backdrop-blur-xl px-6"
      onClick={() => setModalContent(null)}
    >
      <motion.div 
        initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-[#0f1117] border border-[#d4a373]/20 p-8 md:p-12 rounded-[2.5rem] max-w-2xl w-full max-h-[85vh] overflow-y-auto relative custom-scrollbar shadow-2xl shadow-[#d4a373]/5"
      >
        <button onClick={() => setModalContent(null)} className="absolute top-6 right-6 text-white/20 hover:text-[#d4a373] transition-colors p-2">
          <X size={24} />
        </button>

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
  <div className="bg-[#030712]/60 backdrop-blur-3xl p-8 md:p-16">
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
      <footer className="py-16 text-center border-t border-white/[0.03] bg-black/40 mt-10">
        <div className="flex flex-col items-center justify-center">
          
          {/* מיתוג ראשי - מוגדל מעט כדי לשלוט בהיררכיה */}
          <div className="flex items-center gap-3 mb-4 opacity-90">
            <img 
              src="/icon.png" 
              className="w-7 h-7 rounded-md opacity-80 grayscale hover:grayscale-0 transition-all duration-700" 
              alt="Studio Icon" 
            />
            <span className="text-white font-black tracking-[0.5em] text-base md:text-lg italic uppercase leading-none">
              LIFESCRIPT STUDIO
            </span>
          </div>

          {/* שורת זכויות יוצרים - דקה ואלגנטית */}
          <p className="text-gray-500 text-[9px] md:text-[10px] tracking-[0.15em] uppercase flex items-center gap-2 mb-6 opacity-40 font-medium">
            <Copyright size={10} /> 2025 BY ADIALAMO • ALL RIGHTS RESERVED
          </p>

          {/* קישורי משנה - עיצוב 'רפאים' מינימליסטי עם פונקציונליות */}
          <div className={`flex gap-8 text-[8px] font-medium tracking-normal text-white/10 ${lang === 'he' ? 'flex-row-reverse' : 'flex-row'}`}>
            <button 
              onClick={() => setModalContent('terms')}
              className="hover:text-[#d4a373]/50 transition-all duration-500 border-b border-transparent hover:border-[#d4a373]/20 pb-0.5"
            >
              {lang === 'he' ? 'תנאי שימוש' : 'Terms'}
            </button>
            <button 
              onClick={() => setModalContent('privacy')}
              className="hover:text-[#d4a373]/50 transition-all duration-500 border-b border-transparent hover:border-[#d4a373]/20 pb-0.5"
            >
              {lang === 'he' ? 'פרטיות' : 'Privacy'}
            </button>
            <button 
              onClick={() => setModalContent('support')}
              className="hover:text-[#d4a373]/50 transition-all duration-500 border-b border-transparent hover:border-[#d4a373]/20 pb-0.5"
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