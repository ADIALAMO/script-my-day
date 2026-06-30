import React from 'react';
import { motion } from 'framer-motion';

function HeroSection({ lang, onGetStarted }) {
  return (
    <motion.header
      initial={{ opacity: 0, y: -20 }}
      animate={{ opacity: 1, y: 0 }}
      className="text-center mb-6 md:mb-8 relative"
    >
      <div className="relative inline-block mb-4 group">
        {/* הילה חיצונית ופנימית - צומצמו מעט כדי לחסוך מקום אנכי */}
        <div className="absolute inset-[-15px] bg-[#d4a373]/10 blur-[30px] rounded-full opacity-50 pointer-events-none" />
        <div className="absolute inset-4 bg-[#d4a373]/20 blur-[20px] rounded-full pointer-events-none" />

        {/* גודל האייקון נשאר מרשים אך מותאם */}
        <div className="relative z-10 w-20 h-20 md:w-28 md:h-28 mx-auto rounded-[2rem] overflow-hidden border border-[#d4a373]/30 shadow-2xl backdrop-blur-sm bg-black/20 transition-transform duration-700 group-hover:scale-105">
          <img
            src="/icon.png"
            alt="LifeScript Studio Logo"
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      <div className="block mb-4 relative">
        <div className="inline-block px-6 py-1.5 rounded-full border border-[#d4a373]/20 bg-gradient-to-r from-transparent via-[#d4a373]/5 to-transparent backdrop-blur-xl text-[#d4a373] text-[9px] md:text-[10px] font-black tracking-[0.4em] uppercase italic">
          {lang === 'he' ? 'חזון קולנועי' : 'Cinematic Vision'}
        </div>
      </div>

      <h1
        className="text-5xl md:text-[7.5rem] font-black mb-3 bg-gradient-to-b from-[#d4a373] via-[#fefae0] to-[#d4a373] bg-clip-text text-transparent italic tracking-tighter uppercase leading-[0.8] select-none drop-shadow-[0_10px_30px_rgba(212,163,115,0.2)]"
        style={{
          paddingLeft: '0.15em',
          paddingRight: '0.25em',
          paddingTop: '0.05em',
          paddingBottom: '0.05em',
          display: 'inline-block'
        }}
      >
        LIFESCRIPT
      </h1>

      <p className="text-gray-400 text-lg md:text-xl font-light max-w-xl mx-auto leading-tight px-4 opacity-80">
        {lang === 'he' ? 'הפוך את היום שלך לתסריט קולנועי מרתק' : 'Turn your day into a captivating cinematic script'}
      </p>

      {/* Capability hints — the three acts of a LIFESCRIPT production */}
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2 px-4">
        {(lang === 'he'
          ? ['✍️ כתוב תסריט', '🎭 לככב בפוסטר', '🎬 קומיקס + ריל']
          : ['✍️ Write a script', '🎭 Star in the poster', '🎬 Comic + reel']
        ).map((chip) => (
          <span
            key={chip}
            className="px-3 py-1 rounded-full border border-[#d4a373]/15 bg-[#d4a373]/[0.04] text-[#d4a373]/70 text-[10px] md:text-[11px] font-bold tracking-wide whitespace-nowrap"
          >
            {chip}
          </span>
        ))}
      </div>

      {/* Primary CTA */}
      <div className="mt-8 flex justify-center px-4">
        <motion.button
          onClick={onGetStarted}
          whileHover={{ scale: 1.04, boxShadow: '0 0 36px rgba(212,163,115,0.45)' }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 340, damping: 22 }}
          className="relative px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-sm md:text-base text-[#0b0b0f] overflow-hidden"
          style={{
            background: 'linear-gradient(135deg, #d4a373 0%, #e8bc80 45%, #c68b4a 100%)',
            boxShadow: '0 8px 32px rgba(212,163,115,0.28), 0 2px 8px rgba(0,0,0,0.4)',
          }}
        >
          {/* subtle inner sheen */}
          <span
            className="pointer-events-none absolute inset-0 rounded-2xl"
            style={{ background: 'linear-gradient(160deg, rgba(255,255,255,0.18) 0%, transparent 55%)' }}
          />
          <span className="relative z-10">
            {lang === 'he' ? '← הפוך את היום שלך לסרט' : 'Turn Your Day Into a Film →'}
          </span>
        </motion.button>
      </div>
    </motion.header>
  );
}

export default HeroSection;