"use client";
import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { Ticket, X, Star } from "lucide-react";

export default function LaunchTicket({ lang = 'he' }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const isHe = lang === 'he';

  useEffect(() => {
    setMounted(true);
  }, []);

  const content = {
    badge: isHe ? "סטטוס הפקה" : "Production Status",
    title: isHe ? "עדכון מהסט" : "Production Update",
    desc: isHe 
      ? "בונוס ההשקה הסתיים, אך אנחנו כבר בחדר העריכה עובדים על הפתעות חדשות."
      : "The launch bonus has ended, but we're already in the editing room working on new surprises.",
    benefit: isHe ? "🎬 נצלו את המכסה היומית בתבונה" : "🎬 Use your daily quota wisely",
    button: isHe ? "חזרה לצילומים" : "Back to Set"
  };

  // הכפתור שנשאר בתוך ה-Navbar
  const triggerButton = (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(true);
      }}
      className="relative z-10 flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 hover:border-amber-500/40 transition-all duration-300 active:scale-95 cursor-pointer"
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-amber-500"></span>
      </span>
      <Star size={14} className="text-amber-500" fill="currentColor" />
      <span className="text-[9px] md:text-[10px] font-black tracking-[0.1em] text-amber-500 uppercase italic whitespace-nowrap">
                {content.badge}
      </span>
    </button>
  );

  // המודל שיוצג מחוץ ל-Navbar (בתחתית ה-Body)
  const modalContent = isOpen && (
<div className="fixed inset-0 z-[999999] flex items-center justify-center px-4 pointer-events-none">      {/* רקע כהה - ללא טשטוש למניעת באגים */}
      <div 
        className="fixed inset-0 bg-black/80 pointer-events-auto" 
        onClick={() => setIsOpen(false)} 
      />
      
      {/* גוף החלונית - קטנה וקרובה לאינפוט */}
      <div 
        className="relative bg-[#0a0a0a] border border-amber-500/30 rounded-2xl p-5 max-w-[280px] w-full shadow-[0_0_50px_rgba(0,0,0,1)] text-center animate-in slide-in-from-bottom-8 duration-300 pointer-events-auto"
        dir={isHe ? 'rtl' : 'ltr'}
      >
        <button 
          onClick={() => setIsOpen(false)} 
          className={`absolute top-3 text-zinc-500 hover:text-zinc-300 ${isHe ? 'left-3' : 'right-3'}`}
        >
          <X size={16} />
        </button>

        <div className="flex justify-center mb-2">
          <div className="p-1.5 bg-amber-500/10 rounded-full border border-amber-500/20">
            <Star size={18} className="text-amber-500" fill="currentColor" />
          </div>
        </div>

        <h3 className="text-base font-black text-zinc-100 mb-1 uppercase italic font-heebo">
          {content.title}
        </h3>
        
        <p className="text-[11px] text-zinc-400 mb-3 font-light leading-snug font-heebo">
          {content.desc}
        </p>
        
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg py-1.5 mb-4 text-amber-500 text-[9px] font-black uppercase tracking-widest font-heebo">
          {content.benefit}
        </div>

        <button 
          onClick={() => setIsOpen(false)} 
          className="w-full py-2.5 bg-zinc-100 hover:bg-white text-black text-[11px] font-black rounded-lg uppercase active:scale-95 transition-transform font-heebo shadow-lg"
        >
          {content.button}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {triggerButton}
      {mounted && isOpen && createPortal(modalContent, document.body)}
    </>
  );
}