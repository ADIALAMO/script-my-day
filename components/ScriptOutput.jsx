import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Check, Film, Volume2, VolumeX, Image as ImageIcon, Loader2, AlertTriangle, FastForward, Share2 } from 'lucide-react';

function ScriptOutput({ script, lang, setIsTypingGlobal }) {
  const [cleanScript, setCleanScript] = useState('');
  const [visualPrompt, setVisualPrompt] = useState('');
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
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

  useEffect(() => {
    if (!script) return;
    const marker = "[image:";
    const lowerScript = script.toLowerCase();
    const markerIndex = lowerScript.indexOf(marker);
    
    if (markerIndex !== -1) {
      setCleanScript(script.substring(0, markerIndex).trim());
      const endBracketIndex = script.indexOf("]", markerIndex);
      setVisualPrompt(script.substring(markerIndex + marker.length, endBracketIndex).trim());
    } else {
      setCleanScript(script);
      setVisualPrompt("Cinematic movie poster");
    }
    setDisplayText('');
    setShowPoster(false);
  }, [script]);

  useEffect(() => {
    const initAudio = async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!audioContext.current) audioContext.current = new AudioCtx();
        const response = await fetch('/audio/typewriter.m4a');
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer.current = await audioContext.current.decodeAudioData(arrayBuffer);
      } catch (e) { console.error("Audio Load Error"); }
    };
    initAudio();
  }, []);

  const playSound = () => {
    if (isMutedRef.current || !audioBuffer.current || !audioContext.current) return;
    if (audioContext.current.state === 'suspended') audioContext.current.resume();
    const source = audioContext.current.createBufferSource();
    source.buffer = audioBuffer.current;
    source.playbackRate.value = 0.9 + Math.random() * 0.2;
    const gainNode = audioContext.current.createGain();
    gainNode.gain.value = 0.15;
    source.connect(gainNode).connect(audioContext.current.destination);
    source.start(0);
  };

  useEffect(() => {
    if (!cleanScript) return;
    setIsTyping(true);
    let i = 0;
    if (timerRef.current) clearTimeout(timerRef.current);

    const typeChar = () => {
      if (i >= cleanScript.length) {
        setIsTyping(false);
        setIsTypingGlobal?.(false);
        return;
      }
      setDisplayText(cleanScript.substring(0, i + 1));
      if (cleanScript[i] && cleanScript[i] !== ' ' && cleanScript[i] !== '\n') playSound();
      
      // גלילה ללא התנגדות - שימוש ב-auto במקום smooth
      if (scrollRef.current && !isAutoScrollPaused.current) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'auto'
        });
      }
      i++;
      timerRef.current = setTimeout(typeChar, 35 + Math.random() * 40);
    };
    typeChar();
    return () => clearTimeout(timerRef.current);
  }, [cleanScript]);

  const generatePoster = () => {
    setPosterLoading(true);
    setPosterError(false);
    setShowPoster(true);

    const seed = Math.floor(Math.random() * 999999);
    // הזרקה ישירה של הוראות טקסט הוליוודיות
    const posterDirectives = "movie poster design, large stylized title text at the top, dramatic cinematic lighting, masterpiece, at the bottom professional credits text 'COMING SOON TO CINEMAS'";
    const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(visualPrompt + ", " + posterDirectives)}?width=1024&height=576&seed=${seed}&model=turbo&nologo=true`;
    
    setPosterUrl(url);
  };

  const downloadScript = () => {
    const element = document.createElement("a");
    const file = new Blob([cleanScript], {type: 'text/plain'});
    element.href = URL.createObjectURL(file);
    element.download = "script.txt";
    document.body.appendChild(element);
    element.click();
  };

  if (!script) return null;

  return (
    <div className="space-y-6 w-full max-w-[100vw] px-1">
      <div className="flex justify-between items-center px-4 md:px-6">
        <div className="flex items-center gap-2">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase text-[10px] tracking-widest italic">LIFESCRIPT STUDIO</h2>
        </div>
        <div className="flex gap-2">
          {isTyping && (
            <button onClick={() => { clearTimeout(timerRef.current); setDisplayText(cleanScript); setIsTyping(false); setIsTypingGlobal?.(false); }} className="flex items-center gap-1 px-3 py-1 bg-[#d4a373]/20 border border-[#d4a373]/40 rounded-full text-[10px] text-[#d4a373] font-bold">
              <FastForward size={12} /> SKIP
            </button>
          )}
          <button onClick={() => setIsMuted(!isMuted)} className="p-2 bg-white/5 border border-white/10 rounded-xl">
            {isMuted ? <VolumeX size={16} className="text-red-500" /> : <Volume2 size={16} className="text-[#d4a373]" />}
          </button>
          <button onClick={downloadScript} title="Download Script" className="p-2 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-[#d4a373] transition-colors">
            <Download size={16} />
          </button>
          <button onClick={() => { navigator.clipboard.writeText(cleanScript); setIsCopied(true); setTimeout(() => setIsCopied(false), 2000); }} className="p-2 bg-white/5 border border-white/10 rounded-xl">
            {isCopied ? <Check size={16} className="text-green-500" /> : <Copy size={16} className="text-gray-400" />}
          </button>
        </div>
      </div>

      <div className="relative rounded-[2.5rem] overflow-hidden bg-[#0a1120] border border-blue-500/20 shadow-2xl">
        <div 
          ref={scrollRef} 
          onScroll={() => {
            isAutoScrollPaused.current = true;
            if (pauseTimer.current) clearTimeout(pauseTimer.current);
            pauseTimer.current = setTimeout(() => { isAutoScrollPaused.current = false; }, 2000);
          }}
          className="h-[450px] md:h-[550px] overflow-y-auto p-8 md:p-14 scroll-auto custom-scrollbar"
        >
          <div className={`script-font text-lg md:text-2xl leading-[2.2] text-blue-50/90 whitespace-pre-wrap ${lang === 'he' ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && <span className="inline-block w-2 h-6 bg-[#d4a373] ml-1 animate-pulse" />}
            <div className="h-20" />
          </div>
        </div>
      </div>

      {!isTyping && !showPoster && (
        <div className="flex justify-center py-4">
          <button onClick={generatePoster} className="bg-gradient-to-r from-[#d4a373] to-[#fefae0] text-black px-12 py-5 rounded-full font-black text-sm tracking-[0.2em] flex items-center gap-3 shadow-2xl hover:scale-105 transition-all">
            <ImageIcon size={20} /> {lang === 'he' ? 'צור פוסטר לסרט' : 'GENERATE POSTER'}
          </button>
        </div>
      )}

      <AnimatePresence>
        {showPoster && (
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} className="mt-8 rounded-[3rem] overflow-hidden bg-[#050a15] border border-[#d4a373]/30 p-6 md:p-10 shadow-3xl">
            <div className="relative aspect-video w-full rounded-2xl overflow-hidden bg-black flex items-center justify-center border border-white/5">
              <img src={posterUrl} className={`w-full h-full object-cover transition-opacity duration-1000 ${posterLoading ? 'opacity-0' : 'opacity-100'}`} onLoad={() => setPosterLoading(false)} />
              {posterLoading && <Loader2 className="w-12 h-12 text-[#d4a373] animate-spin" />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ScriptOutput;