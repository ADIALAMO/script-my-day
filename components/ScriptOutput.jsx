import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Check, Film, Volume2, VolumeX, Image as ImageIcon, Loader2, AlertTriangle, FastForward } from 'lucide-react';

function ScriptOutput({ script, lang, setIsTypingGlobal }) {
  const [cleanScript, setCleanScript] = useState('');
  const [visualPrompt, setVisualPrompt] = useState('');
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  
  const [showPoster, setShowPoster] = useState(false);
  const [posterUrl, setPosterUrl] = useState('');
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterError, setPosterError] = useState(false);

  const scrollRef = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const pauseTimer = useRef(null);
  const timerRef = useRef(null);
  
  const audioContext = useRef(null);
  const audioBuffer = useRef(null);
  const isMutedRef = useRef(isMuted);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // זיהוי המרקר image והפרדת התסריט
  useEffect(() => {
    if (!script) return;
    const marker = "[image:";
    const lowerScript = script.toLowerCase();
    const markerIndex = lowerScript.indexOf(marker);
    
    if (markerIndex !== -1) {
      setCleanScript(script.substring(0, markerIndex).trim());
      const endBracketIndex = script.indexOf("]", markerIndex);
      const extracted = script.substring(markerIndex + marker.length, endBracketIndex).trim();
      setVisualPrompt(extracted);
    } else {
      setCleanScript(script);
      setVisualPrompt("Cinematic movie scene professional lighting");
    }
  }, [script]);

  // מנוע סאונד - הגדרות מכונת כתיבה אנלוגית
  useEffect(() => {
    const initAudio = async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext.current = new AudioCtx();
        const response = await fetch('/audio/typewriter.m4a');
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer.current = await audioContext.current.decodeAudioData(arrayBuffer);
      } catch (e) { console.warn("Audio Context error"); }
    };
    initAudio();
  }, []);

  const playSound = () => {
    if (isMutedRef.current || !audioBuffer.current || !audioContext.current) return;
    const source = audioContext.current.createBufferSource();
    source.buffer = audioBuffer.current;
    const gainNode = audioContext.current.createGain();
    // ווליום מעט גבוה יותר לאפקט מכני
    gainNode.gain.value = 0.12; 
    source.connect(gainNode).connect(audioContext.current.destination);
    source.start(0);
  };

  // גלילה חכמה ללא התנגדות
  useEffect(() => {
    if (!cleanScript) return;
    setIsTyping(true);
    let i = 0;
    if (timerRef.current) clearInterval(timerRef.current);
    
    timerRef.current = setInterval(() => {
      const nextText = cleanScript.substring(0, i + 1);
      setDisplayText(nextText);
      
      if (cleanScript[i] && cleanScript[i] !== ' ' && cleanScript[i] !== '\n') playSound();
      
      // גלילה אוטומטית רק אם המשתמש לא "תפס" את הגלילה
      if (scrollRef.current && !isAutoScrollPaused.current) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'instant'
        });
      }

      i++;
      if (i >= cleanScript.length) {
        clearInterval(timerRef.current);
        setIsTyping(false);
        setIsTypingGlobal?.(false);
      }
    }, 45); // מהירות הקלדה הוליוודית
    return () => clearInterval(timerRef.current);
  }, [cleanScript]);

  const handleManualScroll = () => {
    isAutoScrollPaused.current = true;
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => {
      isAutoScrollPaused.current = false;
    }, 2000); // חוזר לגלילה אוטומטית אחרי 2 שניות של שקט
  };

  const skipTyping = () => {
    clearInterval(timerRef.current);
    setDisplayText(cleanScript);
    setIsTyping(false);
    setIsTypingGlobal?.(false);
    setTimeout(() => {
      if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, 50);
  };

  // יצירת פוסטר - שימוש במודל Turbo למניעת שגיאות 500
  const generatePoster = () => {
    setPosterLoading(true);
    setPosterError(false);
    setShowPoster(true);
    
    // ניקוי פרומפט מינימליסטי
    const simplePrompt = visualPrompt
      .replace(/[^a-zA-Z ]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 12)
      .join(" ");

    const seed = Math.floor(Math.random() * 999999);
    
    // מעבר למודל turbo - הכי מהיר והכי חסין לשגיאות 500
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(simplePrompt + " cinematic movie poster style")}?width=1024&height=576&seed=${seed}&model=turbo&nologo=true`;
    
    setPosterUrl(url);
  };

  if (!script) return null;

  return (
    <div className="space-y-6 w-full max-w-[100vw] px-1">
      {/* כפתורי בקרה */}
      <div className="flex justify-between items-center px-4 md:px-6">
        <div className="flex items-center gap-2">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase text-[10px] tracking-widest italic">LIFESCRIPT STUDIO</h2>
        </div>
        <div className="flex gap-2">
          {isTyping && (
            <button onClick={skipTyping} className="flex items-center gap-1 px-3 py-1 bg-[#d4a373]/20 border border-[#d4a373]/40 rounded-full text-[10px] text-[#d4a373] font-bold hover:bg-[#d4a373]/40 transition-all">
              <FastForward size={12} /> SKIP
            </button>
          )}
          <button onClick={() => setIsMuted(!isMuted)} className="p-2 bg-white/5 border border-white/10 rounded-xl">
            {isMuted ? <VolumeX size={16} className="text-red-500" /> : <Volume2 size={16} className="text-[#d4a373]" />}
          </button>
          <button onClick={() => { navigator.clipboard.writeText(cleanScript); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className="p-2 bg-white/5 border border-white/10 rounded-xl">
            {isCopied ? <Check size={16} className="text-green-500" /> : <Copy size={16} className="text-gray-400" />}
          </button>
        </div>
      </div>

      {/* אזור התסריט */}
      <div className="relative rounded-[2.5rem] overflow-hidden bg-[#0a1120] border border-blue-500/20 shadow-2xl">
        <div 
          ref={scrollRef} 
          onScroll={handleManualScroll}
          className="h-[450px] md:h-[550px] overflow-y-auto p-8 md:p-14 scroll-smooth custom-scrollbar"
        >
          <div className={`script-font text-lg md:text-2xl leading-[2.2] text-blue-50/90 whitespace-pre-wrap ${lang === 'he' ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && <span className="inline-block w-2 h-6 bg-[#d4a373] ml-1 animate-pulse" />}
            <div className="h-20" />
          </div>
        </div>
        
        <div className="px-8 py-4 bg-black/40 border-t border-white/5 flex justify-between items-center">
           <span className="text-[10px] text-gray-500 uppercase font-black tracking-widest italic opacity-50">v2.1 STABLE</span>
           <span className="text-[10px] text-[#d4a373] uppercase font-black tracking-widest italic font-bold">
             {isTyping ? "הפקה בעבודה..." : "התסריט מוכן"}
           </span>
        </div>
      </div>

      {/* כפתור פוסטר */}
      {!isTyping && !showPoster && (
        <div className="flex justify-center py-4">
          <motion.button initial={{ scale: 0.9 }} animate={{ scale: 1 }} onClick={generatePoster} className="bg-gradient-to-r from-[#d4a373] to-[#fefae0] text-black px-12 py-5 rounded-full font-black text-sm tracking-[0.2em] flex items-center gap-3 shadow-2xl hover:scale-105 transition-all">
            <ImageIcon size={20} /> {lang === 'he' ? 'צור פוסטר לסרט' : 'GENERATE POSTER'}
          </motion.button>
        </div>
      )}

      {/* תצוגת פוסטר */}
      <AnimatePresence>
        {showPoster && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="mt-8 rounded-[3rem] overflow-hidden bg-[#050a15] border border-[#d4a373]/30 p-6 md:p-10 shadow-3xl">
            <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-white/5">
              <img 
                src={posterUrl} 
                className={`w-full h-full object-cover transition-opacity duration-1000 ${posterLoading ? 'opacity-0' : 'opacity-100'}`}
                onLoad={() => setPosterLoading(false)}
                onError={() => { setPosterLoading(false); setPosterError(true); }}
              />
              {posterLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                  <Loader2 className="w-12 h-12 text-[#d4a373] animate-spin" />
                  <span className="text-[#d4a373] text-[10px] font-bold tracking-[0.3em]">GENERATING...</span>
                </div>
              )}
              {posterError && (
                <div className="flex flex-col items-center gap-4 text-red-400 p-8 text-center">
                  <AlertTriangle size={48} />
                  <p className="font-bold">STUDIO BUSY - TRY AGAIN</p>
                  <button onClick={generatePoster} className="bg-[#d4a373] text-black px-8 py-2 rounded-xl font-bold">RETRY</button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ScriptOutput;