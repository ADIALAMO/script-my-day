import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Copyright, AlertCircle } from 'lucide-react';
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

  useEffect(() => setMounted(true), []);

  const toggleLanguage = () => setLang(prev => prev === 'he' ? 'en' : 'he');

  const handleGenerateScript = async (journalEntry, genre) => {
    setLoading(true);
    setError('');
    setScript('');
    setSelectedGenre(genre);

    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'x-admin-key': localStorage.getItem('lifescript_admin_key') || ''
        },
        body: JSON.stringify({ journalEntry, genre }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        // כאן נתפסת הודעת המכסה או שגיאת ה-API
        throw new Error(data.message || 'Error');
      }
      
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
      </Head>

      {/* רקע */}
      <div className="mesh-gradient fixed inset-0 -z-10">
        <div className="mesh-sphere w-[600px] h-[600px] bg-purple-900/10 top-[-10%] left-[-10%]" />
        <div className="mesh-sphere w-[500px] h-[500px] bg-blue-900/10 bottom-[-10%] right-[-10%]" />
      </div>

      <Navbar lang={lang} onLanguageToggle={toggleLanguage} />

      <main className="container mx-auto py-12 md:py-16 px-4 md:px-6 max-w-5xl flex-grow relative z-10">
        {/* Header Section */}
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12 md:mb-16"
        >
          <div className="inline-block mb-4 px-4 py-1 rounded-full border border-[#d4a373]/30 bg-[#d4a373]/5 text-[#d4a373] text-[10px] md:text-xs font-bold tracking-[0.2em] uppercase">
            {lang === 'he' ? 'חזון קולנועי' : 'Cinematic Vision'}
          </div>
          <h1 className="text-5xl md:text-8xl font-black mb-6 bg-gradient-to-b from-[#d4a373] via-[#fefae0] to-[#d4a373] bg-clip-text text-transparent italic tracking-tighter uppercase leading-[1.1] pt-4 break-words">
            LIFESCRIPT
          </h1>
          <p className="text-gray-400 text-lg md:text-xl font-light max-w-2xl mx-auto leading-relaxed px-4">
            {lang === 'he' ? 'הפוך את היום שלך לתסריט קולנועי מרתק' : 'Turn your day into a captivating cinematic script'}
          </p>
        </motion.header>

        {/* Main Interface Section */}
        <motion.section 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`glass-panel rounded-[2rem] md:rounded-[2.5rem] overflow-hidden ${(loading || isTyping) ? 'ai-loading-active' : ''}`}
        >
          <div className="bg-[#030712]/40 backdrop-blur-3xl p-6 md:p-10">
            <ScriptForm 
              onGenerateScript={handleGenerateScript} 
              loading={loading} 
              lang={lang} 
              isTyping={isTyping} 
            />

            {/* התיקון: הודעת השגיאה ממוקמת כאן - בתוך הטופס, מתחת לכפתור */}
            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-3 text-red-400 text-sm font-medium"
                >
                  <AlertCircle size={16} />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.section>

        {/* Output Section */}
        <AnimatePresence mode="wait">
          {script && !loading && (
            <motion.div 
              key="output"
              initial={{ opacity: 0, y: 40 }} 
              animate={{ opacity: 1, y: 0 }} 
              exit={{ opacity: 0, y: 20 }}
              className="mt-12 md:mt-16"
            >
              <ScriptOutput 
                script={script} 
                lang={lang} 
                genre={selectedGenre} 
                setIsTypingGlobal={setIsTyping}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Footer */}
      <footer className="py-12 text-center border-t border-white/5 bg-black/20 mt-10">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            <Film size={16} className="text-[#d4a373]" />
            <span className="text-white font-black tracking-[0.2em] md:tracking-[0.4em] text-xs md:text-sm italic uppercase">LIFESCRIPT STUDIO</span>
          </div>
          <p className="text-gray-600 text-[9px] md:text-[10px] tracking-[0.2em] uppercase flex items-center gap-1">
            <Copyright size={10} /> 2025 BY ADIALAMO • ALL RIGHTS RESERVED
          </p>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;