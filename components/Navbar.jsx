import React from 'react';
import { Film, Languages } from 'lucide-react';

export default function Navbar({ lang, onLanguageToggle }) {
  return (
    <nav className="p-6 border-b border-white/10 flex justify-between items-center bg-black/50 backdrop-blur-md sticky top-0 z-50">
      <div className="flex items-center gap-2">
        <Film className="text-[#d4a373] w-8 h-8" />
        <div className="text-2xl font-black text-[#d4a373] tracking-tighter italic">
          LIFESCRIPT <span className="text-white font-light">STUDIO</span>
        </div>
      </div>
      
      <div className="flex gap-4">
        <button 
          onClick={onLanguageToggle}
          className="flex items-center gap-2 px-4 py-2 border border-white/20 rounded-full text-sm hover:bg-white/10 transition-all text-white"
        >
          <Languages size={16} />
          {lang === 'he' ? 'English' : 'עברית'}
        </button>
      </div>
    </nav>
  );
}