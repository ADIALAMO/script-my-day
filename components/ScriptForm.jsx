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

function ScriptForm({ onGenerateScript, loading, lang, isTyping, onInputChange, selectedGenre, genreIcons }) {
  const [journalEntry, setJournalEntry] = useState('');
const [manualGenre, setManualGenre] = useState(null);
// המערכת תעדיף בחירה ידנית, ואם אין - תציג את המלצת ה-AI
  const activeGenre = manualGenre || selectedGenre; 
  const [isCopied, setIsCopied] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(true);
  const bgMusicRef = useRef(null);
// --- הוספה/עדכון של לוגיקת הודעות טעינה (תסריט בלבד) ---
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  
 const loadingMessages = lang === 'he' ? [
    "סורק זכרונות...",
    "מנתח DNA סיפורי...",
    "בונה מתח דרמטי...",
    "מלטש דיאלוגים...",
    "מעבה דמויות...",
    "פורש קווי עלילה...",
    "מדפיס עותקים..."
  ] : [
    "Scanning memories...",
    "Analyzing story DNA...",
    "Building tension...",
    "Polishing dialogue...",
    "Developing characters...",
    "Plotting twists...",
    "Printing scripts..."
  ];

  useEffect(() => {
    let interval;
    if (loading) {
      interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % loadingMessages.length);
      }, 2800);
    } else {
      setLoadingMessageIndex(0);
    }
    return () => clearInterval(interval);
  }, [loading, loadingMessages.length]);

  const isGlobalLocked = loading || isTyping;

  // טיפול במוזיקה - תיקון פורמט השם למניעת שגיאות 404
  useEffect(() => {
    if (bgMusicRef.current) {
      bgMusicRef.current.pause();
      bgMusicRef.current = null;
    }
    
    if (activeGenre) {
      // הפיכת השם לפורמט אחיד: הכל קטנות, והחלפת CamelCase למקף
      // זה הופך sciFi ל-sci-fi באופן אוטומטי
      const formattedGenre = activeGenre
        .replace(/([a-z])([A-Z])/g, '$1-$2')
        .toLowerCase();
        
      const audioPath = `/audio/${formattedGenre}_bg.m4a`;
      
      bgMusicRef.current = new Audio(audioPath);
      bgMusicRef.current.loop = true;
      bgMusicRef.current.volume = 0.25;
      bgMusicRef.current.muted = isMusicMuted;

      if (!isMusicMuted) {
        bgMusicRef.current.play().catch(err => 
          console.log("Audio play blocked or file missing at:", audioPath)
        );
      }
    }
    return () => {
      if (bgMusicRef.current) bgMusicRef.current.pause();
    };
  }, [activeGenre, isMusicMuted]);

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
        
 {/* אזור הדוגמאות להשראה - איזון מושלם בין גודל לקומפקטיות */}
<div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-5 px-2">
  {(lang === 'he' ? [
    { emoji: "🎭", label: "דרמה יומית", text: "היום התחיל בשתיקה כבדה ליד שולחן ארוחת הבוקר. מבט אחד הבהיר שהכל עומד להשתנות." },
    { emoji: "❤️", label: "דייט מהסרטים", text: "זה התחיל במבט מקרי בבית הקפה, הרגשתי שהלב שלי פועם חזק. היא חייכה אלי ופתאום העולם נעלם." },
    { emoji: "👽", label: "פלישה מהחלל", text: "השמיים הפכו סגולים וחללית ענקית הופיעה מעל העיר. הרובוטים התחילו לרדת עם טכנולוגיה זרה." },
    { emoji: "😱", label: "בית נטוש", text: "הדלת נפתחה בחריקה והיה חושך מוחלט. פתאום שמעתי צעקה מלמעלה וראיתי צל זז במסדרון." }
  ] : [
    { emoji: "🎭", label: "Daily Drama", text: "The day began with a heavy silence. One look made it clear everything was about to change." },
    { emoji: "❤️", label: "Movie Date", text: "It started with a chance glance in the coffee shop, I felt my heart beating fast. She smiled at me." },
    { emoji: "👽", label: "Alien Invasion", text: "The sky turned purple and a massive spaceship appeared. Robots began to descend with alien tech." },
    { emoji: "😱", label: "Abandoned House", text: "The door creaked open into total darkness. Suddenly I heard a scream and saw a shadow move." }
  ]).map((example, index) => (
    <button
      key={index}
      type="button"
      onClick={() => {
        setJournalEntry(example.text);
        if (onInputChange) onInputChange(example.text);
      }}
      className="h-9 px-3 rounded-xl bg-white/[0.04] hover:bg-[#d4a373]/20 border border-white/10 hover:border-[#d4a373]/40 transition-all duration-300 backdrop-blur-md cursor-pointer flex items-center justify-center gap-2 group overflow-hidden"
    >
      {/* אייקון מוגדל מעט */}
      <span className="text-sm md:text-base group-hover:scale-110 transition-transform duration-300">
        {example.emoji}
      </span>
      
      {/* טקסט מוגדל וברור יותר */}
      <span className="text-[10px] md:text-[11px] text-white/50 group-hover:text-white font-bold uppercase tracking-tight whitespace-nowrap">
        {example.label}
      </span>
    </button>
  ))}
</div>

        <div className="relative">
  <textarea
  value={journalEntry}
  onChange={(e) => {
    const value = e.target.value;
    setJournalEntry(value); // עדכון מקומי
    if (onInputChange) onInputChange(value); // דיווח לדף הבית לזיהוי ז'אנר
  }}
  disabled={isGlobalLocked}
  spellCheck="false"
  autoCorrect="off"
  autoCapitalize="none"
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
          <div className="flex items-center gap-3">
            <label className="text-[#d4a373] text-[10px] md:text-xs font-black uppercase tracking-[0.3em] italic">
              {lang === 'he' ? 'בחר סגנון קולנועי' : 'Select Cinematic Style'}
            </label>

            <AnimatePresence>
              {selectedGenre && (
                <motion.div 
                  initial={{ opacity: 0, x: -10 }} 
                  animate={{ opacity: 1, x: 0 }} 
                  exit={{ opacity: 0, x: -10 }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#d4a373]/10 border border-[#d4a373]/20 backdrop-blur-sm"
                >
                  <span className="text-base leading-none">{genreIcons[selectedGenre]}</span>
                  <span className="text-[8px] md:text-[9px] font-bold text-[#d4a373] uppercase tracking-wider">
                    {lang === 'he' ? "זיהינו ז'אנר מתאים" : "Suggested Style"}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <button 
            type="button" 
            onClick={() => setIsMusicMuted(!isMusicMuted)} 
            className={`p-2.5 rounded-xl border transition-all duration-300 ${isMusicMuted ? 'border-white/10 bg-white/5 text-gray-500' : 'border-[#d4a373]/50 bg-[#d4a373]/10 text-[#d4a373]'}`}
          >
            {isMusicMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
        
        {/* הגריד המעודכן ל-6 ז'אנרים (ללא קומיקס) */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {genres.map((genre) => {
            const Visual = genre.component;
            const isSelected = activeGenre === genre.value;
            return (
              <motion.button
                key={genre.value}
                type="button"
                onClick={() => setManualGenre(genre.value)}
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
        
     <span className="relative z-20 flex items-center w-full h-full px-4 md:px-10 italic">
  {loading ? (
    <div className={`flex items-center gap-3 w-full ${lang === 'he' ? 'flex-row-reverse' : 'flex-row'}`}>
      <div className="relative w-6 h-6 flex-shrink-0 flex items-center justify-center">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => (
          <motion.div
            key={i}
            style={{ rotate: deg, position: 'absolute' }}
            className="inset-0 flex items-start justify-center"
          >
            <motion.div 
              animate={{ height: ["10%", "40%", "10%"], opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1, delay: i * 0.125 }}
              className="w-[2px] bg-black rounded-full"
            />
          </motion.div>
        ))}
      </div>

      <div className={`relative h-8 flex-grow overflow-hidden flex items-center ${lang === 'he' ? 'text-right' : 'text-left'}`}>
  <AnimatePresence mode="wait">
    <motion.span
      key={loadingMessageIndex}
      initial={{ y: 15, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -15, opacity: 0 }}
      className={`absolute whitespace-nowrap font-black tracking-tighter text-[14px] md:text-[22px] lg:text-[24px] ${
        lang === 'he' ? 'right-0 pr-2' : 'left-0 pl-2'
      }`}
    >
      {loadingMessages[loadingMessageIndex]}
    </motion.span>
  </AnimatePresence>
</div>
    </div>
  ) : (
    <div className="flex items-center justify-center w-full gap-4 text-lg md:text-xl">
      {lang === 'he' ? 'צור תסריט' : 'GENERATE SCRIPT'} 
      <Sparkles size={22} className="group-hover:rotate-12 transition-transform duration-300" />
    </div>
  )}
</span>
      </motion.button>
    </form>
  );
}

export default ScriptForm;