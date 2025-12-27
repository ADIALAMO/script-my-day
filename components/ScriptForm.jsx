import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clapperboard, Mic, Crosshair, Atom, Skull, Gem, Zap,
  Loader2, Sparkles, Copy, Download, Check, Volume2, VolumeX 
} from 'lucide-react';

// --- רכיבי אנימציה חיות לז'אנרים (ללא שינוי) ---
const DramaScene = ({ isSelected }) => (
  <motion.div animate={isSelected ? { rotate: [0, -15, 0] } : {}} transition={{ duration: 2, repeat: Infinity }}>
    <Clapperboard size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);
const ComedyScene = ({ isSelected }) => (
  <motion.div animate={isSelected ? { rotate: [-5, 5, -5], scale: [1, 1.1, 1] } : {}} transition={{ duration: 0.5, repeat: Infinity }}>
    <Mic size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);
const ActionScene = ({ isSelected }) => (
  <div className="relative flex items-center justify-center">
    <motion.div animate={isSelected ? { rotate: 360 } : {}} transition={{ duration: 4, repeat: Infinity, ease: "linear" }}>
      <Crosshair size={32} strokeWidth={isSelected ? 2 : 1.5} />
    </motion.div>
    {isSelected && <motion.div animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }} transition={{ duration: 0.5, repeat: Infinity }} className="absolute w-2 h-2 bg-red-500 rounded-full" />}
  </div>
);
const SciFiScene = ({ isSelected }) => (
  <motion.div animate={isSelected ? { rotate: 360, color: ['#06b6d4', '#ffffff', '#06b6d4'] } : {}} transition={{ duration: 3, repeat: Infinity }}>
    <Atom size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);
const HorrorScene = ({ isSelected }) => (
  <motion.div animate={isSelected ? { x: [-2, 2, -2], opacity: [1, 0.7, 1] } : {}} transition={{ duration: 0.2, repeat: Infinity }}>
    <Skull size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);
const RomanceScene = ({ isSelected }) => (
  <motion.div animate={isSelected ? { scale: [1, 1.2, 1] } : {}} transition={{ duration: 2, repeat: Infinity }}>
    <Gem size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);
const ComicScene = ({ isSelected }) => (
  <motion.div animate={isSelected ? { scale: [1, 1.2, 1], rotate: [0, -10, 10, 0] } : {}} transition={{ duration: 0.8, repeat: Infinity }}>
    <Zap size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
);

const genres = [
  { label: 'דרמה', value: 'drama', component: DramaScene, activeClass: 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)]', textClass: 'text-indigo-400', glowColor: '#6366f1' },
  { label: 'קומדיה', value: 'comedy', component: ComedyScene, activeClass: 'bg-amber-500/20 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]', textClass: 'text-amber-400', glowColor: '#f59e0b' },
  { label: 'פעולה', value: 'action', component: ActionScene, activeClass: 'bg-red-600/20 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)]', textClass: 'text-red-500', glowColor: '#ef4444' },
  { label: 'מד"ב', value: 'sci-fi', component: SciFiScene, activeClass: 'bg-cyan-500/20 border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.3)]', textClass: 'text-cyan-400', glowColor: '#06b6d4' },
  { label: 'אימה', value: 'horror', component: HorrorScene, activeClass: 'bg-emerald-900/40 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.2)]', textClass: 'text-emerald-500', glowColor: '#10b981' },
  { label: 'רומנטיקה', value: 'romance', component: RomanceScene, activeClass: 'bg-rose-500/20 border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]', textClass: 'text-rose-400', glowColor: '#f43f5e' },
  { label: 'קומיקס', value: 'comic', component: ComicScene, activeClass: 'bg-yellow-500/20 border-yellow-500 shadow-[0_0_30px_rgba(234,179,8,0.3)]', textClass: 'text-yellow-400', glowColor: '#eab308' },
];

function ScriptForm({ onGenerateScript, loading, lang, isTyping }) {
  const [journalEntry, setJournalEntry] = useState('');
  const [selectedGenre, setSelectedGenre] = useState(null); // מתחיל ללא ז'אנר
  const [isCopied, setIsCopied] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(true);
  const bgMusicRef = useRef(null);

  const isGlobalLocked = loading || isTyping;

  useEffect(() => {
    if (bgMusicRef.current) {
      bgMusicRef.current.pause();
      bgMusicRef.current = null;
    }
    
    // רק אם נבחר ז'אנר, נטען את האודיו
    if (selectedGenre) {
      bgMusicRef.current = new Audio(`/audio/${selectedGenre}_bg.m4a`);
      bgMusicRef.current.loop = true;
      bgMusicRef.current.volume = 0.3;
      bgMusicRef.current.muted = isMusicMuted;

      if (!isMusicMuted) {
        bgMusicRef.current.play().catch(() => {});
      }
    }
    return () => bgMusicRef.current?.pause();
  }, [selectedGenre, isMusicMuted]); // המוזיקה פועלת תמיד ללא קשר לסטטוס הטעינה

  const handleDownloadJournal = () => {
    const blob = new Blob([journalEntry], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `journal_${new Date().toLocaleDateString()}.txt`;
    a.click();
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); onGenerateScript(journalEntry, selectedGenre || 'drama'); }} className="space-y-12">
      <div className="relative group">
        <div className="flex justify-between items-center mb-4 px-2">
          <label className="flex items-center gap-2 text-[#d4a373] text-xs font-black uppercase tracking-[0.3em] italic">
            <Sparkles size={14} className="animate-pulse" /> {lang === 'he' ? 'היומן שלך' : 'Your Journal'}
          </label>
          <AnimatePresence>
            {journalEntry.length > 2 && (
              <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} className="flex gap-2">
                <button type="button" onClick={handleDownloadJournal} className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-[#d4a373] transition-all border border-white/10">
                  <Download size={14} />
                </button>
                <button type="button" onClick={() => { navigator.clipboard.writeText(journalEntry); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className="p-2 bg-white/5 hover:bg-white/10 rounded-full text-gray-400 hover:text-[#d4a373] transition-all border border-white/10">
                  {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <textarea
          value={journalEntry}
          onChange={(e) => setJournalEntry(e.target.value)}
          disabled={isGlobalLocked}
          className="w-full px-8 py-8 text-lg text-white bg-black/40 border border-white/10 rounded-3xl focus:border-[#d4a373]/50 focus:bg-black/60 outline-none transition-all duration-500 min-h-[220px] shadow-[inset_0_2px_40px_rgba(0,0,0,0.7)] leading-relaxed resize-none backdrop-blur-sm"
          placeholder={lang === 'he' ? 'איך עבר היום? ספר לי במילים שלך...' : 'How was your day? Tell me in your own words...'}
        />
      </div>

      <div>
        <div className="flex justify-between items-center mb-8 px-2">
          <label className="text-[#d4a373] text-xs font-black uppercase tracking-[0.3em] italic">
            {lang === 'he' ? 'בחר סגנון קולנועי' : 'Select Cinematic Style'}
          </label>
          <button type="button" onClick={() => setIsMusicMuted(!isMusicMuted)} className={`p-2 rounded-full border transition-all ${isMusicMuted ? 'border-red-500/50 bg-red-500/10 text-red-500' : 'border-[#d4a373]/50 bg-[#d4a373]/10 text-[#d4a373]'}`}>
            {isMusicMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
          {genres.map((genre) => {
            const Visual = genre.component;
            const isSelected = selectedGenre === genre.value;
            return (
              <motion.button
                key={genre.value}
                type="button"
                onClick={() => setSelectedGenre(genre.value)}
                whileHover={!isGlobalLocked ? { y: -5, scale: 1.02 } : {}}
                disabled={isGlobalLocked}
                className={`relative flex flex-col items-center justify-between h-32 p-4 rounded-2xl border transition-all duration-500 overflow-hidden ${isSelected ? genre.activeClass : 'bg-white/5 border-white/5 hover:border-white/20'}`}
              >
                <div className={`mt-2 transition-all duration-500 ${isSelected ? `${genre.textClass} scale-110 drop-shadow-[0_0_10px_rgba(255,255,255,0.2)]` : 'text-gray-500 grayscale'}`}>
                  <Visual isSelected={isSelected} />
                </div>
                <span className={`text-[10px] font-black uppercase tracking-widest z-10 ${isSelected ? 'text-white' : 'text-gray-600'}`}>{genre.label}</span>
                {isSelected && <motion.div layoutId="activeInd" className="absolute bottom-0 w-full h-1" style={{ backgroundColor: genre.glowColor }} />}
              </motion.button>
            );
          })}
        </div>
      </div>

      <motion.button
        type="submit"
        disabled={isGlobalLocked || !journalEntry.trim() || !selectedGenre}
        className={`w-full py-7 rounded-2xl font-black text-lg uppercase tracking-[0.4em] transition-all duration-700 group relative overflow-hidden ${
          loading 
            ? 'bg-gradient-to-r from-amber-500 via-[#d4a373] to-amber-500 shadow-[0_0_40px_rgba(212,163,115,0.6)] text-black' 
            : 'bg-[#d4a373] text-black hover:shadow-[0_0_60px_rgba(212,163,115,0.4)]'
        }`}
      >
        {!loading && (
          <motion.div 
            initial={{ x: '-100%' }}
            animate={{ x: '100%' }}
            transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent z-10"
          />
        )}
        <span className="relative z-20 flex items-center justify-center gap-4 italic font-black">
          {loading ? (
            <motion.div className="flex items-center gap-4" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ repeat: Infinity, duration: 1 }}>
              <Loader2 className="animate-spin" size={24} /> {lang === 'he' ? 'מפיק יצירת מופת...' : 'PRODUCING...'}
            </motion.div>
          ) : (
            <>{lang === 'he' ? 'צור תסריט' : 'GENERATE SCRIPT'} <Sparkles size={20} className="animate-pulse" /></>
          )}
        </span>
      </motion.button>
    </form>
  );
}

export default ScriptForm;