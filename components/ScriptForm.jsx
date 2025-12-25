import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clapperboard, Mic, Crosshair, Atom, Skull, Gem, Zap,
  Loader2, Sparkles, Copy, Download, Check, BookOpen 
} from 'lucide-react';

// --- רכיבי אנימציה מותאמים לכל ז'אנר (הסוד לחיים) ---

const DramaScene = ({ isSelected }) => (
  <motion.div
    animate={isSelected ? { rotate: [0, -15, 0] } : { rotate: 0 }}
    transition={{ duration: 2, repeat: Infinity, repeatDelay: 1 }}
  >
    <Clapperboard size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);

const ComedyScene = ({ isSelected }) => (
  <motion.div
    animate={isSelected ? { rotate: [-5, 5, -5], scale: [1, 1.1, 1] } : {}}
    transition={{ duration: 0.5, repeat: Infinity }}
  >
    <Mic size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);

const ActionScene = ({ isSelected }) => (
  <div className="relative flex items-center justify-center">
    <motion.div
      animate={isSelected ? { rotate: 360 } : { rotate: 0 }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
    >
      <Crosshair size={32} strokeWidth={isSelected ? 2 : 1.5} />
    </motion.div>
    {isSelected && (
      <motion.div 
        initial={{ opacity: 0, scale: 0 }}
        animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }}
        transition={{ duration: 0.5, repeat: Infinity }}
        className="absolute w-2 h-2 bg-red-500 rounded-full"
      />
    )}
  </div>
);

const SciFiScene = ({ isSelected }) => (
  <motion.div
    animate={isSelected ? { rotate: 360 } : { rotate: 0 }}
    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
  >
    <Atom size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);

const HorrorScene = ({ isSelected }) => (
  <motion.div
    animate={isSelected ? { x: [-2, 2, -2, 0], opacity: [1, 0.5, 1] } : {}}
    transition={{ duration: 0.2, repeat: Infinity, repeatDelay: 0.5 }}
  >
    <Skull size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);

const RomanceScene = ({ isSelected }) => (
  <motion.div
    animate={isSelected ? { scale: [1, 1.2, 1], filter: ["brightness(1)", "brightness(1.5)", "brightness(1)"] } : {}}
    transition={{ duration: 2, repeat: Infinity }}
  >
    <Gem size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);

const ComicScene = ({ isSelected }) => (
  <motion.div
    animate={isSelected ? { scale: [1, 1.2, 0.9, 1.1, 1], rotate: [0, -10, 10, 0] } : {}}
    transition={{ duration: 0.8, repeat: Infinity }}
  >
    <Zap size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);

// --- הגדרות הנתונים ---

const genres = [
  { 
    label: 'דרמה', enLabel: 'Drama', value: 'drama', 
    component: DramaScene,
    activeClass: 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)]',
    textClass: 'text-indigo-400', glowColor: '#6366f1'
  },
  { 
    label: 'קומדיה', enLabel: 'Comedy', value: 'comedy', 
    component: ComedyScene,
    activeClass: 'bg-amber-500/20 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]',
    textClass: 'text-amber-400', glowColor: '#f59e0b'
  },
  { 
    label: 'פעולה', enLabel: 'Action', value: 'action', 
    component: ActionScene,
    activeClass: 'bg-red-600/20 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)]',
    textClass: 'text-red-500', glowColor: '#ef4444'
  },
  { 
    label: 'מד"ב', enLabel: 'Sci-Fi', value: 'sci-fi', 
    component: SciFiScene,
    activeClass: 'bg-cyan-500/20 border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.3)]',
    textClass: 'text-cyan-400', glowColor: '#06b6d4'
  },
  { 
    label: 'אימה', enLabel: 'Horror', value: 'horror', 
    component: HorrorScene,
    activeClass: 'bg-emerald-900/40 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.2)]',
    textClass: 'text-emerald-500', glowColor: '#10b981'
  },
  { 
    label: 'רומנטיקה', enLabel: 'Romance', value: 'romance', 
    component: RomanceScene,
    activeClass: 'bg-rose-500/20 border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]',
    textClass: 'text-rose-400', glowColor: '#f43f5e'
  },
  { 
    label: 'קומיקס', enLabel: 'Comic', value: 'comic', 
    component: ComicScene,
    activeClass: 'bg-yellow-500/20 border-yellow-500 shadow-[0_0_30px_rgba(234,179,8,0.3)]',
    textClass: 'text-yellow-400', glowColor: '#eab308'
  },
];

function ScriptForm({ onGenerateScript, loading, lang }) {
  const [journalEntry, setJournalEntry] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('drama');
  const [isCopied, setIsCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(journalEntry);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([journalEntry], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'my_journal_entry.txt';
    a.click();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onGenerateScript(journalEntry, selectedGenre); }} className="space-y-12">
      
      {/* אזור הטקסט */}
      <div className="relative group">
        <div className="flex justify-between items-center mb-4 px-2">
          <label className="flex items-center gap-2 text-[#d4a373] text-xs font-black uppercase tracking-[0.3em] italic">
            <Sparkles size={14} className="animate-pulse" />
            {lang === 'he' ? 'היומן שלך' : 'Your Journal'}
          </label>
          <AnimatePresence>
            {journalEntry.length > 5 && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
                <button type="button" onClick={handleCopy} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-[#d4a373]">
                  {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
                <button type="button" onClick={handleDownload} className="p-2 hover:bg-white/5 rounded-full transition-colors text-gray-400 hover:text-[#d4a373]">
                  <Download size={14} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        
        <div className="relative">
          <textarea
            value={journalEntry}
            onChange={(e) => setJournalEntry(e.target.value)}
            disabled={loading}
            className="w-full px-8 py-8 text-lg text-white bg-black/20 border border-white/10 rounded-3xl focus:border-[#d4a373]/50 focus:bg-black/40 outline-none transition-all duration-500 min-h-[220px] shadow-[inset_0_2px_20px_rgba(0,0,0,0.5)] leading-relaxed resize-none"
            placeholder={lang === 'he' ? 'איך עבר היום? ספר לי במילים שלך...' : 'How was your day? Tell me in your own words...'}
          />
          <div className="absolute bottom-4 right-4 text-white/5 pointer-events-none">
            <BookOpen size={40} />
          </div>
        </div>
      </div>

      {/* בחירת ז'אנר - עם האנימציות החיות */}
      <div>
        <label className="block text-[#d4a373] text-xs font-black mb-8 uppercase tracking-[0.3em] italic px-2">
          {lang === 'he' ? 'בחר סגנון' : 'Select Style'}
        </label>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {genres.map((genre) => {
            const VisualComponent = genre.component;
            const isSelected = selectedGenre === genre.value;
            
            return (
              <motion.button
                key={genre.value}
                type="button"
                onClick={() => setSelectedGenre(genre.value)}
                whileHover={{ y: -8, scale: 1.02 }}
                whileTap={{ scale: 0.95 }}
                className={`
                  relative flex flex-col items-center justify-between h-32 p-4 rounded-2xl border transition-all duration-500 overflow-hidden
                  ${isSelected 
                    ? genre.activeClass 
                    : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/20'
                  }
                `}
              >
                {/* רקע זוהר */}
                {isSelected && (
                  <div className="absolute inset-0 opacity-20 bg-gradient-to-t from-black to-transparent" />
                )}

                {/* האייקון החי */}
                <div className={`mt-2 transition-all duration-500 ${isSelected ? `${genre.textClass} scale-110 drop-shadow-[0_0_10px_rgba(255,255,255,0.3)]` : 'text-gray-500 grayscale'}`}>
                  <VisualComponent isSelected={isSelected} />
                </div>

                {/* טקסט */}
                <span className={`text-[10px] font-black uppercase tracking-widest z-10 transition-colors duration-300 ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                  {lang === 'he' ? genre.label : genre.enLabel}
                </span>

                {/* פס אינדיקטור */}
                {isSelected && (
                  <motion.div 
                    layoutId="activeIndicator"
                    className="absolute bottom-0 w-full h-1"
                    style={{ backgroundColor: genre.glowColor }}
                  />
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* כפתור יצירה */}
      <motion.button
        type="submit"
        disabled={loading || !journalEntry.trim()}
        className={`w-full py-7 rounded-2xl font-black text-lg uppercase tracking-[0.4em] transition-all duration-700 group relative overflow-hidden ${
          loading ? 'bg-white/5 text-gray-600 cursor-not-allowed' : 'bg-[#d4a373] text-black hover:shadow-[0_0_50px_rgba(212,163,115,0.4)]'
        }`}
      >
        <div className="absolute inset-0 bg-white/20 translate-y-full group-hover:translate-y-0 transition-transform duration-500 ease-out" />
        <span className="relative z-10 flex items-center justify-center gap-4 italic">
          {loading ? (
            <><Loader2 className="animate-spin" size={24} /> {lang === 'he' ? 'בצילומים...' : 'On Set...'}</>
          ) : (
            <>{lang === 'he' ? 'צור תסריט' : 'Generate Script'}</>
          )}
        </span>
      </motion.button>
    </form>
  );
}

export default ScriptForm;