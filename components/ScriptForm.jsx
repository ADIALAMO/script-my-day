import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Copy, Download, Check, Volume2, Camera, VolumeX, Film } from 'lucide-react';

// רכיבים ו-Hook חדשים
import { GenreSelector } from './GenreSelector';
import { InspirationModal } from './InspirationModal';
import { useBackgroundAudio } from '../hooks/useBackgroundAudio';

const LOADING_MESSAGES = {
  he: ["סורק זכרונות...", "מנתח DNA סיפורי...", "בונה מתח דרמטי...", "מלטש דיאלוגים...", "מעבה דמויות...", "פורש קווי עלילה...", "מדפיס עותקים..."],
  en: ["Scanning memories...", "Analyzing story DNA...", "Building tension...", "Polishing dialogue...", "Developing characters...", "Plotting twists...", "Printing scripts..."]
};

const ScriptForm = ({ onSubmit, loading, lang, producerName, setProducerName }) => {
  const [journalEntry, setJournalEntry] = useState('');
  const [activeGenre, setActiveGenre] = useState('drama');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

  // שימוש ב-Hook לניהול אודיו
  useBackgroundAudio(activeGenre, isMusicMuted);

  const currentWordCount = useMemo(() => journalEntry.trim() ? journalEntry.trim().split(/\s+/).length : 0, [journalEntry]);
  const isLocked = loading;

  useEffect(() => {
    let interval;
    const messages = LOADING_MESSAGES[lang] || LOADING_MESSAGES.en;
    if (loading) {
      interval = setInterval(() => setLoadingMessageIndex((prev) => (prev + 1) % messages.length), 2800);
    } else {
      setLoadingMessageIndex(0);
    }
    return () => clearInterval(interval);
  }, [loading, lang]);

  const handleDownloadJournal = () => {
    const blob = new Blob([journalEntry], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LifeScript_Journal_${new Date().toLocaleDateString()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (loading ||isLocked || !journalEntry.trim() || !activeGenre) return;
    
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'generate_script_start', { genre: activeGenre, word_count: currentWordCount });
    }
    onSubmit(journalEntry, activeGenre);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-10 md:space-y-12">
      <div className="relative group">
        <div className="flex justify-between items-center mb-4 px-2">
          <label className="flex items-center gap-2 text-[#d4a373] text-[10px] md:text-xs font-black uppercase tracking-[0.3em] italic">
            <Sparkles size={14} className="animate-pulse" /> {lang === 'he' ? 'היומן שלך' : 'Your Journal'}
          </label>
          <AnimatePresence>
            {journalEntry.length > 5 && (
              <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="flex gap-2">
                <button type="button" onClick={handleDownloadJournal} className="p-2 bg-white/5 hover:bg-[#d4a373]/20 rounded-xl text-gray-400 hover:text-[#d4a373] transition-all border border-white/10 shadow-lg"><Download size={14} /></button>
                <button type="button" onClick={() => { navigator.clipboard.writeText(journalEntry); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className="p-2 bg-white/5 hover:bg-[#d4a373]/20 rounded-xl text-gray-400 hover:text-[#d4a373] transition-all border border-white/10 shadow-lg">
                  {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <div className="relative mb-6 px-2 w-fit"> 
          <motion.button
            type="button"
            disabled={isLocked}
            onClick={() => !isLocked && setIsModalOpen(!isModalOpen)}
            whileHover={!isLocked ? { scale: 1.02 } : {}}
            whileTap={!isLocked ? { scale: 0.98 } : {}}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:border-[#d4a373]/40 transition-all duration-500 group shadow-lg ${isLocked ? 'opacity-40 cursor-not-allowed' : ''}`}
          >
            <Sparkles size={14} className="text-[#d4a373] group-hover:rotate-12 transition-transform" />
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white/70 group-hover:text-white">
              {lang === 'he' ? 'הצתת השראה' : 'Spark Inspiration'}
            </span>
          </motion.button>

          <InspirationModal 
            isOpen={isModalOpen} 
            onClose={() => setIsModalOpen(false)} 
            onSelect={setJournalEntry} 
            lang={lang} 
            isLocked={isLocked}
          />
        </div>

        <div className="relative">
          <textarea
            value={journalEntry}
            onChange={(e) => {
              const words = e.target.value.trim().split(/\s+/);
              if (words.length <= 500) setJournalEntry(e.target.value);
              else setJournalEntry(words.slice(0, 500).join(' '));
            }}
            disabled={isLocked}
            className={`w-full px-6 py-8 md:px-10 md:py-10 text-lg md:text-xl text-white bg-black/40 border border-white/10 rounded-[2rem] md:rounded-[3rem] focus:border-[#d4a373]/50 focus:bg-black/60 outline-none transition-all duration-500 min-h-[220px] md:min-h-[280px] shadow-[inset_0_2px_40px_rgba(0,0,0,0.7)] leading-relaxed resize-none backdrop-blur-sm placeholder-gray-700 ${isLocked ? 'opacity-50 cursor-not-allowed grayscale-[0.5]' : ''}`}
            placeholder={lang === 'he' ? 'איך עבר היום? ספר לי במילים שלך...' : 'How was your day? Tell me in your own words...'}
            style={{ fontFamily: "'Courier Prime', 'Courier New', monospace" }}
          />
          <div className="absolute -bottom-10 right-2 flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className={`text-[9px] font-black tracking-[0.2em] uppercase ${currentWordCount >= 480 ? 'text-red-500' : 'text-[#d4a373]/50'}`}>{lang === 'he' ? 'מונה מילים' : 'WORD COUNT'}</span>
              <div className="flex items-baseline gap-1 font-mono">
                <span className="text-sm font-bold text-white">{currentWordCount}</span>
                <span className="text-[10px] text-white/20">/ 500</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-6 px-2">
          <label className="text-[#d4a373] text-[10px] md:text-xs font-black uppercase tracking-[0.3em] italic">{lang === 'he' ? 'בחר סגנון קולנועי' : 'Select Cinematic Style'}</label>
          <button type="button" onClick={() => !isLocked && setIsMusicMuted(!isMusicMuted)} disabled={isLocked} className={`p-2.5 rounded-xl border transition-all duration-300 ${isMusicMuted ? 'border-white/10 bg-white/5 text-gray-500' : 'border-[#d4a373]/50 bg-[#d4a373]/10 text-[#d4a373]'} ${isLocked ? 'opacity-30' : ''}`}>
            {isMusicMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
        
        <GenreSelector activeGenre={activeGenre} onGenreChange={setActiveGenre} isLocked={isLocked} lang={lang} />
      </div>
      
      <div className="mb-6 relative group max-w-[320px]">
        <label className="block text-[#d4a373] text-[10px] uppercase tracking-[0.4em] mb-3 font-black italic">{lang === 'he' ? 'קרדיט ליוצר/ת:' : 'CREATOR CREDIT:'}</label>
        <input 
          type="text" value={producerName} 
          onChange={(e) => {
            const val = e.target.value.slice(0, 22);
            setProducerName(val);
            localStorage.setItem('lifescript_producer_name', val);
          }}
          className="w-full bg-black/40 border-b border-[#d4a373]/30 p-3 text-white focus:border-[#d4a373] outline-none transition-all italic tracking-widest text-sm"
          maxLength={22}
        />
      </div>

      <motion.button
        type="submit"
        disabled={loading || currentWordCount === 0 || !activeGenre}
        className={`relative w-full group overflow-hidden rounded-[1.5rem] md:rounded-[2rem] transition-all duration-700 shadow-[0_10px_40px_rgba(212,163,115,0.2)] ${loading ? 'bg-[#d4a373] py-6 md:py-8' : 'bg-[#d4a373] py-5 md:py-7 hover:scale-[1.01] active:scale-[0.98]'} ${(!journalEntry.trim() || !activeGenre) && !loading ? 'opacity-30 grayscale cursor-not-allowed' : ''}`}
      >
        <div className="relative z-20 flex items-center justify-center w-full h-full px-4 italic text-black font-black">
          {loading ? (
            <div className={`flex items-center gap-3 ${lang === 'he' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className="relative w-5 h-5">
                {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
                  <motion.div key={i} style={{ rotate: deg, position: 'absolute' }} className="inset-0 flex items-start justify-center">
                    <motion.div animate={{ height: ["10%", "40%", "10%"], opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.125 }} className="w-[2px] bg-black rounded-full" />
                  </motion.div>
                ))}
              </div>
              <AnimatePresence mode="wait">
                <motion.span key={loadingMessageIndex} initial={{ y: 15, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -15, opacity: 0 }} className="text-[13px] md:text-[18px]">
                  {LOADING_MESSAGES[lang][loadingMessageIndex]}
                </motion.span>
              </AnimatePresence>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <Film size={20} />
              <span className="text-[15px] md:text-xl uppercase">{lang === 'he' ? 'צור תסריט' : 'GENERATE SCRIPT'}</span>
            </div>
          )}
        </div>
      </motion.button>
    </form>
  );
}

export default ScriptForm;