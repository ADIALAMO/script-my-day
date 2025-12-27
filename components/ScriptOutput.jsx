import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Check, Film, Sparkles, Volume2, VolumeX, ChevronLast } from 'lucide-react';

function ScriptOutput({ script, lang, setIsTypingGlobal }) {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  const [isMuted, setIsMuted] = useState(true); // השתקת הקלדה בברירת מחדל
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
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
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
        if (char !== ' ' && char !== '\n') playTypeSound(); 
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
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `lifescript_output.txt`;
    a.click();
  };

  if (!script) return null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center px-6">
        <div className="flex items-center gap-3">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase tracking-[0.4em] text-xs italic">{lang === 'he' ? 'התסריט שלך' : 'Your Script'}</h2>
        </div>
        <div className="flex gap-2">
          {isTyping && (
            <button 
              onClick={() => { if(timerRef.current) clearInterval(timerRef.current); setDisplayText(script); setIsTyping(false); isAutoScrollPaused.current = true; }} 
              className="px-4 py-2 bg-[#d4a373]/10 border border-[#d4a373]/30 rounded-full text-[10px] text-[#d4a373] font-black uppercase hover:bg-[#d4a373]/20 transition-all flex items-center gap-2"
            >
              <ChevronLast size={14} /> {lang === 'he' ? 'דלג לסוף' : 'SKIP'}
            </button>
          )}
          <button onClick={() => setIsMuted(!isMuted)} className="p-3 bg-white/5 border border-white/10 rounded-xl">
            {isMuted ? <VolumeX size={18} className="text-red-500" /> : <Volume2 size={18} className="text-[#d4a373]" />}
          </button>
          <button onClick={downloadScript} className="p-3 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-[#d4a373] transition-all"><Download size={18} /></button>
          <button onClick={() => { navigator.clipboard.writeText(script); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className="p-3 bg-white/5 border border-white/10 rounded-xl">
            {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-gray-400 hover:text-[#d4a373]" />}
          </button>
        </div>
      </div>

      <div className="relative rounded-[2.5rem] overflow-hidden bg-[#0a1120] border border-blue-500/20 shadow-[0_0_60px_rgba(0,0,0,0.8)] backdrop-blur-2xl ring-1 ring-white/5">
        <div className="absolute inset-0 bg-blue-900/10 pointer-events-none" />
        <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-[#d4a373]/50 to-transparent z-10" />

        <div 
          ref={scrollRef} 
          onWheel={handleInteraction} 
          onTouchMove={handleInteraction} 
          onScroll={(e) => { if (isTyping) handleInteraction(); }} 
          className="relative z-20 h-[450px] md:h-[550px] overflow-y-auto p-10 md:p-16 scroll-smooth custom-scrollbar"
        >
          <div className={`script-font text-lg md:text-2xl leading-[2.3] text-blue-50/90 whitespace-pre-wrap ${lang === 'he' ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && (
              <motion.span 
                animate={{ opacity: [1, 0] }} 
                transition={{ duration: 0.5, repeat: Infinity }} 
                className="inline-block w-2.5 h-7 bg-[#d4a373] ml-2 align-middle shadow-[0_0_15px_#d4a373]" 
              />
            )}
            <div className="h-40" />
          </div>
        </div>

        <div className="relative z-20 px-10 py-6 bg-black/20 border-t border-white/5 flex justify-between items-center backdrop-blur-md">
          <span className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-black">
            {isTyping ? (lang === 'he' ? 'מעבד סצנה...' : 'Processing Scene...') : (lang === 'he' ? 'הפקה הסתיימה' : 'Production Finished')}
          </span>
          <span className="text-[10px] text-[#d4a373]/60 font-bold uppercase tracking-widest italic">
            LIFESCRIPT STUDIO
          </span>
        </div>
      </div>
    </div>
  );
}

export default ScriptOutput;