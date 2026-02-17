import React, { memo } from 'react';
import { motion } from 'framer-motion';
import { Clapperboard, Mic, Crosshair, Atom, Skull, Gem } from 'lucide-react';

// --- תת-רכיבי האנימציה ---
const DramaScene = memo(({ isSelected }) => (
  <motion.div animate={isSelected ? { rotate: [0, -15, 0] } : {}} transition={{ duration: 2, repeat: Infinity }}>
    <Clapperboard size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
));
const ComedyScene = memo(({ isSelected }) => (
  <motion.div animate={isSelected ? { rotate: [-5, 5, -5], scale: [1, 1.1, 1] } : {}} transition={{ duration: 0.5, repeat: Infinity }}>
    <Mic size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
));
const ActionScene = memo(({ isSelected }) => (
  <div className="relative flex items-center justify-center">
    <motion.div animate={isSelected ? { rotate: 360 } : {}} transition={{ duration: 4, repeat: Infinity, ease: "linear" }}>
      <Crosshair size={32} strokeWidth={isSelected ? 2 : 1.5} />
    </motion.div>
    {isSelected && <motion.div animate={{ opacity: [0, 1, 0], scale: [0.5, 1.5, 0.5] }} transition={{ duration: 0.5, repeat: Infinity }} className="absolute w-2 h-2 bg-red-500 rounded-full" />}
  </div>
));
const SciFiScene = memo(({ isSelected }) => (
  <motion.div animate={isSelected ? { rotate: 360, color: ['#06b6d4', '#ffffff', '#06b6d4'] } : {}} transition={{ duration: 3, repeat: Infinity }}>
    <Atom size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
));
const HorrorScene = memo(({ isSelected }) => (
  <motion.div animate={isSelected ? { x: [-2, 2, -2], opacity: [1, 0.7, 1] } : {}} transition={{ duration: 0.2, repeat: Infinity }}>
    <Skull size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
));
const RomanceScene = memo(({ isSelected }) => (
  <motion.div animate={isSelected ? { scale: [1, 1.2, 1] } : {}} transition={{ duration: 2, repeat: Infinity }}>
    <Gem size={32} strokeWidth={isSelected ? 2 : 1.5} />
  </motion.div>
));

const GENRES_DATA = [
  { label: { he: 'דרמה', en: 'Drama' }, value: 'drama', component: DramaScene, activeClass: 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)]', textClass: 'text-indigo-400', glowColor: '#6366f1' },
  { label: { he: 'קומדיה', en: 'Comedy' }, value: 'comedy', component: ComedyScene, activeClass: 'bg-amber-500/20 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]', textClass: 'text-amber-400', glowColor: '#f59e0b' },
  { label: { he: 'פעולה', en: 'Action' }, value: 'action', component: ActionScene, activeClass: 'bg-red-600/20 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)]', textClass: 'text-red-500', glowColor: '#ef4444' },
  { label: { he: 'מד"ב', en: 'Sci-Fi' }, value: 'sci-fi', component: SciFiScene, activeClass: 'bg-cyan-500/20 border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.3)]', textClass: 'text-cyan-400', glowColor: '#06b6d4' },
  { label: { he: 'אימה', en: 'Horror' }, value: 'horror', component: HorrorScene, activeClass: 'bg-emerald-900/40 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.2)]', textClass: 'text-emerald-500', glowColor: '#10b981' },
  { label: { he: 'רומנטיקה', en: 'Romance' }, value: 'romance', component: RomanceScene, activeClass: 'bg-rose-500/20 border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]', textClass: 'text-rose-400', glowColor: '#f43f5e' },
];

export const GenreSelector = memo(({ activeGenre, onGenreChange, isLocked, lang }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 md:gap-4">
      {GENRES_DATA.map((genre) => {
        const Visual = genre.component;
        const isSelected = activeGenre === genre.value;
        return (
          <motion.button
            key={genre.value}
            type="button"
            onClick={() => onGenreChange(genre.value)}
            whileHover={!isLocked ? { y: -4, scale: 1.02 } : {}}
            whileTap={!isLocked ? { scale: 0.96 } : {}}
            disabled={isLocked}
            className={`relative flex flex-col items-center justify-between h-28 md:h-32 p-4 rounded-2xl border transition-all duration-500 overflow-hidden ${
              isSelected ? genre.activeClass : 'bg-white/5 border-white/5 hover:border-white/20 hover:bg-white/10'
            } ${isLocked ? 'opacity-40 grayscale-[0.8] cursor-not-allowed pointer-events-none' : ''}`}
          >
            <div className={`mt-2 transition-all duration-500 ${isSelected ? `${genre.textClass} scale-110 drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]` : 'text-gray-500 grayscale opacity-70'}`}>
              <Visual isSelected={isSelected} />
            </div>
            <span className={`text-[9px] md:text-[10px] font-black uppercase tracking-widest z-10 ${isSelected ? 'text-white' : 'text-gray-600'}`}>
              {lang === 'he' ? genre.label.he : genre.label.en}
            </span>
            {isSelected && (
              <motion.div layoutId="activeInd" className="absolute bottom-0 w-full h-1" style={{ backgroundColor: genre.glowColor }} />
            )}
          </motion.button>
        );
      })}
    </div>
  );
});