import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Share2, Check, Film, Volume2, VolumeX, Loader2, FastForward } from 'lucide-react';
import * as htmlToImage from 'html-to-image';
import { track } from '@vercel/analytics';
import PosterRenderer from './PosterRenderer'; 
import { detectLanguage } from '../lib/agent';

// --- פונקציות עזר מוטמעות ---
const isTextHebrew = (text) => /[\u0590-\u05FF]/.test(text);

const getCinematicTitle = (text) => {
  if (!text) return "";
  let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let titleCandidate = lines[0] || "";
  if (titleCandidate.match(/^(תסריט|script|screenplay|scene|סצנה|כותרת)[:\s-]*$/i) || 
      titleCandidate.toLowerCase().includes("screenplay") || titleCandidate.includes("תסריט")) {
     titleCandidate = lines[1] || titleCandidate;
  }
  return titleCandidate.replace(/[*#_:]/g, '').replace(/\[.*?\]/g, '').replace(/^[.\s:-]+|[.\s:-]+$/g, '').trim();
};

const translateGenre = (genre) => {
  const map = {
    'אימה': 'Horror', 'קומדיה': 'Comedy', 'דרמה': 'Drama', 'אקשן': 'Action',
    'פעולה': 'Action', 'מדע בדיוני': 'Sci-Fi', 'מתח': 'Thriller', 
    'רומנטיקה': 'Romance', 'קומיקס': 'Comic',
    'horror': 'Horror', 'comedy': 'Comedy', 'drama': 'Drama', 'action': 'Action',
    'sci-fi': 'Sci-Fi', 'thriller': 'Thriller', 'romance': 'Romance', 'comic': 'Comic'
  };
  const normalized = genre?.toLowerCase().trim();
  return map[normalized] || genre || 'Cinematic';
};

function ScriptOutput({ script, lang, genre, setIsTypingGlobal, producerName }) {
  const finalProducerName = producerName || (lang === 'he' ? 'אורח' : 'GUEST');
  
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
  const [posterError, setPosterError] = useState('');

  // --- Refs ---
  const scrollRef = useRef(null);
  const posterRef = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const pauseTimer = useRef(null);
  const timerRef = useRef(null);
  const audioContext = useRef(null);
  const audioBuffer = useRef(null);
  const flashBuffer = useRef(null);
  const isMutedRef = useRef(false);

  const isHebrew = useMemo(() => isTextHebrew(script || ''), [script]);
  const posterTitle = useMemo(() => getCinematicTitle(cleanScript), [cleanScript]);

  const posterLoadingMessages = useMemo(() => isHebrew ? [
    "מנתח את האסתטיקה של התסריט...", "מלהק כוכבים לפוסטר הרשמי...", "מעצב את התאורה בסט הצילומים...",
    "בונה את הקומפוזיציה הויזואלית...", "מלטש את הצבעים והפילטרים...", "מרנדר את הפוסטר ב-4K...",
    "תולה את הפוסטר בבכורה העולמית..."
  ] : [
    "Analyzing script aesthetics...", "Casting stars for the poster...", "Setting the cinematic lights...",
    "Building visual composition...", "Color grading and filtering...", "Rendering poster in 4K...",
    "Hanging the poster for the premiere..."
  ], [isHebrew]);

  const credits = useMemo(() => {
    const year = new Date().getFullYear();
    return isHebrew ? {
      comingSoon: 'בקרוב בקולנוע',
      line1: `בימוי: ${finalProducerName} • הפקה: סטודיו LIFESCRIPT`,
      line2: 'צילום: מעבדת AI • עיצוב אמנותי: הוליווד דיגיטלית • ליהוק: וירטואלי',
      line3: 'מוזיקה: THE MASTER • עריכה: סוכן 2005 • אפקטים: מנוע קולנועי',
      copyright: `© ${year} LIFESCRIPT STUDIO • כל הזכויות שמורות`
    } : {
      comingSoon: 'COMING SOON',
      line1: `DIRECTED BY ${finalProducerName.toUpperCase()} • PRODUCTION: LIFESCRIPT STUDIO`,
      line2: 'CINEMATOGRAPHY: AI LAB • ART DIRECTION: DIGITAL HOLLYWOOD • CASTING: VIRTUAL',
      line3: 'MUSIC: THE MASTER • EDITING: AGENT 2005 • VFX: CINEMATIC ENGINE',
      copyright: `© ${year} LIFESCRIPT STUDIO • ALL RIGHTS RESERVED`
    };
  }, [isHebrew, finalProducerName]);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    let interval;
    if (posterLoading) {
      interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % posterLoadingMessages.length);
      }, 2800);
    } else { setLoadingMessageIndex(0); }
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

        // וידוא שהקונטקסט לא נמצא במצב suspended מיד לאחר הטעינה
        // זה מבטיח שהסאונד יתחיל לעבוד גם ללא אינטראקציית משתמש ראשונית
        if (audioContext.current?.state === 'suspended') {
          // ננסה לחדש את הקונטקסט. אם נכשל, נתפוס את השגיאה ונמשיך.
          await audioContext.current.resume().catch(e => console.warn("Failed to resume AudioContext on init:", e));
        }

        // פונקציית unlock שמתעוררת בלחיצה הראשונה של המשתמש באתר (כגיבוי)
        // נשמור את ה‑listeners האלה למקרה שה‑resume הראשוני נכשל
        const unlock = () => {
          if (audioContext.current?.state === 'suspended') {
            audioContext.current.resume().catch(e => console.warn("Failed to resume AudioContext on user interaction:", e));
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

 const playSound = useCallback(() => {
  // בדיקה שהבאפר קיים והמערכת לא במיוט
  if (isMutedRef.current || !audioBuffer.current || !audioContext.current) return;

  // וידוא שהקונטקסט פתוח לפני יצירת ה‑source
  if (audioContext.current?.state === 'suspended') {
    audioContext.current.resume().catch(() => {});
  }

  const source = audioContext.current.createBufferSource();
  source.buffer = audioBuffer.current;
  const gainNode = audioContext.current.createGain();

  // ווליום אופטימלי להקלדה
  gainNode.gain.setValueAtTime(0.6, audioContext.current.currentTime);

  source.connect(gainNode);
  gainNode.connect(audioContext.current.destination);
  source.start(0);
}, []);

const playFlashSound = useCallback(() => {
  if (isMutedRef.current || !flashBuffer.current || !audioContext.current) return;
  
  // וידוא שהקונטקסט פתוח לפני יצירת ה‑source
  if (audioContext.current.state === 'suspended') {
    audioContext.current.resume().catch(() => {});
  }

  const source = audioContext.current.createBufferSource();
  source.buffer = flashBuffer.current;
  
  const gainNode = audioContext.current.createGain();
  const now = audioContext.current.currentTime;
  
  // הגדרת ווליום: קליק חזק בשיא, ואז דעיכה איטית ששומרת על ה"זנב" של הסאונד
  gainNode.gain.setValueAtTime(1.0, now); 
  // דעיכה ל-0.1 (לא לאפס!) לאורך 2.5 שניות כדי שהאפקט ימשיך להישמע
  gainNode.gain.linearRampToValueAtTime(0.1, now + 2.5); 
  
  source.connect(gainNode);
  gainNode.connect(audioContext.current.destination);
  
  // התיקון: מתחילים מהשנייה ה-0.5 (הקליק) ומנגנים עד הסוף (סה"כ נשארות 2.5 שניות)
  source.start(now, 0.5); 
}, [flashBuffer.current]);

  // --- Script Processing ---
  useEffect(() => {
    if (!script) return;
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

  // --- Typing Engine ---
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

  const currentText = cleanScript.substring(0, i + 1);
  setDisplayText(currentText);

  // הפעלת סאונד: כל תו שני שאינו רווח
  if (cleanScript[i] && !/\s/.test(cleanScript[i]) && i % 2 === 0) {
    playSound();
  }

  if (i > 15 && scrollRef.current && !isAutoScrollPaused.current) {
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }

  i++;
  timerRef.current = setTimeout(typeChar, 40);
};
    typeChar();
    return () => clearTimeout(timerRef.current);
  }, [cleanScript]);

  // --- Poster Generation ---
  const generatePoster = async () => { 
    setPosterLoading(true);
    setPosterError('');
    setShowPoster(true);
    const genreTag = translateGenre(genre);
    const prompt = `A textless movie poster style, depicting: ${visualPrompt}. Genre: ${genreTag}. High budget Hollywood production, epic scale, 8k, ultra-detailed, sharp focus. (NO TEXT)`;
    
    try {
      const response = await fetch('/api/generate-poster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, genre, lang }), 
      });
      const data = await response.json();
      if (response.status === 429) {
        setPosterError(lang === 'he' ? "🎬 המכסה היומית נוצלה - נתראה מחר בבכורה!" : "🎬 Daily quota reached!");
        setPosterLoading(false);
        return;
      }
      if (data.success) {
        setPosterUrl(data.imageUrl);
      } else { throw new Error(data.message); }
    } catch (error) {
      setPosterUrl(`https://pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${Math.random()}&model=flux`);
    }
  };

  const handleCapturePoster = async (action) => {
    if (!posterRef.current || !posterUrl) return;
    
    // הוספה: מעקב אנליטיקס (אם לא מבוצע כבר ב‑onClick)
    // track(action === 'download' ? 'Poster Downloaded' : 'Poster Shared', {
    //   genre: genre,
    //   language: lang,
    //   title: posterTitle
    // });
    // if (typeof window !== 'undefined' && window.gtag) {
    //   window.gtag('event', 'content_export', {
    //     method: action, // 'download' או 'share'
    //     genre: genre,
    //     title: posterTitle
    //   });
    // }

    try {
      const img = posterRef.current.querySelector('img');
      if (img) await img.decode().catch(() => {});
      
      await new Promise(r => setTimeout(r, 400));

      // מדידה מדויקת ועיגול מספרים למניעת חיתוך ברמת הפיקסל
      const rect = posterRef.current.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);

      // הגדרות משותפות לשני הצילומים כדי למנוע שגיאות כפולות
      const sharedOptions = {
        width: width,
        height: height,
        quality: 0.95,
        pixelRatio: 2,
        skipFonts: true,
        fontEmbedCSS: '',
        cacheBust: false,
        // ה-Filter כאן ימנע את הודעות השגיאה בטרמינל
        filter: (node) => {
          const tagName = node.tagName ? node.tagName.toUpperCase() : '';
          if (tagName === 'LINK' || tagName === 'STYLE') {
            // חוסם גישה למשאבים חיצוניים שגורמים ל-SecurityError
            if (node.href && !node.href.includes(window.location.hostname)) return false;
          }
          return true;
        },
        style: {
          transform: 'scale(1)',
          margin: '0',        // מבטל את ה-mx-auto שגורם לחיתוך
          padding: '0',
          left: '0',
          top: '0',
          borderRadius: '3.5rem', // שומר על היוקרה בתוצאה הסופית
          overflow: 'visible'
        }
      };

      // --- צילום 1: חימום (כעת עם ה-Filter כדי למנוע את השגיאה הראשונה) ---
      await htmlToImage.toPng(posterRef.current, { ...sharedOptions, quality: 0.1 });
      
      // --- צילום 2: האמיתי ---
      const dataUrl = await htmlToImage.toPng(posterRef.current, sharedOptions);
      
      if (action === 'download') {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `poster-${posterTitle.replace(/\s+/g, '-') || 'movie-poster'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else if (action === 'share') {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], 'movie-poster.png', { type: 'image/png' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
           try {
            await navigator.share({ files: [file], title: posterTitle || 'הפוסטר שלי' });
          } catch (shareErr) {
            if (shareErr.name !== 'AbortError') throw shareErr;
            // אם זה AbortError - אנחנו פשוט לא עושים כלום, המשתמש סגר את החלונית
          }
       } else {
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = 'poster.png';
          link.click();
        }
      }
    } catch (err) {
      console.error("Critical Capture Error:", err);
      if (posterUrl) window.open(posterUrl, '_blank');
    }
  };

  return (
    <div className="space-y-6 w-full max-w-[100vw]">
      {/* Toolbar */}
      <div className="flex justify-between items-center px-6 h-14">
        <div className="flex items-center gap-2">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase text-[10px] tracking-widest italic">LIFESCRIPT STUDIO</h2>
        </div>
        <div className="flex items-center gap-2">
          {isTyping && (
            <button onClick={() => { clearTimeout(timerRef.current); setDisplayText(cleanScript); setIsTyping(false); setIsTypingGlobal?.(false); }} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a373]/20 border border-[#d4a373]/40 rounded-full text-[10px] text-[#d4a373] font-bold">
              <FastForward size={12} /> {isHebrew ? 'דלג' : 'SKIP'}
            </button>
          )}
          <button onClick={() => setIsMuted(!isMuted)} className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
            {isMuted ? <VolumeX size={18} className="text-red-500" /> : <Volume2 size={18} className="text-[#d4a373]" />}
          </button>
          {/* כפתור הורדת התסריט - הוחזר ותוקן */}
          <button 
            onClick={() => {
              const blob = new Blob([cleanScript], { type: 'text/plain;charset=utf-8' });
              const url = URL.createObjectURL(blob);
              const link = document.createElement('a');
              link.href = url;
              link.download = `${posterTitle || 'script'}.txt`;
              document.body.appendChild(link); // חשוב: הוסף ל‑DOM לפני הלחיצה
              link.click();
              // השהה את ביטול ה‑URL והסרת הקישור כדי לוודא שההורדה מתחילה
              setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              }, 200); // 200ms אמורים להספיק לדפדפן להתחיל את ההורדה
            }} 
            className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-[#d4a373] transition-colors"
          >
            <Download size={18} />
          </button>
          {/* כפתור העתקת התסריט - הוחזר */}
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

      {/* Script View */}
      <div className="relative rounded-[3.5rem] overflow-hidden bg-[#030712]/90 border border-white/5 mx-2 md:mx-4">
        <div 
          ref={scrollRef} 
          className="h-[500px] md:h-[650px] overflow-y-auto p-10 md:p-20 custom-scrollbar relative"
          style={{ scrollBehavior: 'smooth' }}
          onWheel={() => {
            isAutoScrollPaused.current = true;
            if (pauseTimer.current) clearTimeout(pauseTimer.current);
            pauseTimer.current = setTimeout(() => { isAutoScrollPaused.current = false; }, 4000);
          }}
        >
          <div className={`script-font text-xl md:text-3xl leading-[2.5] text-gray-100 whitespace-pre-wrap pb-40 ${isHebrew ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && <span className="inline-block w-2.5 h-8 bg-[#d4a373] ml-1 animate-pulse align-middle" />}
          </div>
        </div>
        {!isTyping && displayText.length > 0 && (
          <div className="absolute bottom-5 left-0 right-0 px-6 flex justify-between items-end z-30">
             <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse"></span>
                <span className="text-[#d4a373] text-[12px] font-bold">{isHebrew ? 'ההפקה סיימה' : 'PRODUCTION COMPLETE'}</span>
             </div>
             <img src="/icon.png" className="w-8 h-8 object-contain opacity-50" alt="icon" />
          </div>
        )}
      </div>

      {!isTyping && !showPoster && (
        <div className="flex justify-center py-6 px-4">
          <button onClick={generatePoster} disabled={posterLoading} className="w-full bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black py-4 rounded-2xl">
            {posterLoading ? <Loader2 className="animate-spin mx-auto" /> : (isHebrew ? 'צור פוסטר קולנועי' : 'GENERATE MOVIE POSTER')}
          </button>
        </div>
      )}

      <AnimatePresence>
        {showPoster && (
          <div className="mt-8">
           <PosterRenderer
  posterUrl={posterUrl}
  posterLoading={posterLoading}
  posterError={posterError}
  setPosterError={setPosterError}
  setPosterUrl={setPosterUrl}
  triggerFlash={triggerFlash}
  posterRef={posterRef}
  posterTitle={posterTitle}
  credits={credits}
  handleCapturePoster={handleCapturePoster}
  lang={lang}
  genre={genre}
  posterLoadingMessages={posterLoadingMessages[loadingMessageIndex]}
  setTriggerFlash={setTriggerFlash}
  setPosterLoading={setPosterLoading}
  playFlashSound={playFlashSound}   // <-- הוספת ה‑prop
/>
          </div>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .script-font { font-family: 'Courier Prime', 'Courier New', monospace; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(212, 163, 115, 0.2); border-radius: 10px; }
      `}</style>
    </div>
  );
}

export default ScriptOutput;