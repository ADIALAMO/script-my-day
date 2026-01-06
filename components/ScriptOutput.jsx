import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Check, Film, Volume2, VolumeX, Loader2, FastForward } from 'lucide-react';

// --- לוגיקה עוטפת: ניקוי כותרות ותרגום ז'אנרים ---
// הוספת פונקציית העזר לזיהוי שפה
const isTextHebrew = (text) => /[\u0590-\u05FF]/.test(text);

const getCinematicTitle = (text) => {
  if (!text) return "";
  let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let titleCandidate = lines[0] || "";
  // ניקוי שאריות Markdown וסמלים
  if (titleCandidate.toLowerCase().includes("screenplay") || titleCandidate.includes("תסריט")) {
     titleCandidate = lines[1] || titleCandidate;
  }
  return titleCandidate.replace(/[*#_:]/g, '').replace(/\[.*?\]/g, '').trim();
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

  // --- Refs ---
  const scrollRef = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const pauseTimer = useRef(null);
  const timerRef = useRef(null);
  const audioContext = useRef(null);
  const audioBuffer = useRef(null);
  const isMutedRef = useRef(isMuted);

  // סנכרון Ref להשתקה
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // --- מנוע סאונד ---
  useEffect(() => {
    const initAudio = async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext.current = new AudioCtx();
        const response = await fetch('/audio/typewriter.m4a');
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer.current = await audioContext.current.decodeAudioData(arrayBuffer);
      } catch (e) { console.error("Audio engine failed"); }
    };
    initAudio();
  }, []);

  const playSound = () => {
    if (isMutedRef.current || !audioBuffer.current || !audioContext.current) return;
    if (audioContext.current.state === 'suspended') audioContext.current.resume();
    const source = audioContext.current.createBufferSource();
    source.buffer = audioBuffer.current;
    const gainNode = audioContext.current.createGain();
    gainNode.gain.value = 0.15;
    source.connect(gainNode);
    gainNode.connect(audioContext.current.destination);
    source.start(0);
  };

  // --- עיבוד טקסט וחילוץ הנחיות ויזואליות ---
  useEffect(() => {
    if (!script) return;
    const marker = "[image:";
    const markerIndex = script.toLowerCase().indexOf(marker);
    if (markerIndex !== -1) {
      setCleanScript(script.substring(0, markerIndex).trim());
      const endBracketIndex = script.indexOf("]", markerIndex);
      setVisualPrompt(script.substring(markerIndex + marker.length, endBracketIndex).trim());
    } else {
      setCleanScript(script);
      setVisualPrompt("Cinematic masterpiece, dramatic lighting");
    }
    setDisplayText('');
    setShowPoster(false);
  }, [script]);

  // --- מנוע הקלדה רספונסיבי ---
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
      if (cleanScript[i] && !/\s/.test(cleanScript[i])) playSound();
      
      if (scrollRef.current && !isAutoScrollPaused.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' });
      }
      
      i++;
      timerRef.current = setTimeout(typeChar, 30);
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
    const prompt = `Official movie key visual, ${genreTag} style, ${cleanVisual}. High budget, ultra-realistic, 8k, cinematic composition, centered subject. NEGATIVE PROMPT: text, letters, typography, credits, poster borders, watermark, chinese characters, kanji, blur, distortion.`;
    
    const directUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1536&seed=${seed}&nologo=true`;
    setPosterUrl(`/api/proxy-image?url=${encodeURIComponent(directUrl)}`);
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
          className="h-[500px] md:h-[650px] overflow-y-auto p-10 md:p-20 custom-scrollbar relative"
          onWheel={() => {
            isAutoScrollPaused.current = true;
            if (pauseTimer.current) clearTimeout(pauseTimer.current);
            pauseTimer.current = setTimeout(() => { isAutoScrollPaused.current = false; }, 3000);
          }}
        >
          <div className={`script-font text-xl md:text-3xl leading-[2.5] text-gray-100 whitespace-pre-wrap ${isHebrew ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && <span className="inline-block w-2.5 h-8 bg-[#d4a373] ml-1 animate-pulse align-middle" />}
          </div>
        </div>
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
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className="relative max-w-2xl mx-auto w-full pb-24 px-4 overflow-hidden">
            <div className="relative aspect-[2/3] w-full rounded-[3.5rem] md:rounded-[4.5rem] overflow-hidden bg-black shadow-4xl border border-[#d4a373]/30">
              {/* Image Layer - Clean (No Text) */}
              <img 
                src={posterUrl} 
                className={`w-full h-full object-cover transition-opacity duration-1000 ${posterLoading ? 'opacity-0' : 'opacity-100'}`} 
                onLoad={() => setPosterLoading(false)} 
              />
              
              {!posterLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-between p-8 md:p-14 text-center z-20 pointer-events-none">
                  {/* Dark Gradient Overlay for Readability */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/98 via-transparent to-black/60 -z-10" />
                  
                  {/* Title Area */}
                  <div className="w-full pt-4 md:pt-10">
                    <h1 className="text-white font-black uppercase tracking-tight text-[2.5rem] md:text-[4.5rem] leading-[0.85] italic drop-shadow-[0_10px_30px_rgba(0,0,0,1)] break-words">
                      {posterTitle}
                    </h1>
                  </div>

                  {/* Billing Block - Dynamic Language */}
                  <div className="w-full flex flex-col items-center gap-6 pb-4">
                    <p className="text-[#d4a373] font-black uppercase tracking-[0.4em] text-[14px] md:text-[20px]">
                      {credits.comingSoon}
                    </p>
                    
                    <div className="w-full border-t border-white/20 pt-6 flex flex-col gap-1.5 md:gap-2 font-bold uppercase text-white/90">
                      {/* שורה 1: בימוי והפקה */}
                      <p className="text-[9px] md:text-[13px] tracking-[0.15em]">
                        {credits.line1}
                      </p>
                      
                      {/* שורה 2: צילום, ארט, ליהוק */}
                      <p className="text-[7px] md:text-[10px] text-white/70 tracking-[0.15em]">
                        {credits.line2}
                      </p>
                      
                      {/* שורה 3: מוזיקה, עריכה, אפקטים */}
                      <p className="text-[7px] md:text-[10px] text-white/50 tracking-[0.15em]">
                        {credits.line3}
                      </p>
                      
                      {/* שורה 4: זכויות יוצרים */}
                      <p className="text-white/30 text-[6px] md:text-[8px] tracking-[0.3em] mt-1">
                        {credits.copyright}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {posterLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-[#030712]">
{posterLoading && (
  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#030712] z-50">
    <div className="relative w-24 h-24">
      {/* גלגלת פילם חיצונית מסתובבת */}
      <motion.div 
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 4, ease: "linear" }}
        className="absolute inset-0 border-[3px] border-dashed border-[#d4a373]/30 rounded-full"
      />
      
      {/* צמצם פנימי מהבהב */}
      <div className="absolute inset-0 flex items-center justify-center">
        {[0, 60, 120, 180, 240, 300].map((deg, i) => (
          <motion.div
            key={i}
            style={{ rotate: deg, position: 'absolute' }}
            className="w-full h-full flex items-start justify-center p-1"
          >
            <motion.div 
              animate={{ opacity: [0.2, 1, 0.2], height: ["10%", "30%", "10%"] }}
              transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
              className="w-[3px] bg-[#d4a373] rounded-full shadow-[0_0_15px_rgba(212,163,115,0.5)]"
            />
          </motion.div>
        ))}
      </div>

      {/* אפקט סריקה (Scanner) שרץ מצד לצד */}
      <motion.div 
        animate={{ top: ["20%", "80%", "20%"] }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        className="absolute left-[-20%] right-[-20%] h-[2px] bg-[#d4a373] shadow-[0_0_15px_#d4a373] opacity-50 z-10"
      />
    </div>

    {/* טקסט סטטוס מהבהב */}
    <motion.p 
      animate={{ opacity: [0.4, 1, 0.4] }}
      transition={{ repeat: Infinity, duration: 1.5 }}
      className="mt-10 text-[#d4a373] text-[10px] font-black uppercase tracking-[0.5em] pl-[0.5em]"
    >
      {isHebrew ? 'מפתח פוסטר קולנועי...' : 'DEVELOPING CINEMATIC POSTER...'}
    </motion.p>
  </div>
)}                </div>
              )}
            </div>
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