import React from 'react';
import { Film, Languages } from 'lucide-react';

export default function Navbar({ lang, onLanguageToggle }) {
  return (
    <nav className="p-6 border-b border-white/10 flex justify-between items-center bg-black/50 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-4">
        {/* האייקון הקולנועי - נקודת העיגון מימין */}
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/20 shadow-lg shrink-0">
          <Film className="text-[#d4a373] w-6 h-6" />
        </div>

        {/* תיבת הלוגו */}
        <div className="flex flex-col items-start">
          <div className="text-2xl font-black text-[#d4a373] tracking-tighter italic leading-[0.6] self-end">
            LIFESCRIPT
          </div>
          <div className="text-white font-[900] uppercase text-[18px] tracking-tighter leading-none mt-1">
            STUDIO
          </div>
        </div>
      </div>
      
      <div className="flex flex-col md:flex-row items-end md:items-center gap-2 md:gap-4">
        
        {/* תגית הבלעדיות - עכשיו תהיה מעל הכפתור במובייל */}
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#d4a373]/20 bg-[#d4a373]/5 backdrop-blur-xl group hover:border-[#d4a373]/40 transition-all duration-500">
          <span className="relative flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#d4a373] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#d4a373]"></span>
          </span>
          <span className="text-[9px] md:text-[10px] font-black tracking-[0.15em] text-[#d4a373] uppercase italic selection:bg-transparent whitespace-nowrap">
            {lang === 'he' ? 'גישת בטא מוגבלת' : 'Limited Beta Access'}
          </span>
        </div>

        {/* כפתור החלפת שפה */}
        <button 
          onClick={onLanguageToggle}
          className="flex items-center gap-2 px-4 py-2 border border-white/20 rounded-full text-[13px] hover:bg-white/10 hover:border-[#d4a373]/30 transition-all text-white font-medium whitespace-nowrap"
        >
          <Languages size={14} className="text-[#d4a373]" />
          {lang === 'he' ? 'English' : 'עברית'}
        </button>
      </div>
    </nav>
  );
}