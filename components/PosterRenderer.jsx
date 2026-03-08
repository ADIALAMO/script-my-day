import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, VolumeX, Download, Share2 } from 'lucide-react'; // וודא שאייקונים אלה מיובאים
import * as htmlToImage from 'html-to-image'; // וודא שזה מיובא אם handleCapturePoster מועבר

function PosterRenderer({
  posterUrl,
  posterLoading,
  posterError,
  setPosterError,
  setPosterUrl,
  triggerFlash,
  posterRef,
  posterTitle,
  credits,
  handleCapturePoster, // פונקציה זו מועברת מ‑ScriptOutput
  lang,
  genre,
  posterLoadingMessages,
  setTriggerFlash,
  setPosterLoading,
  playFlashSound, // <-- הוספת ה‑prop החדש
}) {
  const isHebrew = lang === 'he'; // Assuming lang is passed correctly


  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="relative max-w-2xl mx-auto w-full pb-2 px-4 z-10"
    >
      <div ref={posterRef} className="relative aspect-[2/3] w-full max-w-[450px] mx-auto rounded-[3.5rem] md:rounded-[4.5rem] overflow-hidden bg-[#030712] shadow-4xl border border-[#d4a373]/30">
        {posterUrl && (
          <img 
            src={posterUrl} 
            crossOrigin="anonymous"
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${posterLoading ? 'opacity-0' : 'opacity-100'}`} 
            onLoad={() => {
              if (typeof window !== 'undefined' && window.gtag) {
                window.gtag('event', 'poster_rendered_visually', { genre: genre });
              }
              
              // הפעלת סאונד הפלאש מיד לאחר טעינת התמונה
              playFlashSound();

              // השהיה מינימלית ביותר לסנכרון עין-אוזן
              setTimeout(() => {
                window.requestAnimationFrame(() => {
                  setTriggerFlash(true);
                  setPosterLoading(false);
                  
                  // פלאש קצר ומהיר (0.5 שניות) לאפקט מקצועי
                  setTimeout(() => setTriggerFlash(false), 500);
                });
              }, 50); 
            }}
            onError={() => setPosterLoading(false)}
            alt="Movie Poster"
          />
        )}

        {/* 2. אפקט הפלאש הלבן (Z-INDEX 100) */}
        <AnimatePresence>
          {triggerFlash && (
            <motion.div 
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0 bg-white z-[100] pointer-events-none"
            />
          )}
        </AnimatePresence>
        
        {/* 3. שכבת סטטוס (טעינה או שגיאה) */}
        {(posterLoading || posterError) && !posterUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#030712] z-[50] px-6 text-center">
            {!posterError ? (
              /* מצב טעינה רגיל */
              <>
                <div className="relative w-20 h-20 mb-10">
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }} className="absolute inset-0 border-[3px] border-dashed border-[#d4a373]/30 rounded-full" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                      <motion.div key={i} style={{ rotate: deg, position: 'absolute' }} className="w-full h-full flex items-start justify-center p-1">
                        <motion.div animate={{ opacity: [0.2, 1, 0.2], height: ["10%", "30%", "10%"] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }} className="w-[3px] bg-[#d4a373] rounded-full" />
                      </motion.div>
                    ))}
                  </div>
                </div>
                <div className="h-6">
                  <AnimatePresence mode="wait">
                    <motion.p key={posterLoadingMessages.index} initial={{ y: 15, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -15, opacity: 0 }} className="text-[#d4a373] text-[10px] font-black uppercase tracking-[0.4em] whitespace-nowrap">
                      {posterLoadingMessages.message}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </>
            ) : (
              /* מצב שגיאה / מכסה הסתיימה */
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
                <div className="w-16 h-16 mb-6 flex items-center justify-center rounded-full bg-[#d4a373]/5 border border-[#d4a373]/20">
                  <VolumeX className="w-8 h-8 text-[#d4a373]/40" />
                </div>
                <h3 className="text-[#d4a373] font-black text-[12px] mb-3 uppercase tracking-[0.2em] italic">
                  {isHebrew ? 'ההקרנה הופסקה' : 'SCREENING PAUSED'}
                </h3>
                <p className="text-white/50 text-[11px] mb-8 leading-relaxed max-w-[240px] font-medium italic">
                  {posterError}
                </p>
                <button 
                  onClick={() => {
                   if (typeof window !== 'undefined' && window.gtag) {
                     window.gtag('event', 'poster_retry_click', { genre: genre });
                   }
                   // קריאה לפונקציה שמייצרת את הפוסטר מחדש (צריך להיות מועבר כ‑prop)
                   // נניח ש‑handleGeneratePoster הוא ה‑prop הנכון
                   handleCapturePoster('generate'); // שימוש ב‑handleCapturePoster כפונקציה כללית
                   }}
                    className="group relative px-8 py-3 overflow-hidden rounded-full transition-all duration-300 active:scale-95"
                >
                  <div className="absolute inset-0 bg-[#d4a373]/10 border border-[#d4a373]/30 rounded-full group-hover:bg-[#d4a373] transition-colors duration-300" />
                  <span className="relative text-[#d4a373] group-hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors duration-300">
                    {isHebrew ? 'נסה שוב' : 'RETRY'}
                  </span>
                </button>
              </motion.div>
            )}
          </div>
        )}

        {/* 4. שכבת הטיפוגרפיה (Overlay) - רק כשיש תמונה */}
        {!posterLoading && posterUrl && !posterError && (
          <div className="absolute inset-0 flex flex-col items-center justify-between z-20 pointer-events-none p-8 md:p-12">
            {/* גרדיאנטים להגנת קריאות */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/40 -z-10" />
            
            {/* כותרת עליונה */}
            <div className="w-full text-center mt-4">
              <h1 
                className="text-white font-black uppercase italic drop-shadow-[0_10px_30px_rgba(0,0,0,1)]"
                style={{ 
                  fontSize: 'clamp(1.1rem, 5vw, 2.5rem)', 
                  lineHeight: '1.1',
                  maxWidth: '90%',
                  margin: '0 auto'
                }}
              >
                {posterTitle}
              </h1>
              <div className="h-[1px] w-1/3 mx-auto mt-4 bg-gradient-to-r from-transparent via-[#d4a373]/50 to-transparent" />
            </div>

            {/* קרדיטים תחתונים */}
            <div className="w-full text-center mb-4">
              <p className="text-[#d4a373] font-black uppercase tracking-[0.3em] text-[9px] md:text-[14px] mb-4">
                {credits.comingSoon}
              </p>
              <div className="w-full border-t border-white/20 pt-4 flex flex-col gap-1 font-bold uppercase text-white/90">
                <p className="text-[7px] md:text-[10px] tracking-[0.1em] italic">{credits.line1}</p>
                <p className="text-[6px] md:text-[8px] tracking-[0.1em] opacity-70">{credits.line2}</p>
                <p className="text-[6px] md:text-[8px] tracking-[0.1em] opacity-70 mb-2">{credits.line3}</p>
                <p className="text-[#d4a373]/40 text-[5px] md:text-[7px] tracking-[0.4em] font-black italic">
                  MY-LIFE-SCRIPT.VERCEL.APP
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* כפתורי הפעולה היוקרתיים (זה הזהב שביקשת לשמור) */}
      {!posterLoading && posterUrl && (
        <motion.div 
          initial={{ opacity: 0, y: 15 }} 
          animate={{ opacity: 1, y: 0 }} 
          className="flex flex-row items-center justify-center gap-3 mt-8 pb-10 w-full max-w-[380px] mx-auto px-4"
        >
          <motion.button 
            whileHover={{ scale: 1.02, backgroundColor: "#d4a373", color: "#000" }}
            whileTap={{ scale: 0.95 }}
            onClick={() => {
                handleCapturePoster('download');
                // הוספה: מדידת הורדה בפועל
                if (typeof window !== 'undefined' && window.gtag) {
                  window.gtag('event', 'poster_download_click', {
                    title: posterTitle,
                    genre: genre
                  });
                }
              }}                  
            className="relative flex-[2] flex items-center justify-center gap-2 h-11 bg-[#1a1c20] border border-white/20 text-gray-300 rounded-lg transition-all duration-500 overflow-hidden"
          >
            {/* אפקט הברק (Shiny Sweep) */}
            <motion.div animate={{ left: ['-100%', '200%'] }} transition={{ repeat: Infinity, duration: 3, ease: "linear" }} className="absolute top-0 bottom-0 w-12 bg-gradient-to-r from-transparent via-white/10 to-transparent skew-x-[35deg]" />
            <Download size={16} strokeWidth={2.5} />
            <span className="font-bold text-[10px] tracking-[0.2em] uppercase">{isHebrew ? 'שמור פוסטר' : 'SAVE POSTER'}</span>
          </motion.button>

          <motion.button 
            whileHover={{ scale: 1.05, borderColor: "#d4a373", color: "#d4a373" }}
            whileTap={{ scale: 0.9 }}
            onClick={() => {
                handleCapturePoster('share');
                // הוספה: מדידת לחיצה על שיתוף
                if (typeof window !== 'undefined' && window.gtag) {
                  window.gtag('event', 'poster_share_click', {
                    title: posterTitle,
                    genre: genre
                  });
                }
              }}                  
            className="relative w-11 h-11 flex items-center justify-center bg-[#1a1c20] border border-white/10 text-gray-400 rounded-lg transition-all duration-500"
          >
            <div className="relative">
              <Share2 size={18} strokeWidth={2} />
              <motion.div animate={{ opacity: [0.3, 0.6, 0.3] }} transition={{ duration: 2, repeat: Infinity }} className="absolute inset-0 blur-[4px] text-[#d4a373]">
                <Share2 size={18} strokeWidth={2} />
              </motion.div>
            </div>
          </motion.button>
        </motion.div>
      )}
    </motion.div>
  );
};

export default PosterRenderer;