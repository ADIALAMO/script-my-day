import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Check, Film, Type, Sparkles } from 'lucide-react';

function ScriptOutput({ script, lang }) {
  const [isCopied, setIsCopied] = useState(false);
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(true);
  
  const scrollRef = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const resumeTimerRef = useRef(null);

  // אפקט ההקלדה
  useEffect(() => {
    if (script) {
      setIsTyping(true);
      isAutoScrollPaused.current = false;
      let i = 0;
      setDisplayText('');
      
      const speed = 40; 
      const timer = setInterval(() => {
        setDisplayText((prev) => prev + script.charAt(i));
        i++;
        if (i >= script.length) { 
          clearInterval(timer); 
          setIsTyping(false); 
        }
      }, speed);

      return () => {
        clearInterval(timer);
        if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      };
    }
  }, [script]);

  // פונקציית הגלילה האוטומטית
  useEffect(() => {
    if (isTyping && scrollRef.current && !isAutoScrollPaused.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [displayText, isTyping]);

  // טיפול באירועי משתמש - עצירה וחזרה חלקה
  const handleUserInteraction = () => {
    // 1. הפסקת הגלילה האוטומטית מייד
    isAutoScrollPaused.current = true;

    // 2. ניקוי טיימר קודם אם קיים
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);

    // 3. הגדרת טיימר לחזרה לגלילה אוטומטית אחרי 4 שניות של חוסר פעילות
    resumeTimerRef.current = setTimeout(() => {
      isAutoScrollPaused.current = false;
      // גלילה ראשונית חלקה חזרה למטה ברגע שהטיימר נגמר
      if (scrollRef.current) {
        scrollRef.current.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'smooth'
        });
      }
    }, 4000); // 4 שניות השהייה
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(script);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([script], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `lifescript_${new Date().getTime()}.txt`;
    a.click();
  };

  if (!script) return null;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center px-6">
        <div className="flex items-center gap-3">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase tracking-[0.4em] text-xs italic">
            {lang === 'he' ? 'התסריט שלך' : 'Your Script'}
          </h2>
        </div>
        <div className="flex gap-3">
          <button onClick={handleCopy} className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all">
            {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-gray-400" />}
          </button>
          <button onClick={handleDownload} className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all">
            <Download size={18} className="text-gray-400" />
          </button>
        </div>
      </div>

      <div className="relative glass-panel rounded-[2rem] overflow-hidden bg-black/40 border border-white/10 shadow-2xl">
        <div 
          ref={scrollRef}
          onWheel={handleUserInteraction}      // גלילה עם עכבר
          onTouchStart={handleUserInteraction} // מגע בטלפון
          onScroll={(e) => {
            // אם הגלילה בוצעה על ידי המשתמש (ולא על ידי הקוד)
            if (e.nativeEvent instanceof WheelEvent || e.nativeEvent.type === 'touchmove') {
              handleUserInteraction();
            }
          }}
          className="h-[500px] overflow-y-auto p-10 md:p-16 scroll-smooth custom-scrollbar"
        >
          <div className={`script-font text-xl leading-[2] text-gray-100 whitespace-pre-wrap ${lang === 'he' ? 'text-right' : 'text-left'}`}>
            {displayText}
            {isTyping && (
              <motion.span 
                animate={{ opacity: [1, 0] }} 
                transition={{ duration: 0.5, repeat: Infinity }} 
                className="inline-block w-2 h-6 bg-[#d4a373] ml-2 align-middle" 
              />
            )}
            <div className="h-40" />
          </div>
        </div>

        <div className="px-10 py-5 bg-white/[0.03] border-t border-white/5 flex justify-between items-center">
          <span className="text-[10px] text-gray-500 uppercase tracking-[0.3em] font-bold flex items-center gap-2">
            <Sparkles size={12} className={isTyping ? "animate-spin" : "text-[#d4a373]"} />
            {isTyping ? (lang === 'he' ? 'התסריט נכתב...' : 'Scripting...') : (lang === 'he' ? 'התסריט מוכן' : 'Script Ready')}
          </span>
          <span className="text-[10px] text-[#d4a373]/40 font-black italic uppercase tracking-widest">
            PRODUCED BY LIFESCRIPT STUDIO
          </span>
        </div>
      </div>
    </div>
  );
}

export default ScriptOutput;