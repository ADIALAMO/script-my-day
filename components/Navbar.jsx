import React from 'react';
import { Film, Languages } from 'lucide-react';
import LaunchTicket from './LaunchTicket';

export default function Navbar({ lang, onLanguageToggle }) {
  return (
<nav className="px-3 py-4 md:p-6 border-b border-white/10 flex justify-between items-center bg-black/50 backdrop-blur-md sticky top-0 z-50 w-full overflow-x-hidden">   
<div className="flex items-center gap-2 md:gap-4 shrink-1 min-w-0">        {/* האייקון הקולנועי */}
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/20 shadow-lg shrink-0">
          <Film className="text-[#d4a373] w-6 h-6" />
        </div>

        {/* תיבת הלוגו */}
        <div className="flex flex-col items-start">
          <div className="text-lg md:text-2xl font-black text-[#d4a373] tracking-tighter italic leading-[0.6] self-end">
            LIFESCRIPT
          </div>
          <div className="text-white font-[900] uppercase text-[14px] md:text-[18px] tracking-tighter leading-none mt-1">
            STUDIO
          </div>
        </div>
      </div>
      
      {/* הצד השמאלי/ימני של הנאבבר (תלוי שפה) */}
<div className="flex flex-col md:flex-row items-end md:items-center gap-1.5 md:gap-4 shrink-0">        
        {/* כרטיס ההשקה מחליף את הטקסט הישן */}
        <LaunchTicket lang={lang} />

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