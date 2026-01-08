import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clapperboard, Mic, Crosshair, Atom, Skull, Gem,
  Loader2, Sparkles, Copy, Download, Check, Volume2, VolumeX 
} from 'lucide-react';

// --- רכיבי אנימציה חיות לז'אנרים (מעודכנים) ---
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

// רשימת הז'אנרים המעודכנת - ללא קומיקס, 6 ז'אנרים סה"כ (מושלם ל-Grid)
const genres = [
  { label: { he: 'דרמה', en: 'Drama' }, value: 'drama', component: DramaScene, activeClass: 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)]', textClass: 'text-indigo-400', glowColor: '#6366f1' },
  { label: { he: 'קומדיה', en: 'Comedy' }, value: 'comedy', component: ComedyScene, activeClass: 'bg-amber-500/20 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]', textClass: 'text-amber-400', glowColor: '#f59e0b' },
  { label: { he: 'פעולה', en: 'Action' }, value: 'action', component: ActionScene, activeClass: 'bg-red-600/20 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)]', textClass: 'text-red-500', glowColor: '#ef4444' },
  { label: { he: 'מד"ב', en: 'Sci-Fi' }, value: 'sci-fi', component: SciFiScene, activeClass: 'bg-cyan-500/20 border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.3)]', textClass: 'text-cyan-400', glowColor: '#06b6d4' },
  { label: { he: 'אימה', en: 'Horror' }, value: 'horror', component: HorrorScene, activeClass: 'bg-emerald-900/40 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.2)]', textClass: 'text-emerald-500', glowColor: '#10b981' },
  { label: { he: 'רומנטיקה', en: 'Romance' }, value: 'romance', component: RomanceScene, activeClass: 'bg-rose-500/20 border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]', textClass: 'text-rose-400', glowColor: '#f43f5e' },
];

function ScriptForm({ onGenerateScript, loading, lang, isTyping }) {
  const [journalEntry, setJournalEntry] = useState('');
  const [selectedGenre, setSelectedGenre] = useState(null); 
  const [isCopied, setIsCopied] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(true);
  const bgMusicRef = useRef(null);

  const isGlobalLocked = loading || isTyping;

  // טיפול במוזיקה - כולל הגנה מפני שגיאות טעינה
  useEffect(() => {
    if (bgMusicRef.current) {
      bgMusicRef.current.pause();
      bgMusicRef.current = null;
    }
    
    if (selectedGenre) {
      const audioPath = `/audio/${selectedGenre}_bg.m4a`;
      bgMusicRef.current = new Audio(audioPath);
      bgMusicRef.current.loop = true;
      bgMusicRef.current.volume = 0.25; // ווליום טיפה יותר נעים
      bgMusicRef.current.muted = isMusicMuted;

      if (!isMusicMuted) {
        bgMusicRef.current.play().catch(err => console.log("Audio play blocked by browser"));
      }
    }
    return () => {
      if (bgMusicRef.current) bgMusicRef.current.pause();
    };
  }, [selectedGenre, isMusicMuted]);

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
    if (isGlobalLocked || !journalEntry.trim() || !selectedGenre) return;

    // --- שדרוג: פתיחת ערוץ הסאונד ברגע הלחיצה ---
    // זה מבטיח שהדפדפן יאשר את האודיו של ההקלדה שיתחיל עוד כמה שניות
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      
      // אם הקונטקסט מושהה (Suspended), אנחנו מעירים אותו מיד בלחיצה
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
      
      // אנחנו לא חייבים לשמור את ה-audioCtx כאן, 
      // עצם היצירה וה-resume שלו בתוך אירוע לחיצה (Submit) משחררת את הנעילה עבור כל האפליקציה.
    } catch (err) {
      console.log("Audio unlock failed", err);
    }

    onGenerateScript(journalEntry, selectedGenre);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-10 md:space-y-12">
      
      {/* אזור יומן הטקסט */}
      <div className="relative group">
        <div className="flex justify-between items-center mb-4 px-2">
          <label className="flex items-center gap-2 text-[#d4a373] text-[10px] md:text-xs font-black uppercase tracking-[0.3em] italic">
            <Sparkles size={14} className="animate-pulse" /> {lang === 'he' ? 'היומן שלך' : 'Your Journal'}
          </label>
          <AnimatePresence>
  {journalEntry.length > 5 && (
    <motion.div initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} className="flex gap-2">
      <button type="button" onClick={handleDownloadJournal} className="p-2 bg-white/5 hover:bg-[#d4a373]/20 rounded-xl text-gray-400 hover:text-[#d4a373] transition-all border border-white/10 shadow-lg">
        <Download size={14} />
      </button>
      <button type="button" onClick={() => { navigator.clipboard.writeText(journalEntry); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className="p-2 bg-white/5 hover:bg-[#d4a373]/20 rounded-xl text-gray-400 hover:text-[#d4a373] transition-all border border-white/10 shadow-lg">
        {isCopied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </button>
    </motion.div>
  )}
</AnimatePresence>
        </div>
        
        <div className="relative">
  <textarea
    value={journalEntry}
    onChange={(e) => setJournalEntry(e.target.value)}
    disabled={isGlobalLocked}
    className="w-full px-6 py-8 md:px-10 md:py-10 text-lg md:text-xl text-white bg-black/40 border border-white/10 rounded-[2rem] md:rounded-[3rem] focus:border-[#d4a373]/50 focus:bg-black/60 outline-none transition-all duration-500 min-h-[220px] md:min-h-[280px] shadow-[inset_0_2px_40px_rgba(0,0,0,0.7)] leading-relaxed resize-none backdrop-blur-sm placeholder-gray-700"
    placeholder={lang === 'he' ? 'איך עבר היום? ספר לי במילים שלך...' : 'How was your day? Tell me in your own words...'}
    style={{ fontFamily: "'Courier Prime', 'Courier New', monospace" }}
  />
  {/* עיטור אופטי של "מיקוד" בפינות - מוחזר למקור המדויק */}
  <div className="absolute top-6 left-6 w-3 h-3 border-t border-l border-[#d4a373]/30 rounded-tl-sm pointer-events-none" />
  <div className="absolute bottom-6 right-6 w-3 h-3 border-b border-r border-[#d4a373]/30 rounded-br-sm pointer-events-none" />
</div>
      </div>

      {/* אזור בחירת ז'אנר */}
      <div>
        <div className="flex justify-between items-center mb-6 md:mb-8 px-2">
          <label className="text-[#d4a373] text-[10px] md:text-xs font-black uppercase tracking-[0.3em] italic">
            {lang === 'he' ? 'בחר סגנון קולנועי' : 'Select Cinematic Style'}
          </label>
          <button 
            type="button" 
            onClick={() => setIsMusicMuted(!isMusicMuted)} 
            className={`p-2.5 rounded-xl border transition-all duration-300 ${isMusicMuted ? 'border-white/10 bg-white/5 text-gray-500' : 'border-[#d4a373]/50 bg-[#d4a373]/10 text-[#d4a373] shadow-[0_0_15px_rgba(212,163,115,0.2)]'}`}
          >
            {isMusicMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
        
        {/* הגריד המעודכן ל-6 ז'אנרים (ללא קומיקס) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {genres.map((genre) => {
            const Visual = genre.component;
            const isSelected = selectedGenre === genre.value;
            return (
              <motion.button
                key={genre.value}
                type="button"
                onClick={() => setSelectedGenre(genre.value)}
                whileHover={!isGlobalLocked ? { y: -4, scale: 1.02 } : {}}
                whileTap={!isGlobalLocked ? { scale: 0.96 } : {}}
                disabled={isGlobalLocked}
                className={`relative flex flex-col items-center justify-between h-28 md:h-32 p-4 rounded-2xl border transition-all duration-500 overflow-hidden ${isSelected ? genre.activeClass : 'bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10'}`}
              >
                <div className={`mt-2 transition-all duration-500 ${isSelected ? `${genre.textClass} scale-110 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]` : 'text-gray-500 grayscale opacity-70'}`}>
                  <Visual isSelected={isSelected} />
                </div>
                <span className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest z-10 ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                  {lang === 'he' ? genre.label.he : genre.label.en}
                </span>
                
                {isSelected && (
                  <motion.div 
                    layoutId="activeInd" 
                    className="absolute bottom-0 w-full h-1" 
                    style={{ backgroundColor: genre.glowColor }} 
                  />
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* כפתור הפקה מרכזי */}
      {/* כפתור הפקה מרכזי */}
      <motion.button
        type="submit"
        disabled={isGlobalLocked || !journalEntry.trim() || !selectedGenre}
        className={`w-full py-7 md:py-9 rounded-[2rem] md:rounded-[3rem] font-black text-lg md:text-xl uppercase tracking-[0.5em] transition-all duration-700 group relative overflow-hidden ${
          loading 
            ? 'bg-gradient-to-r from-amber-600 via-[#d4a373] to-amber-600 shadow-[0_0_40px_rgba(212,163,115,0.5)] text-black' 
            : 'bg-[#d4a373] text-black hover:shadow-[0_0_60px_rgba(212,163,115,0.4)] active:scale-[0.98]'
        } ${(!journalEntry.trim() || !selectedGenre) && !loading ? 'opacity-30 grayscale cursor-not-allowed' : 'opacity-100'}`}
      >
        {/* אפקט הניצוץ הלבן שעובר על הכפתור */}
        {!loading && !isGlobalLocked && (
          <motion.div 
            animate={{ x: ['-100%', '200%'] }}
            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut", repeatDelay: 1 }}
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-12 z-10"
          />
        )}
        
        <span className="relative z-20 flex items-center justify-center gap-4 italic">
          {loading ? (
            <div className="flex items-center gap-4">
              {/* הספינר המיוחד שלך - 8 קווים מסתובבים */}
              <div className="relative w-8 h-8 flex items-center justify-center mr-2">
                {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
                  <motion.div
                    key={i}
                    style={{ rotate: deg, position: 'absolute' }}
                    className="inset-0 flex items-start justify-center"
                  >
                    <motion.div 
                      animate={{ 
                        height: ["10%", "40%", "10%"],
                        opacity: [0.3, 1, 0.3]
                      }}
                      transition={{ 
                        repeat: Infinity, 
                        duration: 1, 
                        delay: i * 0.125,
                        ease: "easeInOut"
                      }}
                      className="w-[2.5px] bg-black rounded-full"
                    />
                  </motion.div>
                ))}
              </div>
              <span className="animate-pulse">{lang === 'he' ? 'מפיק יצירת מופת...' : 'PRODUCING MASTERPIECE...'}</span>
            </div>
          ) : (
            <>
              {lang === 'he' ? 'צור תסריט' : 'GENERATE SCRIPT'} 
              <Sparkles size={22} className="group-hover:rotate-12 transition-transform duration-300" />
            </>
          )}
        </span>
      </motion.button>
    </form>
  );
}

export default ScriptForm;