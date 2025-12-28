import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Copyright, AlertCircle, Key } from 'lucide-react';
import Navbar from '../components/Navbar';
import ScriptForm from '../components/ScriptForm';
import ScriptOutput from '../components/ScriptOutput';

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

  useEffect(() => {
    setMounted(true);
    const savedKey = localStorage.getItem('lifescript_admin_key');
    if (savedKey) setTempAdminKey(savedKey);
  }, []);

  const toggleLanguage = () => setLang(prev => prev === 'he' ? 'en' : 'he');

  const saveAdminKey = () => {
    const cleanKey = tempAdminKey.trim();
    localStorage.setItem('lifescript_admin_key', cleanKey);
    setTempAdminKey(cleanKey);
    setShowAdminPanel(false);
    alert(lang === 'he' ? 'גישת מנהל הופעלה!' : 'Admin access activated!');
  };

  const handleGenerateScript = async (journalEntry, genre) => {
    setLoading(true);
    setError('');
    setScript('');
    setSelectedGenre(genre);

    try {
      const savedAdminKey = localStorage.getItem('lifescript_admin_key') || '';
      
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-key': savedAdminKey 
        },
        body: JSON.stringify({ 
          journalEntry, 
          genre,
          adminKeyBody: savedAdminKey // גיבוי ב-Body לעקיפת סינון Headers במובייל
        }),
      });
      
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Error');
      setScript(data.script);
    } catch (err) {
      setError(err.message);
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
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@100;300;400;700;900&display=swap" rel="stylesheet" />
      </Head>

      <div className="mesh-gradient fixed inset-0 -z-10">
        <div className="mesh-sphere w-[600px] h-[600px] bg-purple-900/10 top-[-10%] left-[-10%]" />
        <div className="mesh-sphere w-[500px] h-[500px] bg-blue-900/10 bottom-[-10%] right-[-10%]" />
      </div>

      <Navbar lang={lang} onLanguageToggle={toggleLanguage} />

      <main className="container mx-auto py-12 md:py-24 px-6 max-w-5xl flex-grow relative z-10">
        
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16 md:mb-24"
        >
          <div className="inline-block mb-6 px-6 py-2 rounded-full border border-[#d4a373]/30 bg-[#d4a373]/5 text-[#d4a373] text-sm md:text-base font-bold tracking-[0.2em] uppercase">
            {lang === 'he' ? 'חזון קולנועי' : 'Cinematic Vision'}
          </div>
          
          <h1 
            onClick={() => setShowAdminPanel(!showAdminPanel)}
            className="text-6xl md:text-[9rem] font-black mb-8 bg-gradient-to-b from-[#d4a373] via-[#fefae0] to-[#d4a373] bg-clip-text text-transparent italic tracking-tighter uppercase leading-[1.1] pt-4 cursor-pointer select-none"
          >
            LIFESCRIPT
          </h1>
          
          <p className="text-gray-300 text-2xl md:text-3xl font-light max-w-2xl mx-auto leading-relaxed px-4">
            {lang === 'he' ? 'הפוך את היום שלך לתסריט קולנועי מרתק' : 'Turn your day into a captivating cinematic script'}
          </p>
        </motion.header>

        <AnimatePresence>
          {showAdminPanel && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-12">
              <div className="bg-[#d4a373]/10 border border-[#d4a373]/20 p-8 rounded-3xl flex flex-col md:flex-row gap-6 items-center">
                <Key className="text-[#d4a373]" size={32} />
                <input 
                  type="password"
                  value={tempAdminKey}
                  onChange={(e) => setTempAdminKey(e.target.value)}
                  placeholder="Admin Secret..."
                  className="bg-black/40 border border-white/10 p-5 rounded-2xl flex-grow text-2xl text-white outline-none focus:border-[#d4a373]/50 w-full"
                />
                <button onClick={saveAdminKey} className="bg-[#d4a373] text-black px-10 py-5 rounded-2xl font-black text-xl hover:bg-[#fefae0] transition-colors w-full md:w-auto">SAVE</button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.section 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`glass-panel rounded-[3rem] overflow-hidden shadow-2xl ${(loading || isTyping) ? 'ai-loading-active' : ''}`}
        >
          <div className="bg-[#030712]/60 backdrop-blur-3xl p-8 md:p-16">
            <ScriptForm onGenerateScript={handleGenerateScript} loading={loading} lang={lang} isTyping={isTyping} />

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="mt-10 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-4 text-red-400 text-xl md:text-2xl font-bold text-center">
                  <AlertCircle size={28} />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.section>

        <AnimatePresence mode="wait">
          {script && !loading && (
            <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="mt-16 md:mt-24">
              <ScriptOutput script={script} lang={lang} genre={selectedGenre} setIsTypingGlobal={setIsTyping} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-20 text-center border-t border-white/5 bg-black/40 mt-10">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <Film size={24} className="text-[#d4a373]" />
            <span className="text-white font-black tracking-[0.4em] md:tracking-[0.6em] text-lg md:text-xl italic uppercase">LIFESCRIPT STUDIO</span>
          </div>
          <p className="text-gray-500 text-xs md:text-sm tracking-[0.2em] uppercase flex items-center gap-2">
            <Copyright size={14} /> 2025 BY ADIALAMO • ALL RIGHTS RESERVED
          </p>
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
      `}</style>
    </div>
  );
}

export default HomePage;