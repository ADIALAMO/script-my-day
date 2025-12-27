import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Check, Film, Sparkles, Volume2, VolumeX, ChevronLast } from 'lucide-react';

function ScriptOutput({ script, lang, setIsTypingGlobal }) {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [isMuted, setIsMuted] = useState(true); 
  const [isCopied, setIsCopied] = useState(false);

  const scrollRef = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const resumeTimerRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioBufferRef = useRef(null);
  const timerRef = useRef(null);
  
  const isMutedRef = useRef(isMuted);
  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => { setIsTypingGlobal?.(isTyping); }, [isTyping, setIsTypingGlobal]);

  useEffect(() => {
    const initAudio = async () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return; // הגנה מקריסה
        audioContextRef.current = new AudioContextClass();
        const res = await fetch('/audio/typewriter.m4a');
        const buffer = await res.arrayBuffer();
        audioBufferRef.current = await audioContextRef.current.decodeAudioData(buffer);
      } catch (e) { console.error("Audio Load Error", e); }
    };
    initAudio();
  }, []);

  const playTypeSound = () => {
    if (isMutedRef.current || !audioBufferRef.current || !audioContextRef.current) return;
    if (audioContextRef.current.state === 'suspended') audioContextRef.current.resume();
    const source = audioContextRef.current.createBufferSource();
    source.buffer = audioBufferRef.current;
    const gainNode = audioContextRef.current.createGain();
    gainNode.gain.value = 0.12; 
    source.connect(gainNode); gainNode.connect(audioContextRef.current.destination);
    source.start(0);
  };

  useEffect(() => {
    if (!script) return;
    setIsTyping(true);
    isAutoScrollPaused.current = false;
    let i = 0;
    setDisplayText('');
    
    if (timerRef.current) clearInterval(timerRef.current);

    const speed = 55; 
    timerRef.current = setInterval(() => {
      setDisplayText((prev) => {
        const char = script.charAt(i);
        if (char && char !== ' ' && char !== '\n') playTypeSound(); 
        return script.substring(0, i + 1);
      });
      i++;
      if (i >= script.length) {
        clearInterval(timerRef.current);
        setIsTyping(false);
        isAutoScrollPaused.current = true;
      }
    }, speed);

    return () => clearInterval(timerRef.current);
  }, [script]);

  useEffect(() => {
    if (isTyping && scrollRef.current && !isAutoScrollPaused.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [displayText]);

  const handleInteraction = () => {
    if (!isTyping) return;
    isAutoScrollPaused.current = true;
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      if (isTyping) isAutoScrollPaused.current = false;
    }, 4000);
  };

  const downloadScript = () => {
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lifescript_output.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!script) return null;

  return (
    // התיקון הראשון: הוספת overflow-x-hidden ורוחב מקסימלי לקונטיינר הראשי
    <div className="space-y-6 w-full max-w-[100vw] overflow-x-hidden px-1 md:px-0">
      
      {/* Header Buttons Section */}
      <div className="flex justify-between items-center px-4 md:px-6">
        <div className="flex items-center gap-2 md:gap-3 overflow-hidden">
          <Film size={18} className="text-[#d4a373] flex-shrink-0" />
          <h2 className="text-[#d4a373] font-black uppercase tracking-[0.2em] md:tracking-[0.4em] text-[10px] md:text-xs italic truncate">
            {lang === 'he' ? 'התסריט שלך' : 'Your Script'}
          </h2>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {isTyping && (
            <button 
              onClick={() => { if(timerRef.current) clearInterval(timerRef.current); setDisplayText(script); setIsTyping(false); isAutoScrollPaused.current = true; }} 
              className="px-3 py-1.5 md:px-4 md:py-2 bg-[#d4a373]/10 border border-[#d4a373]/30 rounded-full text-[9px] md:text-[10px] text-[#d4a373] font-black uppercase whitespace-nowrap flex items-center gap-1"
            >
               <ChevronLast size={12} /> {lang === 'he' ? 'דלג' : 'SKIP'}
            </button>
          )}
          <button onClick={() => setIsMuted(!isMuted)} className="p-2 md:p-3 bg-white/5 border border-white/10 rounded-xl">
            {isMuted ? <VolumeX size={16} className="text-red-500" /> : <Volume2 size={16} className="text-[#d4a373]" />}
          </button>
          <button onClick={downloadScript} className="p-2 md:p-3 bg-white/5 border border-white/10 rounded-xl text-gray-400"><Download size={16} /></button>
          <button onClick={() => { navigator.clipboard.writeText(script); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className="p-2 md:p-3 bg-white/5 border border-white/10 rounded-xl">
            {isCopied ? <Check size={16} className="text-green-500" /> : <Copy size={16} className="text-gray-400" />}
          </button>
        </div>
      </div>

      {/* Script Box */}
      <div className="relative rounded-[1.5rem] md:rounded-[2.5rem] overflow-hidden bg-[#0a1120] border border-blue-500/20 shadow-[0_0_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl ring-1 ring-white/5">
        <div className="absolute inset-0 bg-blue-900/10 pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#d4a373]/50 to-transparent z-10" />

        <div 
          ref={scrollRef} 
          onWheel={handleInteraction} 
          onTouchMove={handleInteraction} 
          onScroll={(e) => { if (isTyping) handleInteraction(); }} 
          className="relative z-20 h-[450px] md:h-[550px] overflow-y-auto p-5 md:p-16 scroll-smooth custom-scrollbar overflow-x-hidden"
        >
          {/* התיקון השני: הגדרת break-words ו-text-base למובייל */}
          <div className={`script-font text-base md:text-2xl leading-[2] md:leading-[2.3] text-blue-50/90 whitespace-pre-wrap break-words w-full ${lang === 'he' ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && (
              <motion.span 
                animate={{ opacity: [1, 0] }} 
                transition={{ duration: 0.5, repeat: Infinity }} 
                className="inline-block w-2 h-5 md:w-2.5 md:h-7 bg-[#d4a373] ml-1 align-middle shadow-[0_0_15px_#d4a373]" 
              />
            )}
            <div className="h-40" />
          </div>
        </div>

        {/* Footer Section */}
        {/* התיקון השלישי (החשוב ביותר): הורדת Padding ל-4, ושינוי Tracking למובייל */}
        <div className="relative z-20 px-4 py-4 md:px-10 md:py-6 bg-black/20 border-t border-white/5 flex justify-between items-center backdrop-blur-md gap-2">
          <span className="text-[8px] md:text-[10px] text-gray-500 uppercase tracking-widest font-black flex-shrink-0">
            {isTyping ? (lang === 'he' ? 'מעבד...' : 'Processing...') : (lang === 'he' ? 'הפקה הסתיימה' : 'Finished')}
          </span>
          
          {/* כאן התיקון: tracking-normal במובייל במקום tracking-widest */}
          <span className="text-[9px] md:text-[10px] text-[#d4a373]/60 font-bold uppercase tracking-normal md:tracking-widest italic whitespace-nowrap">
            LIFESCRIPT STUDIO
          </span>
        </div>
      </div>
    </div>
  );
}

export default ScriptOutput;