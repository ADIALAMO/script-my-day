import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Share2, Check, Film, Volume2, VolumeX, Loader2, FastForward } from 'lucide-react';
import html2canvas from 'html2canvas';
import * as htmlToImage from 'html-to-image'; // וודא שזה מופיע בראש הקובץ

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
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);

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

  // --- לוגיקת הודעות טעינה לפוסטר ---
  // חשוב: זיהוי השפה מתבצע כאן בתוך הקומפוננט
  const isHebrew = isTextHebrew(cleanScript);
  const posterTitle = getCinematicTitle(cleanScript);
  const posterLoadingMessages = isHebrew ? [
    "מנתח את האסתטיקה של התסריט...",
    "מלהק כוכבים לפוסטר הרשמי...",
    "מעצב את התאורה בסט הצילומים...",
    "בונה את הקומפוזיציה הויזואלית...",
    "מלטש את הצבעים והפילטרים...",
    "מרנדר את הפוסטר ב-4K...",
    "תולה את הפוסטר בבכורה העולמית..."
  ] : [
    "Analyzing script aesthetics...",
    "Casting stars for the poster...",
    "Setting the cinematic lights...",
    "Building visual composition...",
    "Color grading and filtering...",
    "Rendering poster in 4K...",
    "Hanging the poster for the premiere..."
  ];

  // סנכרון Ref להשתקה
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // טיימר הודעות הטעינה של הפוסטר
  useEffect(() => {
    let interval;
    if (posterLoading) {
      interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % posterLoadingMessages.length);
      }, 2800);
    } else {
      setLoadingMessageIndex(0);
    }
    return () => clearInterval(interval);
  }, [posterLoading, posterLoadingMessages.length]);

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
  if (isMutedRef.current || !flashBuffer.current || !audioContext.current) return;
  
  if (audioContext.current.state === 'suspended') {
    audioContext.current.resume();
  }

  const source = audioContext.current.createBufferSource();
  source.buffer = flashBuffer.current;
  
  const gainNode = audioContext.current.createGain();
  const now = audioContext.current.currentTime;
  
  // הגדרת ווליום: קליק חזק בשיא, ואז דעיכה איטית ששומרת על ה"זנב" של הסאונד
  gainNode.gain.setValueAtTime(0.8, now); 
  // דעיכה ל-0.1 (לא לאפס!) לאורך 2.5 שניות כדי שהאפקט ימשיך להישמע
  gainNode.gain.linearRampToValueAtTime(0.1, now + 2.5); 
  
  source.connect(gainNode);
  gainNode.connect(audioContext.current.destination);
  
  // התיקון: מתחילים מהשנייה ה-0.5 (הקליק) ומנגנים עד הסוף (סה"כ נשארות 2.5 שניות)
  source.start(now, 0.5); 
};
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
      
     if (i > 15 && scrollRef.current && !isAutoScrollPaused.current) {
  const container = scrollRef.current;
  // במקום container.scrollTop = container.scrollHeight;
  container.scrollTo({
    top: container.scrollHeight,
    behavior: 'smooth'
  });
}
      
      i++;
      // מהירות 40ms: מהירה מספיק למקצוענות, איטית מספיק ליציבות סאונד
      timerRef.current = setTimeout(typeChar, 40);
    };
    
    typeChar();
    return () => clearTimeout(timerRef.current);
  }, [cleanScript]);
 // --- יצירת פוסטר (Backend Integration + Fallback) ---
  const generatePoster = async () => { // שינוי 1: הוספנו async
    setPosterLoading(true);
    setShowPoster(true);
    const genreTag = translateGenre(genre);
    const seed = Math.floor(Math.random() * 999999);
    
    const cleanVisual = visualPrompt.replace(/[^\w\s\u0590-\u05FF,]/gi, '').slice(0, 300);
    
    // הפרומפט המרכזי - הוספנו TEXTLESS חזק בהתחלה ובסוף
    const prompt = `A textless movie poster style, depicting: ${cleanVisual}. Genre: ${genreTag}. High budget Hollywood production, epic scale, 8k, ultra-detailed, sharp focus, masterpiece composition. (NO TEXT, NO LETTERS, NO WORDS)`;
    
    // רשימת ה"אסור" - הוספנו דגש על מניעת כותרות
    const negative = `text, letters, title, words, alphabet, typography, credits, watermark, chinese characters, kanji, japanese, russian, cyrillic, script, signature, logos, symbols, blur, distortion, low quality`;
      
    try {
      const response = await fetch('/api/generate-poster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt }), 
      });

      if (!response.ok) throw new Error('Backend failed');

      const data = await response.json();
      
      if (data.success && data.imageUrl) {
        // מנקים שאריות של כתובות זמניות אם היו
        if (posterUrl && posterUrl.startsWith('blob:')) {
          URL.revokeObjectURL(posterUrl);
        }
        
        // מעדכנים את ה-URL למחרוזת ה-Base64 שקיבלנו מהשרת
        setPosterUrl(data.imageUrl);
        console.log(`✅ Poster received via ${data.provider}`);
      } else {
        throw new Error("Invalid response format");
      }

    } catch (error) {
      console.warn("Fallback to Pollinations Direct:", error);
      // בגיבוי אנחנו משתמשים ב-URL ישיר כי אין לנו Base64
      const directUrl = `https://pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${seed}&model=flux&nologo=true`;    
      setPosterUrl(directUrl);
    }
  };

const handleCapturePoster = async (action) => {
  if (!posterRef.current || !posterUrl) return;

  try {
    // 1. הגדרות "קלות" למובייל כדי למנוע קריסת זיכרון
    const options = {
      quality: 0.9,
      pixelRatio: 1.5, // איזון מושלם בין חדות לביצועי מובייל
      skipFonts: true,
      fontEmbedCSS: '',
      cacheBust: true,
      style: {
        transform: 'scale(1)',
        borderRadius: '0',
      }
    };

    // 2. יצירת ה-DataURL
    const dataUrl = await htmlToImage.toPng(posterRef.current, options);
    
    // 3. טיפול ספציפי למובייל לפי סוג הפעולה
    if (action === 'download') {
      // ב-Production במובייל, לינק ישיר לפעמים נחסם. נשתמש בטריק ה-Click הישיר:
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = `poster-${Date.now()}.png`;
      
      // חייבים להוסיף ל-DOM במובייל כדי שהקליק יירשם
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } else if (action === 'share') {
      // המרה ל-Blob
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], 'movie-poster.png', { type: 'image/png' });

      // שיתוף במובייל דורש navigator.canShare
      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: posterTitle || 'הפוסטר שלי',
          });
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') return;
          // Fallback אם השיתוף נכשל באמצע
          window.open(dataUrl, '_blank');
        }
      } else {
        // אם המכשיר לא תומך בשיתוף קבצים (כמו דפדפנים מסוימים בתוך אפליקציות)
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = 'poster.png';
        link.click();
      }
    }
  } catch (err) {
    console.error("Mobile Capture Error:", err);
    // מוצא אחרון למובייל: פתיחת התמונה בטאב חדש שבו המשתמש יכול ללחוץ לחיצה ארוכה ולשמור
    if (posterUrl) window.open(posterUrl, '_blank');
  }
};
  // --- גלילה עדינה וקולנועית לתחילת התסריט ---
  useEffect(() => {
    if (isTyping && scrollRef.current) {
      const timer = setTimeout(() => {
        // חישוב המיקום המדויק של התסריט ביחס לראש הדף
        const elementTop = scrollRef.current.getBoundingClientRect().top + window.pageYOffset;
        const offset = 80; // מרווח נשימה מלמעלה

        window.scrollTo({
          top: elementTop - offset,
          behavior: 'smooth'
        });
      }, 150); 
      
      return () => clearTimeout(timer);
    }
  }, [isTyping]);
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
<div className="space-y-6 w-full max-w-[100vw]" style={{ contain: 'paint layout' }}>      
      {/* Toolbar - תיקון חיתוך כותרת */}
      <div className="flex justify-between items-center px-6 h-14">
        <div className="flex items-center gap-2">
          <Film size={18} className="text-[#d4a373]" />
          <h2 
            className="text-[#d4a373] font-black uppercase text-[10px] tracking-widest italic"
            style={{ padding: '0 5px' }} // זה הפתרון לחיתוך האותיות במובייל
          >
            LIFESCRIPT STUDIO
          </h2>
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
  // התיקון כאן: מונע מהדפדפן לקפוץ לסוף הדף כשהתוכן גדל בפתאומיות
    style={{ 
            overflowAnchor: 'none',
            scrollBehavior: 'smooth' // <--- כאן הוספנו את הגלילה החלקה
          }}
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
          <div className={`script-font text-xl md:text-3xl leading-[2.5] text-gray-100 whitespace-pre-wrap pb-40 ${isHebrew ? 'text-right' : 'text-left'}`}>
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
  disabled={posterLoading}
  className="relative w-full group overflow-hidden bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black py-4 px-6 rounded-2xl shadow-[0_10px_40px_rgba(212,163,115,0.3)] transition-all duration-500 hover:scale-[1.02] active:scale-[0.98] disabled:opacity-70 mt-8"
>
  {/* אפקט האור שעובר על הכפתור */}
  <motion.div 
    animate={{ x: ['-100%', '100%'] }} 
    transition={{ repeat: Infinity, duration: 3, ease: "linear" }}
    className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent skew-x-[35deg] pointer-events-none" 
  />
  
  <div className="flex items-center justify-center gap-3 relative z-10">
    {posterLoading ? (
      <>
        <Loader2 className="w-5 h-5 animate-spin" />
        <span className="text-sm md:text-lg tracking-tighter uppercase italic">
          {lang === 'he' ? 'יוצר חזון...' : 'CREATING VISION...'}
        </span>
      </>
    ) : (
      <>
        <Film className="w-5 h-5" />
        <span 
          className="text-[14px] xs:text-[15px] md:text-xl tracking-tighter uppercase italic whitespace-nowrap"
          style={{ letterSpacing: '-0.02em' }}
        >
          {lang === 'he' ? 'צור פוסטר קולנועי' : 'GENERATE MOVIE POSTER'}
        </span>
      </>
    )}
  </div>
</button>
        </motion.div>
      )}

    {/* Poster Display Section */}
      <AnimatePresence>
        {showPoster && (
          <motion.div 
            initial={{ opacity: 0, y: 50 }} 
            animate={{ opacity: 1, y: 0 }} 
            className="relative max-w-2xl mx-auto w-full pb-2 px-4 z-10"
          >
           {/* מכולת הפוסטר */}
            <div ref={posterRef} className="relative aspect-[2/3] w-full max-w-[450px] mx-auto rounded-[3.5rem] md:rounded-[4.5rem] overflow-hidden bg-[#030712] shadow-4xl border border-[#d4a373]/30">
              
              {/* 1. התמונה - במיקום מוחלט */}
              {posterUrl && (
                <img 
                  src={posterUrl} 
                  className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${posterLoading ? 'opacity-0' : 'opacity-100'}`} 
                  onLoad={() => {
  if (audioContext.current?.state === 'suspended') {
    audioContext.current.resume();
  }

  // מפעילים את הסאונד (שכעת מתחיל ישר מהקליק ב-1.5s)
  playFlashSound();

  // השהיה מינימלית ביותר לסנכרון עין-אוזן
  setTimeout(() => {
    window.requestAnimationFrame(() => {
      setTriggerFlash(true);
      setPosterLoading(false);
      
      // פלאש קצר ומהיר (0.5 שניות) לאפקט מקצועי
      setTimeout(() => setTriggerFlash(false), 500);
    });
  }, 50); 
}}
                  onError={() => setPosterLoading(false)}
                  alt="Movie Poster"
                />
              )}

              {/* 2. הפלאש הלבן - Z-INDEX 100 (מעל הכל) */}
              {triggerFlash && (
                <motion.div 
                  initial={{ opacity: 1 }}
                  animate={{ opacity: 0 }}
                  transition={{ duration: 0.8 }}
                  className="absolute inset-0 bg-white z-[100] pointer-events-none"
                />
              )}
              
              {/* שמירה על פונקציית ה-flash-overlay המקורית שלך לגיבוי */}
              {triggerFlash && <div className="flash-overlay" style={{ zIndex: 99 }} />}

              {/* 3. Loader עתידני - Z-INDEX 50 (מסתיר את התמונה עד שהיא מוכנה) */}
              {posterLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#030712] z-[50] px-6 text-center">
                  <div className="relative w-20 h-20 mb-10">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }} className="absolute inset-0 border-[3px] border-dashed border-[#d4a373]/30 rounded-full" />
                    <div className="absolute inset-0 flex items-center justify-center">
                      {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                        <motion.div key={i} style={{ rotate: deg, position: 'absolute' }} className="w-full h-full flex items-start justify-center p-1">
                          <motion.div animate={{ opacity: [0.2, 1, 0.2], height: ["10%", "30%", "10%"] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }} className="w-[3px] bg-[#d4a373] rounded-full" />
                        </motion.div>
                      ))}
                    </div>
                  </div>

                  <div className="h-6">
                    <AnimatePresence mode="wait">
                      <motion.p
                        key={loadingMessageIndex}
                        initial={{ y: 15, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: -15, opacity: 0 }}
                        className="text-[#d4a373] text-[10px] font-black uppercase tracking-[0.4em] whitespace-nowrap"
                      >
                        {posterLoadingMessages[loadingMessageIndex]}
                      </motion.p>
                    </AnimatePresence>
                  </div>
                </div>
              )}

             {/* 4. שכבת הטקסט (Overlay) - תיקון כירורגי למסך מלא ללא פגיעה בפונקציות */}
{!posterLoading && posterUrl && (
  <div className="absolute inset-0 flex flex-col items-center justify-between z-20 pointer-events-none animate-in fade-in duration-1000">
    
    {/* גרדיאנט הגנה על הטקסט - מותאם לרינדור קנבס נקי */}
    <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-transparent to-black/50 -z-10" />
    
    {/* כותרת הסרט - שימוש ב-pt מבוסס אחוזים למניעת חיתוך במסך מלא */}
    <div className="w-full pt-[12%] px-6 text-center">
      <h1 
        className="text-white font-black uppercase italic drop-shadow-[0_10px_30px_rgba(0,0,0,1)] break-words mx-auto"
        style={{ 
          fontSize: 'clamp(1.1rem, 6vw, 2.8rem)', 
          lineHeight: '1.05',
          letterSpacing: '-0.02em',
          maxWidth: '90%'
        }}
      >
        {posterTitle}
      </h1>
      {/* פס עיצובי יוקרתי - נשמר */}
      <div className="h-[1px] w-1/4 mx-auto mt-4 bg-gradient-to-r from-transparent via-[#d4a373]/50 to-transparent" />
    </div>

    {/* בלוק הקרדיטים התחתון - ממוקם ב-pb אחוזים כדי להישאר מעל הקצה בכל רזולוציה */}
    <div className="w-full flex flex-col items-center gap-2 md:gap-4 pb-[8%] px-6 text-center">
      
      <p className="text-[#d4a373] font-black uppercase tracking-[0.3em] text-[9px] md:text-[16px] drop-shadow-md">
        {credits.comingSoon}
      </p>
      
      <div className="w-full border-t border-white/20 pt-3 md:pt-5 flex flex-col gap-1 font-bold uppercase text-white/90">
        <p className="text-[7px] md:text-[11px] tracking-[0.1em] opacity-95">
          {credits.line1}
        </p>
        
        <div className="opacity-70 flex flex-col gap-0.5">
          <p className="text-[6px] md:text-[9px] tracking-[0.1em]">
            {credits.line2}
          </p>
          <p className="text-[6px] md:text-[9px] tracking-[0.1em]">
            {credits.line3}
          </p>
        </div>

        {/* לינק אקטיבי - שמרנו על ה-pointer-events-auto כדי שיהיה לחיץ */}
        <div className="mt-2 flex justify-center pointer-events-auto">
          <a 
            href="https://my-life-script.vercel.app/"
            target="_blank"
            rel="noopener noreferrer"
            className="cursor-pointer no-underline group"
          >
            <p className="text-[#d4a373]/40 text-[5px] md:text-[8px] tracking-[0.4em] font-black group-hover:text-[#d4a373] transition-all duration-300 italic">
              MY-LIFE-SCRIPT.VERCEL.APP
            </p>
          </a>
        </div>
      </div>
    </div>
  </div>
)}
            </div>

            {/* כפתורי הפעולה היוקרתיים (זה הזהב שביקשת לשמור) */}
            {!posterLoading && (
              <motion.div 
                initial={{ opacity: 0, y: 15 }} 
                animate={{ opacity: 1, y: 0 }} 
                className="flex flex-row items-center justify-center gap-3 mt-8 pb-10 w-full max-w-[380px] mx-auto px-4"
              >
                <motion.button 
                  whileHover={{ scale: 1.02, backgroundColor: "#d4a373", color: "#000" }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => handleCapturePoster('download')}
                  className="relative flex-[2] flex items-center justify-center gap-2 h-11 bg-[#1a1c20] border border-white/20 text-gray-300 rounded-lg transition-all duration-500 overflow-hidden"
                >
                  {/* אפקט הברק (Shiny Sweep) */}
                  <motion.div animate={{ left: ['-100%', '200%'] }} transition={{ repeat: Infinity, duration: 3, ease: "linear" }} className="absolute top-0 bottom-0 w-12 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[35deg]" />
                  <Download size={16} strokeWidth={2.5} />
                  <span className="font-bold text-[10px] tracking-[0.2em] uppercase">{isHebrew ? 'שמור פוסטר' : 'SAVE POSTER'}</span>
                </motion.button>

                <motion.button 
                  whileHover={{ scale: 1.05, borderColor: "#d4a373", color: "#d4a373" }}
                  whileTap={{ scale: 0.9 }}
                  onClick={() => handleCapturePoster('share')}
                  className="relative w-11 h-11 flex items-center justify-center bg-[#1a1c20] border border-white/10 text-gray-400 rounded-lg transition-all duration-500"
                >
                  <div className="relative">
                    <Share2 size={18} strokeWidth={2} />
                    <motion.div animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0 blur-[4px] text-[#d4a373]">
                      <Share2 size={18} strokeWidth={2} />
                    </motion.div>
                  </div>
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