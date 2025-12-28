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

  // אדמין
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [tempAdminKey, setTempAdminKey] = useState('');

  useEffect(() => {
    setMounted(true);
    // טעינת מפתח אדמין קיים אם יש
    const savedKey = localStorage.getItem('lifescript_admin_key');
    if (savedKey) setTempAdminKey(savedKey);
  }, []);

  const toggleLanguage = () => setLang(prev => prev === 'he' ? 'en' : 'he');

  const saveAdminKey = () => {
    localStorage.setItem('lifescript_admin_key', tempAdminKey);
    setShowAdminPanel(false);
    alert(lang === 'he' ? 'מפתח מנהל עודכן!' : 'Admin key updated!');
  };

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
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
      </Head>

      <div className="mesh-gradient fixed inset-0 -z-10">
        <div className="mesh-sphere w-[600px] h-[600px] bg-purple-900/10 top-[-10%] left-[-10%]" />
        <div className="mesh-sphere w-[500px] h-[500px] bg-blue-900/10 bottom-[-10%] right-[-10%]" />
      </div>

      <Navbar lang={lang} onLanguageToggle={toggleLanguage} />

      <main className="container mx-auto py-8 md:py-16 px-5 md:px-6 max-w-5xl flex-grow relative z-10">
        
        {/* Header Section - הוספתי לחיצה סודית על הכותרת לכניסת אדמין */}
        <motion.header 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10 md:mb-16"
        >
          <div className="inline-block mb-5 px-5 py-1.5 rounded-full border border-[#d4a373]/30 bg-[#d4a373]/5 text-[#d4a373] text-xs md:text-sm font-bold tracking-[0.2em] uppercase">
            {lang === 'he' ? 'חזון קולנועי' : 'Cinematic Vision'}
          </div>
          
          <h1 
            onClick={() => setShowAdminPanel(!showAdminPanel)}
            className="text-6xl md:text-9xl font-black mb-6 bg-gradient-to-b from-[#d4a373] via-[#fefae0] to-[#d4a373] bg-clip-text text-transparent italic tracking-tighter uppercase leading-[1.1] pt-4 cursor-pointer select-none"
          >
            LIFESCRIPT
          </h1>
          
          <p className="text-gray-400 text-xl md:text-2xl font-light max-w-2xl mx-auto leading-relaxed px-2">
            {lang === 'he' ? 'הפוך את היום שלך לתסריט קולנועי מרתק' : 'Turn your day into a captivating cinematic script'}
          </p>
        </motion.header>

        {/* Admin Secret Panel */}
        <AnimatePresence>
          {showAdminPanel && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden mb-8"
            >
              <div className="bg-[#d4a373]/10 border border-[#d4a373]/20 p-6 rounded-2xl flex flex-col md:flex-row gap-4 items-center">
                <Key className="text-[#d4a373]" size={24} />
                <input 
                  type="password"
                  value={tempAdminKey}
                  onChange={(e) => setTempAdminKey(e.target.value)}
                  placeholder="Admin Secret Key..."
                  className="bg-black/40 border border-white/10 p-3 rounded-xl flex-grow text-white outline-none focus:border-[#d4a373]/50 w-full"
                />
                <button 
                  onClick={saveAdminKey}
                  className="bg-[#d4a373] text-black px-6 py-3 rounded-xl font-bold hover:bg-[#fefae0] transition-colors w-full md:w-auto"
                >
                  Save
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Interface Section */}
        <motion.section 
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`glass-panel rounded-[2.5rem] md:rounded-[3rem] overflow-hidden shadow-2xl ${(loading || isTyping) ? 'ai-loading-active' : ''}`}
        >
          <div className="bg-[#030712]/60 backdrop-blur-3xl p-7 md:p-12">
            <ScriptForm 
              onGenerateScript={handleGenerateScript} 
              loading={loading} 
              lang={lang} 
              isTyping={isTyping} 
            />

            <AnimatePresence>
              {error && (
                <motion.div 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-8 p-5 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-4 text-red-400 text-base md:text-lg font-medium text-center"
                >
                  <AlertCircle size={20} />
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
              className="mt-14 md:mt-20"
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

      <footer className="py-14 text-center border-t border-white/5 bg-black/40 mt-10">
        <div className="flex flex-col items-center justify-center gap-4">
          <div className="flex items-center gap-2">
            <Film size={20} className="text-[#d4a373]" />
            <span className="text-white font-black tracking-[0.3em] md:tracking-[0.5em] text-sm md:text-base italic uppercase">LIFESCRIPT STUDIO</span>
          </div>
          <p className="text-gray-500 text-[10px] md:text-xs tracking-[0.2em] uppercase flex items-center gap-2">
            <Copyright size={12} /> 2025 BY ADIALAMO • ALL RIGHTS RESERVED
          </p>
        </div>
      </footer>

      <style jsx global>{`
        .glass-panel {
          border: 1px solid rgba(255, 255, 255, 0.05);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        /* שיפור קריאות טקסט כללי */
        p, span, input, textarea, select {
          font-size: 1.1rem;
        }
        @media (max-width: 768px) {
          p, span { font-size: 1rem; }
        }
      `}</style>
    </div>
  );
}

export default HomePage;