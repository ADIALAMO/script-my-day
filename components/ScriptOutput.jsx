import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Check, Film, Volume2, VolumeX, Image as ImageIcon, Loader2, FastForward } from 'lucide-react';

// --- פונקציות עזר ברמת Master ---

const getCinematicTitle = (text) => {
  if (!text) return "";
  let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let firstLine = lines[0] || "";
  // מחיקה אגרסיבית של אנגלית, סוגריים וסימני Markdown
  return firstLine
    .replace(/\([^)]*\)/g, '') 
    .replace(/[a-zA-Z]/g, '')   
    .replace(/^(כותרת|Title|Script Title|תסריט):\s*/i, '')
    .replace(/[*#_:]/g, '')
    .trim();
};

const translateGenre = (genre) => {
  const map = {
    'אימה': 'Horror', 'קומדיה': 'Comedy', 'דרמה': 'Drama', 'אקשן': 'Action',
    'מדע בדיוני': 'Sci-Fi', 'מתח': 'Thriller', 'רומנטיקה': 'Romance', 'פנטזיה': 'Fantasy'
  };
  return map[genre] || genre || 'Cinematic';
};

function ScriptOutput({ script, lang, setIsTypingGlobal, genre }) {
  const [cleanScript, setCleanScript] = useState('');
  const [visualPrompt, setVisualPrompt] = useState('');
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  
  const [showPoster, setShowPoster] = useState(false);
  const [posterUrl, setPosterUrl] = useState('');
  const [posterLoading, setPosterLoading] = useState(false);

  const scrollRef = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const pauseTimer = useRef(null);
  const timerRef = useRef(null);
  
  const audioContext = useRef(null);
  const audioBuffer = useRef(null);
  const isMutedRef = useRef(isMuted);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // 1. אתחול מנוע סאונד עם עיבוד "חם" (Warm Audio)
  useEffect(() => {
    const initAudio = async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContext.current = new AudioCtx();
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
    
    // פילטרים לסאונד אנלוגי
    const filter = audioContext.current.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 3500; 

    const compressor = audioContext.current.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-24, audioContext.current.currentTime);
    compressor.knee.setValueAtTime(40, audioContext.current.currentTime);

    const gainNode = audioContext.current.createGain();
    gainNode.gain.value = 0.25;

    source.connect(filter);
    filter.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(audioContext.current.destination);
    
    source.start(0);
  };

  // 2. עיבוד הטקסט והתמונה
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
      setVisualPrompt("Dramatic cinematic key visual");
    }
    setDisplayText('');
    setShowPoster(false);
  }, [script]);

  // 3. מנוע הקלדה חכם
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
      timerRef.current = setTimeout(typeChar, 40);
    };
    typeChar();
    return () => clearTimeout(timerRef.current);
  }, [cleanScript]);

  const generatePoster = () => {
    setPosterLoading(true);
    setShowPoster(true);
    const selectedGenre = translateGenre(genre);
    const seed = Math.floor(Math.random() * 999999);
    
    const prompt = `Movie poster, ${selectedGenre} genre, ${visualPrompt}, highly detailed face, symmetrical, clear eyes, cinematic lighting, 8k resolution, textless, masterwork.`;
    const directUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1536&seed=${seed}&nologo=true`;
    setPosterUrl(`/api/proxy-image?url=${encodeURIComponent(directUrl)}`);
  };

  const isHebrew = lang === 'he';
  const rawTitle = getCinematicTitle(cleanScript);

  return (
    <div className="space-y-6 w-full max-w-[100vw] px-1">
      
      {/* סרגל פונקציות עליון - וידוא קיום כל הכפתורים */}
      <div className="flex justify-between items-center px-4">
        <div className="flex items-center gap-2">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase text-[10px] tracking-widest italic">LIFESCRIPT STUDIO</h2>
        </div>
        <div className="flex gap-2">
          {isTyping && (
            <button onClick={() => { clearTimeout(timerRef.current); setDisplayText(cleanScript); setIsTyping(false); setIsTypingGlobal?.(false); }} className="px-3 py-1 bg-[#d4a373]/20 border border-[#d4a373]/40 rounded-full text-[10px] text-[#d4a373] font-bold">
              <FastForward size={12} className="inline mr-1" /> SKIP
            </button>
          )}
          <button onClick={() => setIsMuted(!isMuted)} className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
            {isMuted ? <VolumeX size={18} className="text-red-500" /> : <Volume2 size={18} className="text-[#d4a373]" />}
          </button>
          <button onClick={() => {
            const element = document.createElement("a");
            const file = new Blob([cleanScript], {type: 'text/plain'});
            element.href = URL.createObjectURL(file);
            element.download = "script.txt";
            element.click();
          }} className="p-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-[#d4a373]">
            <Download size={18} />
          </button>
          <button onClick={() => {
            navigator.clipboard.writeText(cleanScript);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
          }} className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
            {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-gray-400" />}
          </button>
        </div>
      </div>

      {/* תצוגת תסריט */}
      <div className="relative rounded-[3rem] overflow-hidden bg-[#0a1120] border border-white/5 shadow-2xl">
        <div 
          ref={scrollRef} 
          onScroll={() => {
            isAutoScrollPaused.current = true;
            if (pauseTimer.current) clearTimeout(pauseTimer.current);
            pauseTimer.current = setTimeout(() => { isAutoScrollPaused.current = false; }, 2000);
          }}
          className="h-[450px] md:h-[550px] overflow-y-auto p-10 md:p-16 scroll-auto custom-scrollbar"
        >
          <div className={`script-font text-lg md:text-2xl leading-[2.6] text-gray-100 whitespace-pre-wrap ${isHebrew ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && <span className="inline-block w-2.5 h-7 bg-[#d4a373] ml-1 animate-pulse" />}
          </div>
        </div>
      </div>

      {!isTyping && !showPoster && (
        <div className="flex justify-center py-6">
          <button onClick={generatePoster} className="bg-[#d4a373] text-black px-14 py-6 rounded-full font-black text-sm tracking-[0.3em] shadow-2xl hover:scale-105 active:scale-95 transition-all">
            {isHebrew ? 'צור פוסטר לסרט' : 'GENERATE MOVIE POSTER'}
          </button>
        </div>
      )}

      {/* פוסטר ואוורלאיי הוליוודי - קומפוזיציה מושלמת */}
      <AnimatePresence>
        {showPoster && (
          <motion.div initial={{ opacity: 0, y: 50 }} animate={{ opacity: 1, y: 0 }} className="relative max-w-xl mx-auto w-full mt-10">
            <div className="relative aspect-[2/3] w-full rounded-[3.5rem] overflow-hidden bg-black shadow-4xl border border-[#d4a373]/30">
              <img src={posterUrl} className={`w-full h-full object-cover transition-opacity duration-1000 ${posterLoading ? 'opacity-0' : 'opacity-100'}`} onLoad={() => setPosterLoading(false)} />
              
              {!posterLoading && (
                <div className="absolute inset-0 flex flex-col items-center z-10">
                  <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-transparent to-black/50" />
                  
                  {/* כותרת מוגדלת ב-35% גובה */}
                  <div className="relative text-center w-full flex flex-col items-center" style={{ marginTop: '35%' }}>
                    {(() => {
                      const hasSubTitle = rawTitle.includes(':');
                      const titleParts = rawTitle.split(':');
                      const titleStyle = { fontFamily: 'serif', textShadow: '0 12px 45px rgba(0,0,0,1)' };
                      
                      if (hasSubTitle) {
                        return (
                          <>
                            <h1 className="text-white font-black uppercase tracking-tight text-[4.2rem] leading-[0.8]" style={titleStyle}>{titleParts[0].trim()}</h1>
                            <h2 className="text-[#d4a373] font-bold uppercase tracking-[0.5em] text-[1.8rem] mt-5" style={titleStyle}>{titleParts[1].trim()}</h2>
                          </>
                        );
                      }
                      return <h1 className="text-white font-black uppercase tracking-wide text-[4.8rem] leading-[0.9]" style={titleStyle}>{rawTitle}</h1>;
                    })()}
                  </div>

                  {/* קרדיטים ו-Coming Soon משוחזרים ומורחבים */}
                  <div className="absolute bottom-12 text-center flex flex-col items-center px-6 w-full space-y-10">
                    <p className="text-[#d4a373] font-black uppercase tracking-[0.8em] text-[22px] drop-shadow-2xl">
                      {isHebrew ? 'בקרוב בקולנוע' : 'COMING SOON'}
                    </p>
                    
                    <div className="flex flex-col gap-2.5 w-full border-t border-white/20 pt-8">
                      <p className="text-white/95 text-[12px] font-bold tracking-[0.15em] leading-tight uppercase">
                        {isHebrew ? 'בימוי: עדי אלמו • הפקה: LIFESCRIPT STUDIO' : 'DIRECTED BY ADI ALAMO • PRODUCED BY LIFESCRIPT STUDIO'}
                      </p>
                      <p className="text-white/70 text-[9px] font-medium tracking-[0.2em] leading-tight uppercase">
                        {isHebrew 
                          ? 'צילום: מעבדת בינה מלאכותית • ליהוק: וירטואלי • עריכה: עולם הקולנוע'
                          : 'CINEMATOGRAPHY: AI LAB • CASTING: VIRTUAL • EDITING: CINEMA WORLD'}
                      </p>
                      <p className="text-white/60 text-[9px] font-medium tracking-[0.2em] leading-tight uppercase">
                        {isHebrew 
                          ? 'מוזיקה וסאונד: המאסטר • תסריט: סוכן 2005'
                          : 'MUSIC & SOUND: THE MASTER • SCRIPT: AGENT 2005'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {posterLoading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/80">
                  <div className="flex flex-col items-center gap-4">
                    <Loader2 className="w-12 h-12 text-[#d4a373] animate-spin" />
                    <p className="text-[#d4a373] text-[10px] font-bold tracking-[0.3em] uppercase animate-pulse">Developing Film...</p>
                  </div>
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