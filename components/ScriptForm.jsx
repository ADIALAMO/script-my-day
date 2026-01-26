import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Clapperboard, Mic, Crosshair, Atom, Skull, Gem,
  Sparkles, Copy, Download, Check, Volume2, Camera, VolumeX,
  Film 
} from 'lucide-react';

// --- רכיבי אנימציה (מוגדרים מחוץ לקומפוננטה כדי למנוע יצירה מחדש בכל רינדור) ---
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

// --- רשימת הז'אנרים ---
const genres = [
  { label: { he: 'דרמה', en: 'Drama' }, value: 'drama', component: DramaScene, activeClass: 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)]', textClass: 'text-indigo-400', glowColor: '#6366f1' },
  { label: { he: 'קומדיה', en: 'Comedy' }, value: 'comedy', component: ComedyScene, activeClass: 'bg-amber-500/20 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]', textClass: 'text-amber-400', glowColor: '#f59e0b' },
  { label: { he: 'פעולה', en: 'Action' }, value: 'action', component: ActionScene, activeClass: 'bg-red-600/20 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)]', textClass: 'text-red-500', glowColor: '#ef4444' },
  { label: { he: 'מד"ב', en: 'Sci-Fi' }, value: 'sci-fi', component: SciFiScene, activeClass: 'bg-cyan-500/20 border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.3)]', textClass: 'text-cyan-400', glowColor: '#06b6d4' },
  { label: { he: 'אימה', en: 'Horror' }, value: 'horror', component: HorrorScene, activeClass: 'bg-emerald-900/40 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.2)]', textClass: 'text-emerald-500', glowColor: '#10b981' },
  { label: { he: 'רומנטיקה', en: 'Romance' }, value: 'romance', component: RomanceScene, activeClass: 'bg-rose-500/20 border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]', textClass: 'text-rose-400', glowColor: '#f43f5e' },
];

// --- הקומפוננטה הראשית (אחת ויחידה!) ---
const ScriptForm = ({ onSubmit, loading, lang, isTyping, isTypingGlobal, onInputChange, producerName, setProducerName }) => {
  const [journalEntry, setJournalEntry] = useState('');
  const [activeGenre, setActiveGenre] = useState('drama');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isMusicMuted, setIsMusicMuted] = useState(false);
  const bgMusicRef = useRef(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const getWordCount = (text) => text.trim() ? text.trim().split(/\s+/).length : 0;
  const isLocked = loading || isTypingGlobal;
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

  // +++ הטמעה חדשה +++

  // 1. פונקציית החלפת סאונד - חייבת לקרות בלחיצה (User Gesture)
  const handleGenreChange = (genreValue) => {
    setActiveGenre(genreValue);
    const audio = document.getElementById('main-bg-music');
    if (!audio) return;

    const formattedGenre = genreValue.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
    const fileName = `${formattedGenre}_bg.m4a`;
    
    if (!audio.src.endsWith(fileName)) {
      audio.pause();
      audio.src = `/audio/${fileName}`;
      audio.load();
      audio.loop = true;
      if (isMusicMuted) {
        audio.volume = 0;
      } else {
        audio.volume = (isTyping || isTypingGlobal) ? 0.3 : 0.5;
        // מנגן רק אם המשתמש לא השתיק
        audio.play().catch(err => console.log("Audio Playback Blocked", err));
      }
    }
    if (onInputChange) onInputChange(journalEntry, genreValue);
  };

  // ניהול Ducking - מגיב להקלדת משתמש (isTyping) ולהקלדת סוכן (isTypingGlobal)
  useEffect(() => {
    const audio = document.getElementById('main-bg-music');
    if (!audio) return;

    if (isMusicMuted) {
      audio.volume = 0;
      return; 
    }

    // ה-Ducking יופעל אם אתה מקליד יומן OR אם הסוכן כותב תסריט
    const shouldDuck = isTyping || isTypingGlobal; 

    const targetVolume = shouldDuck ? 0.3 : 0.5;

    audio.volume = targetVolume;
    if (audio.paused) {
      audio.play().catch(err => console.log("Audio play resumed", err));
    }
    
    console.log(`🎵 Audio Update: Ducking=${shouldDuck ? 'ON' : 'OFF'}, Vol=${targetVolume}`);
  }, [isTyping, isTypingGlobal, isMusicMuted]);
  
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
    if (isGlobalLocked || !journalEntry.trim() || !activeGenre) return;

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const audioCtx = new AudioCtx();
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }
    } catch (err) {
      console.log("Audio unlock failed", err);
    }

    // קריאה לפונקציה שהועברה מההורה
    onSubmit(journalEntry, activeGenre);
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
        
        {/* כפתור השראה והמודל */}
        <div className="relative mb-6 px-2 w-fit"> 
          <motion.button
            type="button"
           disabled={isLocked}
            onClick={() => !isLocked && setIsModalOpen(!isModalOpen)}
            whileHover={!isLocked ? { scale: 1.02 } : {}}
            whileTap={!isLocked ? { scale: 0.98 } : {}}
            className={`flex items-center gap-2.5 px-4 py-2 rounded-full bg-white/5 border border-white/10 hover:border-[#d4a373]/40 transition-all duration-500 group shadow-lg ${
              isLocked ? 'opacity-40 cursor-not-allowed' : ''
            }`}
          >
            <Sparkles size={14} className="text-[#d4a373] group-hover:rotate-12 transition-transform" />
            <span className="text-[10px] font-black uppercase tracking-[0.15em] text-white/70 group-hover:text-white">
              {lang === 'he' ? 'הצתת השראה' : 'Spark Inspiration'}
            </span>
          </motion.button>

          <AnimatePresence>
            {isModalOpen && (
              <>
                <div className="fixed inset-0 z-[140] bg-transparent" onClick={() => setIsModalOpen(false)} />
                <motion.div 
                  initial={{ opacity: 0, x: lang === 'he' ? 10 : -10, scale: 0.95 }} 
                  animate={{ opacity: 1, x: 0, scale: 1 }} 
                  exit={{ opacity: 0, x: lang === 'he' ? 10 : -10, scale: 0.95 }}
                  className={`absolute left-0 right-0 mx-auto bottom-[-55px] z-[150] w-[260px] md:w-[280px] bg-[#0a0a0a]/90 backdrop-blur-3xl border border-[#d4a373]/30 p-2 rounded-[1.5rem] shadow-[0_10px_40px_rgba(0,0,0,0.8)]`}
                >
                  <div className="flex flex-col gap-1">
                    {(lang === 'he' ? [
                      { emoji: "🎭", label: "דרמה", short: "היום שהכל השתנה...", full: "היום התחיל בשתיקה כבדה ליד שולחן ארוחת הבוקר. מבט אחד מקרי הבהיר ששום דבר כבר לא יחזור להיות כפי שהיה פעם, והסודות המודחקים מתחילים לצוף." },
                      { emoji: "❤️", label: "רומנטיקה", short: "מבט מקרי בגשם...", full: "זה התחיל במבט מקרי בבית הקפה השכונתי תחת הגשם השוטף. הרגשתי שהלב שלי פועם בקצב לא מוכר כשהיא חייכה אלי, ופתאום כל רעשי העולם נעלמו והפכו למוזיקה עדינה." },
                      { emoji: "👽", label: "מד״ב", short: "השמיים הפכו סגולים...", full: "השמיים הפכו סגולים זרחניים וחללית ענקית הופיעה מעל קו הרקיע של העיר. הרובוטים החלו לרדת אל הרחובות כשהם נושאים טכנולוגיה זרה שמשנה את חוקי הפיזיקה המוכרים לנו." },
                      { emoji: "😱", label: "אימה", short: "צעקה מהקומה למעלה...", full: "הדלת נפתחה בחריקה צורמת אל תוך חושך מוחלט שבו הריח של העבר עמד באוויר. פתאום נשמעה צעקה חנוקה מהקומה העליונה וצל שחור נע במהירות בקצה המסדרון." }
                    ] : [
                      { emoji: "🎭", label: "Drama", short: "The day it all changed...", full: "The day began with a heavy silence at the breakfast table. One chance look made it clear that nothing would ever be the same again, as suppressed secrets began to surface." },
                      { emoji: "❤️", label: "Romance", short: "A glance in the rain...", full: "It started with a chance glance in a cozy coffee shop during a downpour. I felt my heart beat in an unfamiliar rhythm when she smiled at me, and the world's noise vanished." },
                      { emoji: "👽", label: "Sci-Fi", short: "Purple neon skies...", full: "The sky turned a glowing purple as a massive ship appeared over the skyline. Robots began to descend into the streets, bringing alien technology that defies the laws of physics." },
                      { emoji: "😱", label: "Horror", short: "A scream from above...", full: "The door creaked open into total darkness where the scent of the past hung heavy. Suddenly, a muffled scream echoed from upstairs and a dark shadow darted across the hallway." }
                    ]).map((example, index) => (
                      <button
                        key={index}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setJournalEntry(example.full);
                          if (onInputChange) onInputChange(example.full);
                          setIsModalOpen(false);
                        }}
                        className="flex items-center gap-2.5 w-full p-2 rounded-xl bg-white/[0.02] hover:bg-[#d4a373]/20 border border-transparent hover:border-[#d4a373]/30 transition-all duration-300 group/item text-right"
                      >
                        <span className="text-sm flex-shrink-0 group-hover/item:scale-110 transition-transform">{example.emoji}</span>
                        <div className="flex flex-col items-start overflow-hidden">
                          <span className="text-[8px] font-black text-[#d4a373] uppercase tracking-tighter">{example.label}</span>
                          <span className="text-[9px] text-white/50 truncate w-full text-start">{example.short}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </motion.div>
              </>
            )}
          </AnimatePresence>
        </div>

       {/* תיבת הטקסט */}
        <div className="relative">
          <textarea
            value={journalEntry}
            onChange={(e) => {
              const value = e.target.value;
              const wordsArray = value.trim() ? value.trim().split(/\s+/) : [];
              const wordCount = wordsArray.length;
              
              if (wordCount <= 500) {
                // אם זה מתחת ל-500, פשוט תעדכן
                setJournalEntry(value);
              } else {
                // אם המשתמש מדביק טקסט ארוך מדי - אנחנו חותכים אותו ל-500 המילים הראשונות
                const truncatedText = wordsArray.slice(0, 500).join(' ');
                setJournalEntry(truncatedText);
                
                // אופציונלי: אפשר להוסיף כאן התראה קטנה שהטקסט נחתך
                console.warn("Text truncated to 500 words limit");
              }
            }}
            disabled={isLocked}
            spellCheck="false"
            autoCorrect="off"
            autoCapitalize="none"
            className={`w-full px-6 py-8 md:px-10 md:py-10 text-lg md:text-xl text-white bg-black/40 border border-white/10 rounded-[2rem] md:rounded-[3rem] focus:border-[#d4a373]/50 focus:bg-black/60 outline-none transition-all duration-500 min-h-[220px] md:min-h-[280px] shadow-[inset_0_2px_40px_rgba(0,0,0,0.7)] leading-relaxed resize-none backdrop-blur-sm placeholder-gray-700 ${
              isLocked ? 'opacity-50 cursor-not-allowed grayscale-[0.5] border-white/5' : ''
             }`}
              placeholder={lang === 'he' ? 'איך עבר היום? ספר לי במילים שלך...' : 'How was your day? Tell me in your own words...'}
            style={{ fontFamily: "'Courier Prime', 'Courier New', monospace" }}
          />

          {/* מונה מילים קולנועי - מיקום אבסולוטי ביחס לתיבה */}
          <div className="absolute -bottom-10 right-2 flex items-center gap-3">
            <div className="flex flex-col items-end">
              <span className={`text-[9px] font-black tracking-[0.2em] uppercase transition-colors duration-300 ${
                (journalEntry.trim() ? journalEntry.trim().split(/\s+/).length : 0) >= 480 ? 'text-red-500' : 'text-[#d4a373]/50'
              }`}>
                {lang === 'he' ? 'מונה מילים' : 'WORD COUNT'}
              </span>
              <div className="flex items-baseline gap-1 font-mono">
                <span className="text-sm font-bold text-white">
                  {journalEntry.trim() ? journalEntry.trim().split(/\s+/).length : 0}
                </span>
                <span className="text-[10px] text-white/20">/ 500</span>
              </div>
            </div>
          </div>

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
          </div>

          <button 
            type="button" 
            onClick={() => {
              if (isLocked) return;
              
              const newMutedState = !isMusicMuted;
              setIsMusicMuted(newMutedState);

              // ניסיון גישה בשתי דרכים כדי להבטיח עבודה במובייל
              const audio = document.getElementById('main-bg-music') || window.mainAudio;
              
              if (audio) {
                // במובייל: שינוי ווליום חייב לקרות בתוך ה-Click
                audio.volume = newMutedState ? 0 : (isTyping || isTypingGlobal ? 0.3 : 0.5);
                audio.muted = newMutedState; // תוספת אבטחה למובייל

                // אם המשתמש מבטל השתקה - "להעיר" את האודיו
                if (!newMutedState) {
                  const playPromise = audio.play();
                  if (playPromise !== undefined) {
                    playPromise.catch(() => {
                      // אם נחסם, ננסה שוב עם ווליום נמוך
                      audio.volume = 0.3;
                      audio.play();
                    });
                  }
                }
              }
            }} 
            disabled={isLocked}
            className={`p-2.5 rounded-xl border transition-all duration-300 ${
              isMusicMuted ? 'border-white/10 bg-white/5 text-gray-500' : 'border-[#d4a373]/50 bg-[#d4a373]/10 text-[#d4a373]'
            } ${isLocked ? 'opacity-30 cursor-not-allowed' : ''}`}
          >
            {isMusicMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
          {genres.map((genre) => {
            const Visual = genre.component;
            const isSelected = activeGenre === genre.value;
            return (
              <motion.button
                key={genre.value}
                type="button"
                onClick={() => handleGenreChange(genre.value)}

                whileHover={!isGlobalLocked ? { y: -4, scale: 1.02 } : {}}
                whileTap={!isGlobalLocked ? { scale: 0.96 } : {}}
                disabled={isGlobalLocked}
// להוסיף את ה-Template Literal בסוף ה-className:
className={`relative flex flex-col items-center justify-between h-28 md:h-32 p-4 rounded-2xl border transition-all duration-500 overflow-hidden ${
  isSelected ? genre.activeClass : 'bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10'
} ${isLocked ? 'opacity-40 grayscale-[0.8] cursor-not-allowed pointer-events-none' : ''}`}
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
      
     {/* שדה במאי הסרט - מוגבל למראה מקצועי */}
      <div className="mb-6 relative group max-w-[320px]">
        <div className="absolute -right-8 top-10 text-[#d4a373] opacity-20 group-hover:opacity-100 transition-opacity hidden md:block">
          <Camera size={20} />
        </div>
        <label className="block text-[#d4a373] text-[10px] uppercase tracking-[0.4em] mb-3 font-black italic">
          {lang === 'he' ? 'קרדיט ליוצר/ת:' : 'CREATOR CREDIT:'}
        </label>
        <div className="relative">
          <input 
            type="text"
            value={producerName}
            onChange={(e) => {
              const val = e.target.value.slice(0, 22); // הגבלה כירורגית ל-22 תווים
              setProducerName(val);
              localStorage.setItem('lifescript_producer_name', val);
            }}
            placeholder={lang === 'he' ? 'הזן שם לקרדיטים...' : 'Enter name for credits...'}
            className="w-full bg-black/40 border-b border-[#d4a373]/30 p-3 text-white focus:border-[#d4a373] outline-none transition-all italic tracking-widest text-sm md:text-base placeholder:opacity-20"
            maxLength={22}
          />
          
          {/* מונה תווים עדין שמופיע רק כשמתקרבים לקצה */}
          {producerName.length > 15 && (
            <motion.span 
              initial={{ opacity: 0 }} 
              animate={{ opacity: 1 }}
              className="absolute -bottom-5 right-0 text-[8px] text-[#d4a373]/40 tracking-widest uppercase"
            >
              {22 - producerName.length} {lang === 'he' ? 'נותרו' : 'left'}
            </motion.span>
          )}
        </div>
      </div>

      {/* כפתור הפקה מרכזי */}
      <motion.button
        type="submit"
        disabled={isLocked || !journalEntry.trim() || !activeGenre}
        className={`relative w-full group overflow-hidden rounded-[1.5rem] md:rounded-[2rem] transition-all duration-700 shadow-[0_10px_40px_rgba(212,163,115,0.2)] ${
          loading 
            ? 'bg-gradient-to-r from-amber-600 via-[#d4a373] to-amber-600 py-6 md:py-8' 
            : 'bg-[#d4a373] py-5 md:py-7 hover:scale-[1.01] active:scale-[0.98]'
        } ${(!journalEntry.trim() || !activeGenre) && !loading ? 'opacity-30 grayscale cursor-not-allowed' : 'opacity-100'}`}
      >
{!loading && !isLocked && journalEntry.trim() && activeGenre && (
            <motion.div 
            animate={{ x: ['-100%', '200%'] }}
            transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
            className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent skew-x-[35deg] z-10"
          />
        )}
        
        <div className="relative z-20 flex items-center justify-center w-full h-full px-4 md:px-10 italic text-black font-black">
           {loading ? (
              <div className={`flex items-center gap-3 w-full max-w-xs ${lang === 'he' ? 'flex-row-reverse' : 'flex-row'}`}>
              <div className="relative w-5 h-5 flex-shrink-0">
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

              <div className="relative h-6 flex-grow overflow-hidden flex items-center">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={loadingMessageIndex}
                    initial={{ y: 15, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -15, opacity: 0 }}
                    className="absolute whitespace-nowrap text-[13px] md:text-[18px] tracking-tighter"
                  >
                    {loadingMessages[loadingMessageIndex]}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-3">
              <Film size={20} />
              <span className="text-[15px] md:text-xl uppercase tracking-tighter whitespace-nowrap">
                {lang === 'he' ? 'צור תסריט' : 'GENERATE SCRIPT'}
              </span>
            </div>
          )}
        </div>
      </motion.button>
    </form>
  );
}

export default ScriptForm;