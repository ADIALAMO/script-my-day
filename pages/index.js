import React, { useState } from 'react';
import Head from 'next/head';
import Navbar from '../components/Navbar';
import ScriptForm from '../components/ScriptForm';
import ScriptOutput from '../components/ScriptOutput';

function HomePage() {
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('he');

  const toggleLanguage = () => {
    setLang(prev => prev === 'he' ? 'en' : 'he');
  };

  const handleGenerateScript = async (journalEntry, genre) => {
    setLoading(true);
    setError('');
    setScript(''); // איפוס התוצאה הקודמת למען חווית משתמש נקייה

    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ journalEntry, genre }),
      });

      // חילוץ נתונים גם במקרה של שגיאה כדי להציג הודעה מהשרת
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.message || (lang === 'he' ? 'שגיאה בחיבור לשרת' : 'Server connection error'));
      }

      // ה-Service שלך מחזיר את התוצאה תחת המפתח script ב-API
      if (data.script) {
        setScript(data.script);
      } else {
        throw new Error(lang === 'he' ? 'לא התקבל תסריט מה-AI' : 'No script received from AI');
      }

    } catch (err) {
      console.error("Frontend Logic Error:", err);
      setError(err.message || (lang === 'he' ? 'אירעה שגיאה בלתי צפויה' : 'An unexpected error occurred'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className={`min-h-screen bg-[#0a0a0a] text-white flex flex-col transition-all duration-500 ${lang === 'he' ? 'font-heebo text-right' : 'text-left'}`} 
      dir={lang === 'he' ? 'rtl' : 'ltr'}
    >
      <Head>
        <title>LifeScript | Cinematic AI Studio</title>
        <meta name="description" content="Transform your life into a cinematic masterpiece" />
      </Head>

      <Navbar lang={lang} onLanguageToggle={toggleLanguage} />

      <main className="container mx-auto py-12 px-6 max-w-4xl flex-grow">
        <header className="text-center mb-16 animate-in fade-in slide-in-from-top-4 duration-1000">
          <h1 className="text-7xl font-black mb-4 bg-gradient-to-b from-[#d4a373] via-[#fefae0] to-[#d4a373] bg-clip-text text-transparent italic tracking-tighter uppercase">
            LIFESCRIPT
          </h1>
          <div className="h-1 w-24 bg-[#d4a373] mx-auto mb-6 rounded-full shadow-[0_0_15px_rgba(212,163,115,0.5)]"></div>
          <p className="text-gray-400 text-xl font-light max-w-xl mx-auto leading-relaxed">
            {lang === 'he' 
              ? 'הפוך את רגעי היום-יום שלך לתסריט הוליוודי מהפנט בלחיצת כפתור אחת.' 
              : 'Transform your daily moments into a captivating Hollywood script with a single click.'}
          </p>
        </header>

        <section className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-[#d4a373]/20 to-transparent rounded-[2rem] blur opacity-25 group-hover:opacity-50 transition duration-1000"></div>
          <div className="relative glass-card p-10 rounded-[2rem] border border-white/10 bg-[#121212]/80 backdrop-blur-xl shadow-2xl">
            {/* הקומפוננטה מקבלת את כל ה-Props הדרושים */}
            <ScriptForm 
              onGenerateScript={handleGenerateScript} 
              loading={loading} 
              lang={lang} 
            />
          </div>
        </section>

        {/* Loading State - Cinematic Style */}
        {loading && (
          <div className="flex flex-col items-center justify-center space-y-6 py-20 animate-pulse">
            <div className="relative">
              <div className="w-16 h-16 border-2 border-[#d4a373]/20 rounded-full"></div>
              <div className="absolute top-0 w-16 h-16 border-t-2 border-[#d4a373] rounded-full animate-spin"></div>
            </div>
            <p className="text-[#d4a373] font-bold tracking-[0.3em] text-sm uppercase italic">
              {lang === 'he' ? 'מפתח את הסצנה...' : 'Developing Scene...'}
            </p>
          </div>
        )}

        {/* Error Handling */}
        {error && (
          <div className="mt-10 p-5 bg-red-950/30 border border-red-500/50 rounded-2xl text-red-400 text-center font-medium backdrop-blur-sm animate-in zoom-in-95 duration-300">
            <span className="mr-2">⚠️</span> {error}
          </div>
        )}

        {/* Output Canvas */}
        {script && !loading && (
          <div className="mt-16 animate-in fade-in slide-in-from-bottom-12 duration-1000">
            <ScriptOutput script={script} lang={lang} />
          </div>
        )}
      </main>

      <footer className="py-8 text-center text-gray-600 text-xs tracking-widest uppercase">
        © {new Date().getFullYear()} LifeScript Studio | Premium AI Experience
      </footer>
    </div>
  );
}

export default HomePage;