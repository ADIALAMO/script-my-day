import React from 'react';
import { Film, Languages, Clapperboard } from 'lucide-react';
import LaunchTicket from './LaunchTicket';

export default function Navbar({ lang, onLanguageToggle, historyCount = 0, onHistoryOpen }) {
  return (
    <nav className="sticky top-0 left-0 right-0 z-[100] w-full border-b border-white/10 bg-black/80 backdrop-blur-md overflow-hidden touch-none 
      /* הגבהת ה-Navbar במובייל ודחיפת התוכן לתחתית */
      px-3 pt-14 pb-3 
      /* חזרה למבנה רגיל במסכים גדולים */
      md:pt-4 md:pb-4 md:px-6 
      flex justify-between items-end md:items-center">
      
      {/* צד ימין: לוגו - צמוד לתחתית במובייל */}
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <div className="flex items-center justify-center w-9 h-9 md:w-12 md:h-12 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/20 shadow-lg shrink-0">
          <Film className="text-[#d4a373] w-4 h-4 md:w-6 md:h-6" />
        </div>

        <div className="flex flex-col items-start leading-none">
          <div className="text-[14px] md:text-2xl font-black text-[#d4a373] tracking-tighter italic uppercase leading-[0.8]">
            LIFESCRIPT
          </div>
          <div className="text-white font-[900] uppercase text-[10px] md:text-[18px] tracking-tighter mt-1">
            STUDIO
          </div>
        </div>
      </div>
      
      {/* צד שמאל: כפתורים - צמודים לתחתית במובייל */}
      <div className="flex items-center gap-1.5 md:gap-4 shrink-0">
        <LaunchTicket lang={lang} />

        {/* History trigger */}
        <button
          onClick={onHistoryOpen}
          aria-label={lang === 'he' ? 'ארכיון הפקות' : 'Production archive'}
          className="relative flex items-center justify-center w-8 h-8 md:w-9 md:h-9
            border border-white/15 rounded-xl
            hover:border-[#d4a373]/40 hover:bg-[#d4a373]/8
            transition-all duration-300 shrink-0"
        >
          <Clapperboard
            size={14}
            className="text-[#d4a373]/55 md:w-[15px] md:h-[15px] transition-colors duration-300"
          />
          {historyCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-[3px]
              rounded-full bg-[#d4a373] text-black
              text-[7.5px] font-black leading-none
              flex items-center justify-center">
              {historyCount > 9 ? '9+' : historyCount}
            </span>
          )}
        </button>

        <button
          onClick={onLanguageToggle}
          className="flex items-center gap-1.5 px-2 py-1.5 md:px-4 md:py-2 border border-white/20 rounded-full text-[10px] md:text-[13px] hover:bg-white/10 hover:border-[#d4a373]/30 transition-all text-white font-medium whitespace-nowrap"
        >
          <Languages size={12} className="text-[#d4a373] md:w-[14px]" />
          {lang === 'he' ? 'EN' : 'עב'}
        </button>
      </div>
    </nav>
  );
}