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

        {/* תיבת הלוגו - מיושרת לשמאל כדי שהטקסט יבלוט ימינה לאייקון */}
        <div className="flex flex-col items-start">
          {/* שורה ראשונה - מוסטת שמאלה */}
          <div className="text-2xl font-black text-[#d4a373] tracking-tighter italic leading-[0.6] self-end">
            LIFESCRIPT
          </div>
          
          {/* שורה שנייה - STUDIO - צמודה לימין (לאייקון) ובולטת מעבר ללוגו */}
          <div className="text-white font-[900] uppercase text-[18px] tracking-tighter leading-none mt-1">
            STUDIO
          </div>
        </div>
      </div>
      
      <div className="flex gap-4">
        <button 
          onClick={onLanguageToggle}
          className="flex items-center gap-2 px-4 py-2 border border-white/20 rounded-full text-[13px] hover:bg-white/10 transition-all text-white font-medium"
        >
          <Languages size={14} />
          {lang === 'he' ? 'English' : 'עברית'}
        </button>
      </div>
    </nav>
  );
}