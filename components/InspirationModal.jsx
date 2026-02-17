import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export const InspirationModal = ({ isOpen, onClose, onSelect, lang, isLocked }) => {
  const examples = lang === 'he' ? [
    { emoji: "🎭", label: "דרמה", short: "היום שהכל השתנה...", full: "היום התחיל בשתיקה כבדה ליד שולחן ארוחת הבוקר. מבט אחד מקרי הבהיר ששום דבר כבר לא יחזור להיות כפי שהיה פעם, והסודות המודחקים מתחילים לצוף." },
    { emoji: "❤️", label: "רומנטיקה", short: "מבט מקרי בגשם...", full: "זה התחיל במבט מקרי בבית הקפה השכונתי תחת הגשם השוטף. הרגשתי שהלב שלי פועם בקצב לא מוכר כשהיא חייכה אלי, ופתאום כל רעשי העולם נעלמו והפכו למוזיקה עדינה." },
    { emoji: "👽", label: "מד״ב", short: "השמיים הפכו סגולים...", full: "השמיים הפכו סגולים זרחניים וחללית ענקית הופיעה מעל קו הרקיע של העיר. הרובוטים החלו לרדת אל הרחובות כשהם נושאים טכנולוגיה זרה שמשנה את חוקי הפיזיקה המוכרים לנו." },
    { emoji: "😱", label: "אימה", short: "צעקה מהקומה למעלה...", full: "הדלת נפתחה בחריקה צורמת אל תוך חושך מוחלט שבו הריח של העבר עמד באוויר. פתאום נשמעה צעקה חנוקה מהקומה העליונה וצל שחור נע במהירות בקצה המסדרון." }
  ] : [
    { emoji: "🎭", label: "Drama", short: "The day it all changed...", full: "The day began with a heavy silence at the breakfast table. One chance look made it clear that nothing would ever be the same again, as suppressed secrets began to surface." },
    { emoji: "❤️", label: "Romance", short: "A glance in the rain...", full: "It started with a chance glance in a cozy coffee shop during a downpour. I felt my heart beat in an unfamiliar rhythm when she smiled at me, and the world's noise vanished." },
    { emoji: "👽", label: "Sci-Fi", short: "Purple neon skies...", full: "The sky turned a glowing purple as a massive ship appeared over the skyline. Robots began to descend into the streets, bringing alien technology that defies the laws of physics." },
    { emoji: "😱", label: "Horror", short: "A scream from above...", full: "The door creaked open into total darkness where the scent of the past hung heavy. Suddenly, a muffled scream echoed from upstairs and a dark shadow darted across the hallway." }
  ];

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <div className="fixed inset-0 z-[140] bg-transparent" onClick={onClose} />
          <motion.div 
            initial={{ opacity: 0, x: lang === 'he' ? 10 : -10, scale: 0.95 }} 
            animate={{ opacity: 1, x: 0, scale: 1 }} 
            exit={{ opacity: 0, x: lang === 'he' ? 10 : -10, scale: 0.95 }}
            className="absolute left-0 right-0 mx-auto bottom-[-55px] z-[150] w-[260px] md:w-[280px] bg-[#0a0a0a]/90 backdrop-blur-3xl border border-[#d4a373]/30 p-2 rounded-[1.5rem] shadow-[0_10px_40px_rgba(0,0,0,0.8)] pointer-events-auto"
          >
            <div className="flex flex-col gap-1">
              {examples.map((example, index) => (
                <button
                  key={index}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(example.full);
                    onClose();
                  }}
                  className="flex items-center gap-2.5 w-full p-2 rounded-xl bg-white/[0.02] hover:bg-[#d4a373]/20 border border-transparent hover:border-[#d4a373]/30 transition-all duration-300 group/item text-right"
                >
                  <span className="text-sm flex-shrink-0 group-hover/item:scale-110 transition-transform">{example.emoji}</span>
                  <div className="flex flex-col items-start overflow-hidden text-start">
                    <span className="text-[8px] font-black text-[#d4a373] uppercase tracking-tighter">{example.label}</span>
                    <span className="text-[9px] text-white/50 truncate w-full">{example.short}</span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
};