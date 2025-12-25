import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Copyright } from 'lucide-react';
import Navbar from '../components/Navbar';
import ScriptForm from '../components/ScriptForm';
import ScriptOutput from '../components/ScriptOutput';

function HomePage() {
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('he');
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const toggleLanguage = () => setLang(prev => prev === 'he' ? 'en' : 'he');

  const handleGenerateScript = async (journalEntry, genre) => {
    setLoading(true);
    setError('');
    setScript('');
    try {
      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journalEntry, genre }),
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
      </Head>

      <div className="mesh-gradient fixed inset-0 -z-10">
        <div className="mesh-sphere w-[600px] h-[600px] bg-purple-900/10 top-[-10%] left-[-10%]" />
        <div className="mesh-sphere w-[500px] h-[500px] bg-blue-900/10 bottom-[-10%] right-[-10%]" />
      </div>

      <Navbar lang={lang} onLanguageToggle={toggleLanguage} />

      <main className="container mx-auto py-16 px-6 max-w-5xl flex-grow relative z-10">
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <div className="inline-block mb-4 px-4 py-1 rounded-full border border-[#d4a373]/30 bg-[#d4a373]/5 text-[#d4a373] text-xs font-bold tracking-[0.2em] uppercase">
            {lang === 'he' ? 'חזון קולנועי' : 'Cinematic Vision'}
          </div>
          {/* התיקון כאן: leading-[1.2] ו-pt-4 למניעת חיתוך ה-T */}
          <h1 className="text-7xl md:text-8xl font-black mb-6 bg-gradient-to-b from-[#d4a373] via-[#fefae0] to-[#d4a373] bg-clip-text text-transparent italic tracking-tighter uppercase leading-[1.2] pt-4">
            LIFESCRIPT
          </h1>
          <p className="text-gray-400 text-xl font-light max-w-2xl mx-auto leading-relaxed">
            {lang === 'he' ? 'הפוך את היום שלך לתסריט קולנועי מרתק' : 'Turn your day into a captivating cinematic script'}
          </p>
        </motion.header>

        <motion.section 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`glass-panel rounded-[2.5rem] overflow-hidden ${loading ? 'ai-loading-active' : ''}`}
        >
          <div className="bg-[#030712]/40 backdrop-blur-3xl p-8 md:p-10">
            <ScriptForm onGenerateScript={handleGenerateScript} loading={loading} lang={lang} />
          </div>
        </motion.section>

        <AnimatePresence>
          {script && !loading && (
            <motion.div initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} className="mt-16">
              <ScriptOutput script={script} lang={lang} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <footer className="py-12 text-center border-t border-white/5 bg-black/20">
        <div className="flex flex-col items-center justify-center gap-3">
          <div className="flex items-center gap-2">
            <Film size={16} className="text-[#d4a373]" />
            <span className="text-white font-black tracking-[0.4em] text-sm italic">LIFESCRIPT STUDIO</span>
          </div>
          <p className="text-gray-600 text-[10px] tracking-[0.2em] uppercase flex items-center gap-1">
            <Copyright size={10} /> 2025 BY ADIALAMO • ALL RIGHTS RESERVED
          </p>
        </div>
      </footer>
    </div>
  );
}

export default HomePage;