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

  // אפקט ההקלדה (מכונת כתיבה) - קצב הוליוודי 40ms
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
          // בסיום ההקלדה, אנחנו מקפיאים את הגלילה האוטומטית כדי שלא תקפוץ למשתמש
          isAutoScrollPaused.current = true;
        }
      }, speed);

      return () => {
        clearInterval(timer);
        if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      };
    }
  }, [script]);

  // לוגיקת הגלילה האוטומטית - רצה רק בזמן הקלדה ורק אם המשתמש לא "תפס" את המסך
  useEffect(() => {
    if (isTyping && scrollRef.current && !isAutoScrollPaused.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [displayText, isTyping]);

  // ניהול אינטראקציית משתמש - עצירה ל-4 שניות וחזרה חלקה
  const handleUserInteraction = (e) => {
    // אם ההקלדה הסתיימה, אין צורך להפעיל טיימרים של חזרה
    if (!isTyping) {
      isAutoScrollPaused.current = true;
      return;
    }

    // הפסקה מיידית של הגלילה האוטומטית
    isAutoScrollPaused.current = true;

    // ניקוי טיימר קודם במידה והמשתמש עדיין גולל
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);

    // הגדרת חזרה לגלילה אוטומטית רק אחרי 4 שניות של שקט
    resumeTimerRef.current = setTimeout(() => {
      if (isTyping) {
        isAutoScrollPaused.current = false;
        // גלילה ראשונית חלקה חזרה למקום ההקלדה
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }
    }, 4000);
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
    a.href = url; 
    a.download = `lifescript_${new Date().getTime()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!script) return null;

  return (
    <div className="space-y-6">
      {/* Header של אזור הפלט */}
      <div className="flex justify-between items-center px-6">
        <div className="flex items-center gap-3">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase tracking-[0.4em] text-xs italic">
            {lang === 'he' ? 'התסריט שלך' : 'Your Script'}
          </h2>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={handleCopy} 
            className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all group"
            title="Copy to clipboard"
          >
            {isCopied ? <Check size={18} className="text-green-500" /> : <Copy size={18} className="text-gray-400 group-hover:text-[#d4a373]" />}
          </button>
          <button 
            onClick={handleDownload} 
            className="p-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl transition-all group"
            title="Download as TXT"
          >
            <Download size={18} className="text-gray-400 group-hover:text-[#d4a373]" />
          </button>
        </div>
      </div>

      {/* מיכל הטקסט הראשי */}
      <div className="relative glass-panel rounded-[2rem] overflow-hidden bg-black/40 border border-white/10 shadow-2xl">
        <div 
          ref={scrollRef}
          onWheel={handleUserInteraction}
          onTouchStart={handleUserInteraction}
          onTouchMove={handleUserInteraction}
          onScroll={(e) => {
            // אם הגלילה מגיעה מהמשתמש בזמן הקלדה, עוצרים אוטומציה
            if (isTyping) handleUserInteraction();
          }}
          className="h-[450px] md:h-[550px] overflow-y-auto p-10 md:p-16 scroll-smooth custom-scrollbar"
        >
          <div className={`script-font text-lg md:text-xl leading-[2.2] text-gray-100 whitespace-pre-wrap ${lang === 'he' ? 'text-right' : 'text-left'}`}>
            {displayText}
            
            {/* הסמן המהבהב (Cursor) */}
            {isTyping && (
              <motion.span 
                animate={{ opacity: [1, 0] }} 
                transition={{ duration: 0.5, repeat: Infinity }} 
                className="inline-block w-2 h-6 bg-[#d4a373] ml-2 align-middle shadow-[0_0_10px_#d4a373]" 
              />
            )}
            
            {/* שטח ריק לנשימה בתחתית */}
            <div className="h-32" />
          </div>
        </div>

        {/* Footer של חלון הפלט */}
        <div className="px-10 py-6 bg-white/[0.03] border-t border-white/5 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className={`p-1.5 rounded-full ${isTyping ? 'bg-amber-500/20' : 'bg-green-500/20'}`}>
              <Sparkles size={14} className={isTyping ? "animate-spin text-amber-500" : "text-green-500"} />
            </div>
            <span className="text-[10px] text-gray-400 uppercase tracking-[0.3em] font-black">
              {isTyping ? (lang === 'he' ? 'מעבד נתונים...' : 'Processing...') : (lang === 'he' ? 'הפקה הושלמה' : 'Production Ready')}
            </span>
          </div>
          
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-[#d4a373]/30 font-black italic uppercase tracking-[0.2em] hidden sm:inline">
              Cinematic Engine v3.0
            </span>
            <div className="h-4 w-[1px] bg-white/10 hidden sm:block" />
            <span className="text-[10px] text-gray-600 font-bold uppercase tracking-widest">
              LIFESCRIPT STUDIO
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ScriptOutput;