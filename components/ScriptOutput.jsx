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
 // --- מנוע סאונד קולנועי משודרג ---
  useEffect(() => {
    const initAudio = async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!audioContext.current) audioContext.current = new AudioCtx();
        
        const response = await fetch('/audio/typewriter.m4a');
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer.current = await audioContext.current.decodeAudioData(arrayBuffer);
        
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
    
    // Resume context if suspended
    if (audioContext.current.state === 'suspended') {
      audioContext.current.resume();
    }

    const source = audioContext.current.createBufferSource();
    source.buffer = audioBuffer.current;
    
    const gainNode = audioContext.current.createGain();
    // ווליום נקי ומדויק
    gainNode.gain.setValueAtTime(0.12, audioContext.current.currentTime);
    // מניעת ה"חריקה" הדיגיטלית - דעיכה מהירה בסוף הצליל
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.current.currentTime + 0.1);
    
    // Pitch רנדומלי למכונת כתיבה חיה
    source.playbackRate.value = 0.96 + Math.random() * 0.08;
    
    source.connect(gainNode);
    gainNode.connect(audioContext.current.destination);
    source.start(0);
    // עצירה מוחלטת של ה-buffer לאחר 150ms כדי שלא יצטברו צלילים
    source.stop(audioContext.current.currentTime + 0.15);
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
        <div className="flex items-center gap-3">
  {/* האייקון הממותג שלך */}
  <div className="relative w-7 h-7 overflow-hidden rounded-md border border-[#d4a373]/30 shadow-[0_0_15px_rgba(212,163,115,0.1)]">
    <img 
      src="/icon.png" 
      alt="Studio Icon" 
      className="w-full h-full object-cover"
    />
  </div>
  
  <div className="flex flex-col">
    <h2 className="text-[#d4a373] font-black uppercase text-[11px] tracking-[0.2em] italic leading-none">
      LIFESCRIPT
    </h2>
    <span className="text-white/30 text-[7px] tracking-[0.3em] uppercase mt-0.5">
      Studio Edition
    </span>
  </div>
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

        {/* --- חתימה נעוצה בתחתית --- */}
        {(!isTyping && displayText.length === cleanScript.length && cleanScript.length > 0) && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 1 }}
            className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-[#030712] via-[#030712]/95 to-transparent pt-12 pb-8 px-10 flex justify-between items-center z-30"
          >
            {/* צד שמאל - טקסט סטטוס */}
            <div className="flex flex-col items-start gap-1 font-sans">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-[#d4a373] shadow-[0_0_8px_rgba(212,163,115,0.6)]" />
                <span className="text-[10px] text-white font-black tracking-widest uppercase italic leading-none">
                  {isHebrew ? 'הפקה הושלמה' : 'PRODUCTION COMPLETE'}
                </span>
              </div>
              <span className="text-[9px] text-[#d4a373] font-bold tracking-wider uppercase leading-none">
                {isHebrew ? 'מוכנים לצילום!' : 'READY FOR SHOOT!'}
              </span>
            </div>

            {/* צד ימין - לוגו */}
            <div className="flex items-center">
              <img src="/icon.png" className="w-8 h-8 object-contain opacity-80" alt="Studio Icon" />
            </div>
          </motion.div>
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
            className="relative max-w-2xl mx-auto w-full pb-4 px-4 overflow-hidden" // צמצום pb-24 ל-pb-4
          >
             <div className="relative aspect-[2/3] w-full max-w-[450px] md:max-h-[75vh] mx-auto rounded-[3.5rem] md:rounded-[4.5rem] overflow-hidden bg-black shadow-4xl border border-[#d4a373]/30">
              <img 
                src={posterUrl} 
                className={`w-full h-full object-cover transition-opacity duration-1000 ${posterLoading ? 'opacity-0' : 'opacity-100'}`} 
                onLoad={() => setPosterLoading(false)} 
              />
              
              {!posterLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-between p-8 md:p-14 text-center z-20 pointer-events-none">
                  {/* שכבת הצללה משופרת - חזקה מאוד למטה להגנה על הטקסט */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-transparent to-black/60 -z-10" />
                  
                  {/* כותרת הסרט */}
                  <div className="w-full pt-4 md:pt-10">
                    <h1 className="text-white font-black uppercase tracking-tight text-[2.5rem] md:text-[4.5rem] leading-[0.85] italic drop-shadow-[0_10px_30px_rgba(0,0,0,1)] break-words">
                      {posterTitle}
                    </h1>
                  </div>

                  {/* אזור תחתון: Coming Soon + Billing Block */}
                  <div className="w-full flex flex-col items-center gap-6 pb-4">
                    {/* Coming Soon עם צל מודגש לקריאות */}
                    <p className="text-[#d4a373] font-black uppercase tracking-[0.4em] text-[14px] md:text-[20px] drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                      {credits.comingSoon}
                    </p>

                    <div className="w-full border-t border-white/10 pt-4 flex flex-col items-center gap-2">
                      {/* שורה 1 - הנהגה */}
                      <div className="flex justify-center gap-x-4 opacity-100 leading-tight drop-shadow-[0_1px_3px_rgba(0,0,0,1)]">
                        <div className="flex items-baseline gap-1">
                          <span className="text-[6px] md:text-[8px] font-light tracking-tighter text-white/60 uppercase italic">Directed by</span>
                          <span className="text-[9px] md:text-[13px] font-black tracking-widest text-white uppercase italic">{isHebrew ? 'עדי אלמו' : 'Adi Alamo'}</span>
                        </div>
                        <div className="flex items-baseline gap-1">
                          <span className="text-[6px] md:text-[8px] font-light tracking-tighter text-white/60 uppercase italic">Produced by</span>
                          <span className="text-[9px] md:text-[13px] font-black tracking-widest text-white uppercase italic text-nowrap">LifeScript Studio</span>
                        </div>
                      </div>

                      {/* שורה 2 - צוות קריאייטיב */}
                      <div className="flex justify-center gap-x-3 opacity-90 leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                        <p className="text-[6px] md:text-[9px] tracking-[0.2em] font-medium uppercase text-white/90 text-center">
                          {isHebrew 
                            ? 'ליהוק וירטואלי • עיצוב אמנותי הוליווד דיגיטלית • תלבושות AI STYLE' 
                            : 'CASTING VIRTUAL • ART DIRECTION DIGITAL HOLLYWOOD • COSTUMES AI STYLE'}
                        </p>
                      </div>

                      {/* שורה 3 - צוות טכני */}
                      <div className="flex justify-center gap-x-3 opacity-80 leading-tight drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                        <p className="text-[5px] md:text-[8px] tracking-[0.15em] font-medium uppercase text-white/80 text-center">
                          {isHebrew 
                            ? 'צילום מעבדת AI • עריכה סוכן 2005 • פסקול THE MASTER • אפקטים מנוע קולנועי' 
                            : 'CINEMATOGRAPHY AI LAB • EDITING AGENT 2005 • MUSIC THE MASTER • VFX ENGINE'}
                        </p>
                      </div>

                      {/* חתימה מרכזית - אייקון גדול וזכויות יוצרים */}
                      <div className="flex flex-col items-center gap-2 mt-1">
                        <img 
                          src="/icon.png" 
                          className="w-7 h-7 md:w-9 md:h-9 object-contain brightness-125 drop-shadow-[0_0_15px_rgba(0,0,0,0.9)]" 
                          alt="Studio Logo" 
                        />
                        <p className="text-[6px] md:text-[7px] tracking-[0.5em] uppercase font-bold text-white/40 drop-shadow-[0_1px_2px_rgba(0,0,0,1)]">
                          {credits.copyright}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {/* Loader נקי ללא כפילויות */}
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