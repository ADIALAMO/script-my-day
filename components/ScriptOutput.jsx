import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Check, Film, Volume2, VolumeX, Loader2, FastForward } from 'lucide-react';
import html2canvas from 'html2canvas';

// --- לוגיקה עוטפת: ניקוי כותרות ותרגום ז'אנרים ---
// הוספת פונקציית העזר לזיהוי שפה
const isTextHebrew = (text) => /[\u0590-\u05FF]/.test(text);

const getCinematicTitle = (text) => {
  if (!text) return "";
  let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let titleCandidate = lines[0] || "";

  // שיפרנו את הבדיקה כך שתזהה גם "סצנה", "Script" וכו', ותעבור לשורה הבאה אם צריך
  if (titleCandidate.match(/^(תסריט|script|screenplay|scene|סצנה|כותרת)[:\s-]*$/i) || 
      titleCandidate.toLowerCase().includes("screenplay") || 
      titleCandidate.includes("תסריט")) {
     titleCandidate = lines[1] || titleCandidate;
  }

  // ניקוי עמוק יותר: מסיר כוכביות (Markdown), סוגריים וסימני פיסוק בקצוות שנשארים לפעמים
  return titleCandidate
    .replace(/[*#_:]/g, '')           // הוספנו את המנקה המקורי שלך
    .replace(/\[.*?\]/g, '')         // ניקוי סוגריים מרובעים
    .replace(/^[.\s:-]+|[.\s:-]+$/g, '') // חדש: מנקה נקודות או מקפים מיותרים שנשארים בהתחלה/סוף
    .trim();
};

const translateGenre = (genre) => {
  const map = {
    // תמיכה בעברית (עבור תאימות)
    'אימה': 'Horror', 'קומדיה': 'Comedy', 'דרמה': 'Drama', 'אקשן': 'Action',
    'פעולה': 'Action', 'מדע בדיוני': 'Sci-Fi', 'מתח': 'Thriller', 
    'רומנטיקה': 'Romance', 'קומיקס': 'Comic',
    // תמיכה ב-IDs באנגלית (מהממשק החדש)
    'horror': 'Horror', 'comedy': 'Comedy', 'drama': 'Drama', 'action': 'Action',
    'sci-fi': 'Sci-Fi', 'thriller': 'Thriller', 'romance': 'Romance', 'comic': 'Comic'
  };
  // הפיכה ל-lowercase כדי לוודא התאמה מושלמת
  const normalized = genre?.toLowerCase().trim();
  return map[normalized] || genre || 'Cinematic';
};

function ScriptOutput({ script, lang, setIsTypingGlobal, genre }) {
  // --- States ---
  const [cleanScript, setCleanScript] = useState('');
  const [visualPrompt, setVisualPrompt] = useState('');
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showPoster, setShowPoster] = useState(false);
  const [posterUrl, setPosterUrl] = useState('');
  const [posterLoading, setPosterLoading] = useState(false);
const [triggerFlash, setTriggerFlash] = useState(false);

  // --- Refs ---
  const scrollRef = useRef(null);
  const posterRef = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const pauseTimer = useRef(null);
  const timerRef = useRef(null);
  const audioContext = useRef(null);
  const audioBuffer = useRef(null);
  const flashBuffer = useRef(null);
  const isMutedRef = useRef(isMuted);

  // סנכרון Ref להשתקה
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // --- מנוע סאונד ---
 // --- מנוע סאונד קולנועי משודרג ---
  useEffect(() => {
    const initAudio = async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!audioContext.current) audioContext.current = new AudioCtx();
        
        const response = await fetch('/audio/typewriter.m4a');
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer.current = await audioContext.current.decodeAudioData(arrayBuffer);
        
        const responseFlash = await fetch('/audio/camera-flash.wav');
        const arrayBufferFlash = await responseFlash.arrayBuffer();
        flashBuffer.current = await audioContext.current.decodeAudioData(arrayBufferFlash);

        const unlock = () => {
          if (audioContext.current?.state === 'suspended') {
            audioContext.current.resume();
          }
          // מסירים את ההאזנה אחרי הפעם הראשונה שזה עובד
          window.removeEventListener('click', unlock);
          window.removeEventListener('touchstart', unlock);
          window.removeEventListener('mousemove', unlock);
        };
        window.addEventListener('click', unlock);
        window.addEventListener('touchstart', unlock);
        window.addEventListener('mousemove', unlock);
      } catch (e) { console.error("Audio engine failed", e); }
    };
    initAudio();
  }, []);

 const playSound = () => {
    if (isMutedRef.current || !audioBuffer.current || !audioContext.current) return;
    
    // ניסיון "להעיר" את הקונטקסט אם הוא מושהה
    if (audioContext.current.state === 'suspended') {
      audioContext.current.resume();
    }

    const source = audioContext.current.createBufferSource();
    source.buffer = audioBuffer.current;
    
    const gainNode = audioContext.current.createGain();
    
    // הגברת עוצמה: העלינו מ-0.12 ל-0.35 (כמעט פי 3)
    const volume = 0.35; 
    gainNode.gain.setValueAtTime(volume, audioContext.current.currentTime);
    
    // דעיכה עדינה מאוד רק בסוף כדי למנוע קליקים, אבל לשמור על עוצמה
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.current.currentTime + 0.12);
    
    source.playbackRate.value = 0.92 + Math.random() * 0.15;
    
    source.connect(gainNode);
    gainNode.connect(audioContext.current.destination);
    source.start(0);
    source.stop(audioContext.current.currentTime + 0.15);
  };
  const playFlashSound = () => {
    // בודק אם המשתמש במיוט או אם הסאונד לא נטען
    if (isMutedRef.current || !flashBuffer.current || !audioContext.current) return;
    
    // יצירת מקור סאונד חדש
    const source = audioContext.current.createBufferSource();
    source.buffer = flashBuffer.current;
    
    // ניהול עוצמת קול (Gain)
    const gainNode = audioContext.current.createGain();
    
    // הגדרת תזמון ווליום (כדי שהקליק יהיה חזק והטעינה שקטה יותר)
    const now = audioContext.current.currentTime;
    gainNode.gain.setValueAtTime(0.5, now); // עוצמת ה"קליק"
    gainNode.gain.exponentialRampToValueAtTime(0.15, now + 1.5); // הנמכה עדינה בזמן ה-Charging
    
    source.connect(gainNode);
    gainNode.connect(audioContext.current.destination);
    
    // הפעלה
    source.start(0);
  };
  // --- עיבוד טקסט וחילוץ הנחיות ויזואליות ---
 // --- עיבוד טקסט וחילוץ הנחיות ויזואליות (כולל ניקוי תגיות HTML) ---
  useEffect(() => {
    if (!script) return;
    
    // ניקוי תגיות <br> והפיכתן לירידת שורה אמיתית
    let processedScript = script.replace(/<br\s*\/?>/gi, '\n');
    
    const marker = "[image:";
    const markerIndex = processedScript.toLowerCase().indexOf(marker);
    
    if (markerIndex !== -1) {
      setCleanScript(processedScript.substring(0, markerIndex).trim());
      const endBracketIndex = processedScript.indexOf("]", markerIndex);
      setVisualPrompt(processedScript.substring(markerIndex + marker.length, endBracketIndex).trim());
    } else {
      setCleanScript(processedScript);
      setVisualPrompt("Cinematic masterpiece, dramatic lighting");
    }
    setDisplayText('');
    setShowPoster(false);
  }, [script]);

  // --- מנוע הקלדה רספונסיבי ---
  // --- מנוע הקלדה הוליוודי רספונסיבי ---
  useEffect(() => {
    if (!cleanScript) return;
    setIsTyping(true);
    setIsTypingGlobal?.(true);
    let i = 0;
    
    const typeChar = () => {
      if (i >= cleanScript.length) {
        setIsTyping(false);
        setIsTypingGlobal?.(false);
        return;
      }
      
      setDisplayText(cleanScript.substring(0, i + 1));
      
      // התיקון הקריטי: מנגנים סאונד רק כל תו שני (i % 2 === 0)
      // זה מונע מהגלים להתנגש וליצור רעש דיגיטלי, ונשמע כמו קצב הקלדה טבעי
      if (cleanScript[i] && !/\s/.test(cleanScript[i]) && i % 2 === 0) {
        playSound();
      }
      
      if (scrollRef.current && !isAutoScrollPaused.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' });
      }
      
      i++;
      // מהירות 40ms: מהירה מספיק למקצוענות, איטית מספיק ליציבות סאונד
      timerRef.current = setTimeout(typeChar, 40);
    };
    
    typeChar();
    return () => clearTimeout(timerRef.current);
  }, [cleanScript]);
  // --- יצירת פוסטר ---
 const generatePoster = () => {
    setPosterLoading(true);
    setShowPoster(true);
    const genreTag = translateGenre(genre);
    const seed = Math.floor(Math.random() * 999999);
    
    const cleanVisual = visualPrompt.replace(/[^\w\s\u0590-\u05FF,]/gi, '').slice(0, 300);
    
    // ה-Prompt המרכזי שמתמקד רק במה שכן רוצים
    const prompt = `Official movie key visual, ${genreTag} style, ${cleanVisual}. High budget, ultra-realistic, 8k, cinematic composition, centered subject.`;
    
    // ה-Negative Prompt המחוזק - רשימת ה"אסור" שלנו
    const negative = `text, letters, alphabet, typography, credits, watermark, chinese characters, kanji, japanese, russian, cyrillic, script, signature, logos, symbols, blur, distortion, low quality`;
    
    // בניית ה-URL בצורה מקצועית עם פרמטר negative נפרד
    const directUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1536&seed=${seed}&nologo=true&negative=${encodeURIComponent(negative)}`;
    
    setPosterUrl(`/api/proxy-image?url=${encodeURIComponent(directUrl)}`);
  };
const handleCapturePoster = async (action) => {
    if (!posterRef.current) return;
    
    try {
      // יצירת קנבס מהאלמנט כולל כל השכבות והטקסטים
      const canvas = await html2canvas(posterRef.current, {
        useCORS: true,      // קריטי כדי לאפשר צילום של תמונה משרת חיצוני
        scale: 2,           // איכות HD
        backgroundColor: null,
        logging: false,
      });
      
      const imageBlob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1.0));
      const file = new File([imageBlob], `${posterTitle || 'movie-poster'}.png`, { type: 'image/png' });

      if (action === 'download') {
        const url = URL.createObjectURL(imageBlob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${posterTitle || 'movie-poster'}.png`;
        link.click();
        URL.revokeObjectURL(url);
      } else if (action === 'share') {
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          // --- כאן התיקון לכירורגי למניעת ה-AbortError ---
          try {
            await navigator.share({ files: [file], title: posterTitle });
          } catch (shareErr) {
            // אם המשתמש ביטל את השיתוף (AbortError), אנחנו פשוט יוצאים בשקט
            if (shareErr.name === 'AbortError') {
              console.log('Share cancelled by user');
              return; 
            }
            // אם זו שגיאה אחרת, נזרוק אותה ל-catch החיצוני
            throw shareErr;
          }
        } else {
          // Fallback למחשב או דפדפן ישן
          const url = URL.createObjectURL(imageBlob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${posterTitle || 'movie-poster'}.png`;
          link.click();
          URL.revokeObjectURL(url);
        }
      }
    } catch (err) {
      // כאן אנחנו מוודאים שהקוד לא יקרוס בשגיאות ביטול
      if (err.name !== 'AbortError') {
        console.error("Capture failed:", err);
      }
    }
  };
  // תיקון: זיהוי שפה לפי התוכן במקום לפי ה-Prop
  const isHebrew = isTextHebrew(cleanScript);
  const posterTitle = getCinematicTitle(cleanScript);

  // --- הגדרת הקרדיטים המדויקים לפי השפה ---
  const credits = isHebrew ? {
    comingSoon: 'בקרוב בקולנוע',
    line1: 'בימוי: עדי אלמו • הפקה: LIFESCRIPT STUDIO',
    line2: 'צילום: מעבדת AI • עיצוב אמנותי: הוליווד דיגיטלית • ליהוק: וירטואלי',
    line3: 'מוזיקה: THE MASTER • עריכה: סוכן 2005 • אפקטים: מנוע קולנועי',
    copyright: '© 2025 LIFESCRIPT STUDIO • כל הזכויות שמורות'
  } : {
    comingSoon: 'COMING SOON',
    line1: 'DIRECTED BY ADI ALAMO • PRODUCED BY LIFESCRIPT STUDIO',
    line2: 'CINEMATOGRAPHY: AI LAB • ART DIRECTION: DIGITAL HOLLYWOOD • CASTING: VIRTUAL',
    line3: 'MUSIC: THE MASTER • EDITING: AGENT 2005 • VFX: CINEMATIC ENGINE',
    copyright: '© 2025 LIFESCRIPT STUDIO • ALL RIGHTS RESERVED'
  };

  return (
    <div className="space-y-6 w-full max-w-[100vw]">
      
      {/* Toolbar */}
      <div className="flex justify-between items-center px-6">
        <div className="flex items-center gap-2">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase text-[10px] tracking-widest italic">LIFESCRIPT STUDIO</h2>
        </div>
        
        <div className="flex items-center gap-2">
          {isTyping && (
            <button 
              onClick={() => { clearTimeout(timerRef.current); setDisplayText(cleanScript); setIsTyping(false); setIsTypingGlobal?.(false); }} 
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a373]/20 border border-[#d4a373]/40 rounded-full text-[10px] text-[#d4a373] font-bold hover:bg-[#d4a373]/30 transition-all"
            >
              <FastForward size={12} /> {isHebrew ? 'דלג' : 'SKIP'}
            </button>
          )}

          <button onClick={() => setIsMuted(!isMuted)} className="p-2.5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors">
            {isMuted ? <VolumeX size={18} className="text-red-500" /> : <Volume2 size={18} className="text-[#d4a373]" />}
          </button>
          
          <button 
            onClick={() => {
              const blob = new Blob([cleanScript], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${posterTitle || 'script'}.txt`;
              link.click();
              URL.revokeObjectURL(url);
            }} 
            className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-[#d4a373] transition-colors"
          >
            <Download size={18} />
          </button>

          <button 
            onClick={() => {
              navigator.clipboard.writeText(cleanScript);
              setIsCopied(true);
              setTimeout(() => setIsCopied(false), 2000);
            }} 
            className="p-2.5 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-colors"
          >
            {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-gray-400" />}
          </button>
        </div>
      </div>

      {/* Script Page View */}
      <div className="relative rounded-[3.5rem] overflow-hidden bg-[#030712]/90 border border-white/5 shadow-2xl mx-2 md:mx-4">
        <div 
  ref={scrollRef} 
  className="h-[500px] md:h-[650px] overflow-y-auto p-10 md:p-20 custom-scrollbar relative touch-pan-y"
  // מניעת התנגשות במובייל ובדסקטופ
  onWheel={(e) => {
    // עצירה מיידית בכל גלגול
    isAutoScrollPaused.current = true;
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    
    // אם המשתמש גולל למטה והגיע לאזור הכתיבה - מחזירים מיידית
    const s = scrollRef.current;
    if (s && e.deltaY > 0) {
      const isAtBottom = s.scrollHeight - s.scrollTop <= s.clientHeight + 100;
      if (isAtBottom) isAutoScrollPaused.current = false;
      return;
    }
    
    // טיימר חזרה (רק אם הוא קרוב לתחתית)
    pauseTimer.current = setTimeout(() => {
      const s = scrollRef.current;
      if (s && s.scrollHeight - s.scrollTop <= s.clientHeight + 150) {
        isAutoScrollPaused.current = false;
      }
    }, 4000); 
  }}
  onTouchStart={() => {
    isAutoScrollPaused.current = true;
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
  }}
  onTouchMove={() => {
    isAutoScrollPaused.current = true;
  }}
  onTouchEnd={() => {
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    // הטיימר החכם של 4 שניות
    pauseTimer.current = setTimeout(() => {
      const s = scrollRef.current;
      if (s) {
        // בודק אם המשתמש קרוב לאזור ההקלדה (עד 150 פיקסלים מהסוף)
        const isNearBottom = s.scrollHeight - s.scrollTop <= s.clientHeight + 150;
        if (isNearBottom) {
          isAutoScrollPaused.current = false;
        }
      }
    }, 4000); 
  }}
>
          <div className={`script-font text-xl md:text-3xl leading-[2.5] text-gray-100 whitespace-pre-wrap ${isHebrew ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && <span className="inline-block w-2.5 h-8 bg-[#d4a373] ml-1 animate-pulse align-middle" />}
          </div>
        </div>
       {/* --- שכבת סטטוס הפקה משודרגת - מותאמת אישית --- */}
        {!isTyping && displayText.length > 0 && (
          <>
            {/* גרדיאנט הגנה: מבטיח קריאות של ה-Overlay מעל טקסט התסריט */}
            <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-[#030712] via-[#030712]/90 to-transparent pointer-events-none z-20" />

            <div className={`absolute bottom-5 md:bottom-10 left-0 right-0 px-6 md:px-12 flex justify-between items-end pointer-events-none animate-in fade-in slide-in-from-bottom-4 duration-1000 z-30 ${isHebrew ? 'flex-row' : 'flex-row-reverse'}`}>
              
              {/* פינה ימנית (HE) / שמאלית (EN) - סטטוס עם נקודה ירוקה */}
              <div className={`flex flex-col leading-none ${isHebrew ? 'items-start text-right' : 'items-end text-left'}`}>
                <div className={`flex items-center gap-1.5 md:gap-2 mb-1 ${isHebrew ? 'flex-row' : 'flex-row-reverse'}`}>
                  {/* הנקודה הירוקה הפועמת */}
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                  </span>
                  <span className="text-[#d4a373] text-[13px] md:text-[16px] font-black tracking-tight drop-shadow-md">
                    {isHebrew ? 'ההפקה סיימה' : 'PRODUCTION COMPLETE'}
                  </span>
                </div>
                <span className="text-[#d4a373]/70 text-[10px] md:text-[11px] font-bold uppercase tracking-wider">
                  {isHebrew ? 'מוכן לצילום!' : 'READY FOR SHOOT!'}
                </span>
              </div>

              {/* פינה שמאלית (HE) / ימנית (EN) - מיתוג LIFESCRIPT ואייקון */}
              <div className={`flex items-center gap-2 md:gap-4 ${isHebrew ? 'flex-row' : 'flex-row-reverse'}`}>
                <div className={`flex flex-col gap-0.5 ${isHebrew ? 'items-end' : 'items-start'}`}>
                  <span className="text-[10px] md:text-[12px] font-black text-[#d4a373] tracking-[0.05em] leading-none">
                    LIFESCRIPT
                  </span>
                  <span className="text-[7px] md:text-[8px] font-medium text-[#d4a373]/50 tracking-[0.2em] leading-none uppercase">
                    PRODUCTION
                  </span>
                </div>
                <div className="relative flex items-center justify-center">
                  <img 
                    src="/icon.png" 
                    alt="App Icon" 
                    className="w-8 h-8 md:w-11 md:h-11 object-contain brightness-110 drop-shadow-[0_0_15px_rgba(212,163,115,0.3)]"
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Generate Poster Button */}
      {!isTyping && !showPoster && (
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex justify-center py-6">
          <button 
            onClick={generatePoster} 
            className="bg-[#d4a373] text-black px-16 py-6 rounded-full font-black text-xs tracking-[0.4em] shadow-2xl hover:bg-[#e9c46a] hover:scale-105 transition-all uppercase"
          >
            {isHebrew ? 'צור פוסטר לסרט' : 'GENERATE POSTER'}
          </button>
        </motion.div>
      )}

      {/* Poster Display with Correct Localization & Credits */}
      <AnimatePresence>
        {showPoster && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="relative max-w-2xl mx-auto w-full pb-2 px-4"
          >
            {/* המכולה של הפוסטר - שומרת על העיצוב המקורי שלך */}
       <div ref={posterRef} className="relative aspect-[2/3] w-full max-w-[450px] md:max-h-[75vh] mx-auto rounded-[3.5rem] md:rounded-[4.5rem] overflow-hidden bg-black shadow-4xl border border-[#d4a373]/30">            <img 
  src={posterUrl} 
  className={`w-full h-full object-cover transition-opacity duration-1000 ${posterLoading ? 'opacity-0' : 'opacity-100'}`} 
  onLoad={() => {
    // 1. קודם כל מפעילים את הסאונד (הוא מתחיל לרוץ לכיוון השנייה ה-2)
    playFlashSound();
    
    // 2. מחכים 1.8 שניות (או 2 שניות, תלוי בקובץ) ואז מפעילים את הפלאש והחשיפה
    setTimeout(() => {
      setPosterLoading(false); // החשיפה של הפוסטר תקרה בדיוק עם הקליק
      setTriggerFlash(true);   // הפלאש הלבן יקפוץ
      
      // כיבוי הפלאש אחרי שהאנימציה מסתיימת (סביב צליל הטעינה הצורם)
      setTimeout(() => setTriggerFlash(false), 2500); 
    }, 1000); // שינוי ל-1800 מילי-שניות (1.8 שניות) כדי להתאים ל"קליק" בסאונד
  }} 
  alt="Movie Poster"
/>
              {triggerFlash && <div className="flash-overlay" />}

              {!posterLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-between p-8 md:p-14 text-center z-20 pointer-events-none">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/98 via-transparent to-black/60 -z-10" />
                  <div className="w-full pt-4 md:pt-10">
                    <h1 className="text-white font-black uppercase tracking-tight text-[2.5rem] md:text-[4.5rem] leading-[0.85] italic drop-shadow-[0_10px_30px_rgba(0,0,0,1)] break-words">
                      {posterTitle}
                    </h1>
                  </div>
                  <div className="w-full flex flex-col items-center gap-6 pb-4">
                    <p className="text-[#d4a373] font-black uppercase tracking-[0.4em] text-[14px] md:text-[20px]">
                      {credits.comingSoon}
                    </p>
                    <div className="w-full border-t border-white/20 pt-6 flex flex-col gap-1.5 md:gap-2 font-bold uppercase text-white/90">
                      <p className="text-[9px] md:text-[13px] tracking-[0.15em]">{credits.line1}</p>
                      <p className="text-[7px] md:text-[10px] text-white/70 tracking-[0.15em]">{credits.line2}</p>
                      <p className="text-[7px] md:text-[10px] text-white/50 tracking-[0.15em]">{credits.line3}</p>
                      <p className="text-white/30 text-[6px] md:text-[8px] tracking-[0.3em] mt-1">{credits.copyright}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Loader המקורי והיפה שלך - ללא שינוי */}
              {posterLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#030712] z-50">
                  <div className="relative w-24 h-24">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }} className="absolute inset-0 border-[3px] border-dashed border-[#d4a373]/30 rounded-full" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                        <motion.div key={i} style={{ rotate: deg, position: 'absolute' }} className="w-full h-full flex items-start justify-center p-1">
                          <motion.div animate={{ opacity: [0.2, 1, 0.2], height: ["10%", "30%", "10%"] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }} className="w-[3px] bg-[#d4a373] rounded-full" />
                        </motion.div>
                      ))}
                    </div>
                  </div>
                  <motion.p animate={{ opacity: [0.4, 1, 0.4] }} transition={{ repeat: Infinity, duration: 1.5 }} className="mt-10 text-[#d4a373] text-[10px] font-black uppercase tracking-[0.5em] pl-[0.5em]">
                    {isHebrew ? 'מפתח פוסטר קולנועי...' : 'DEVELOPING CINEMATIC POSTER...'}
                  </motion.p>
                </div>
              )}
            </div>

           {/* כפתורי פעולה מעודנים - תמיד בשורה אחת, עיצוב פרימיום קומפקטי */}
            {/* כפתורי פעולה - שילוב מנצח של עיצוב, לוגיקה וגיבויים */}
            {!posterLoading && (
              <motion.div 
                initial={{ opacity: 0, y: 15 }} 
                animate={{ opacity: 1, y: 0 }} 
                transition={{ delay: 0.8 }}
                className="flex flex-row justify-center items-center gap-3 mt-8 pb-10 px-4"
              >
                {/* כפתור שמירה: מייצר קובץ PNG מהקומפוזיציה המלאה */}
                <motion.button 
                  whileHover={{ scale: 1.03, backgroundColor: "#e5b98f" }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleCapturePoster('download')}
                  className="group relative flex items-center gap-2 px-5 py-2.5 bg-[#d4a373] text-black rounded-full font-bold text-[9px] md:text-[10px] tracking-wider transition-all shadow-lg"
                >
                  <Download size={14} strokeWidth={2.5} />
                  <span className="uppercase">
                    {isHebrew ? 'שמור פוסטר' : 'SAVE POSTER'}
                  </span>
                </motion.button>

                {/* כפתור שיתוף: שיתוף קובץ ישיר עם Fallback חכם */}
                <motion.button 
                  whileHover={{ scale: 1.03, backgroundColor: "rgba(255,255,255,0.08)" }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => handleCapturePoster('share')}
                  className="group flex items-center gap-2 px-5 py-2.5 bg-white/5 border border-white/10 text-white/80 rounded-full font-bold text-[9px] md:text-[10px] tracking-wider transition-all hover:border-[#d4a373]/30"
                >
                  <Film size={14} className="text-[#d4a373] group-hover:rotate-12 transition-transform" />
                  <span className="uppercase">
                    {isHebrew ? 'שתף פוסטר' : 'SHARE POSTER'}
                  </span>
                </motion.button>
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .script-font { font-family: 'Courier Prime', 'Courier New', monospace; text-shadow: 0 0 1px rgba(255,255,255,0.1); }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(212, 163, 115, 0.2); border-radius: 10px; }
      `}</style>
    </div>
  );
}

export default ScriptOutput;