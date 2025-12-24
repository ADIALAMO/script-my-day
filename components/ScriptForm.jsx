import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { 
  Clapperboard, 
  Laugh, 
  Zap, 
  Rocket, 
  Ghost, 
  Heart, 
  Skull, 
  BookOpen,
  Loader2,
  Sparkles
} from 'lucide-react';

const genres = [
  { label: 'דרמה', enLabel: 'Drama', value: 'drama', icon: Clapperboard, color: 'hover:border-blue-500' },
  { label: 'קומדיה', enLabel: 'Comedy', value: 'comedy', icon: Laugh, color: 'hover:border-yellow-500' },
  { label: 'פעולה', enLabel: 'Action', value: 'action', icon: Zap, color: 'hover:border-red-600' },
  { label: 'מד"ב', enLabel: 'Sci-Fi', value: 'sci-fi', icon: Rocket, color: 'hover:border-purple-500' },
  { label: 'אימה', enLabel: 'Horror', value: 'horror', icon: Ghost, color: 'hover:border-green-900' },
  { label: 'רומנטיקה', enLabel: 'Romance', value: 'romance', icon: Heart, color: 'hover:border-pink-500' },
  { label: 'קומיקס', enLabel: 'Comic', value: 'comic', icon: BookOpen, color: 'hover:border-orange-500' },
];

function ScriptForm({ onGenerateScript, loading, lang }) {
  const [journalEntry, setJournalEntry] = useState('');
  const [selectedGenre, setSelectedGenre] = useState('drama');

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (!journalEntry.trim() || loading) return;
    await onGenerateScript(journalEntry, selectedGenre);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      {/* אזור הזנת הטקסט */}
      <div className="group relative">
        <label className="block text-[#d4a373] text-sm font-bold mb-3 uppercase tracking-[0.2em] italic">
          {lang === 'he' ? 'הסיפור הגולמי' : 'The Raw Story'}
        </label>
        <textarea
          id="journalEntry"
          value={journalEntry}
          onChange={(e) => setJournalEntry(e.target.value)}
          disabled={loading}
          className="w-full px-6 py-5 text-lg text-white bg-white/5 border border-white/10 rounded-2xl focus:border-[#d4a373]/50 outline-none transition-all duration-300 resize-none shadow-inner min-h-[200px] disabled:opacity-50"
          placeholder={lang === 'he' ? 'מה קרה היום? תאר את הסצנה...' : 'What happened today? Describe the scene...'}
        />
        <div className="absolute bottom-4 right-4 text-white/20 pointer-events-none group-focus-within:text-[#d4a373]/30 transition-colors">
          <Sparkles size={24} />
        </div>
      </div>

      {/* בחירת ז'אנר - Grid אינטראקטיבי */}
      <div>
        <label className="block text-[#d4a373] text-sm font-bold mb-4 uppercase tracking-[0.2em] italic">
          {lang === 'he' ? 'בחר סגנון קולנועי' : 'Choose Cinematic Style'}
        </label>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
          {genres.map((genre) => {
            const Icon = genre.icon;
            const isSelected = selectedGenre === genre.value;
            return (
              <motion.button
                key={genre.value}
                type="button"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setSelectedGenre(genre.value)}
                disabled={loading}
                className={`flex flex-col items-center justify-center p-4 rounded-xl border-2 transition-all duration-300 ${
                  isSelected 
                    ? 'bg-[#d4a373] border-[#d4a373] text-black shadow-[0_0_20px_rgba(212,163,115,0.4)]' 
                    : `bg-white/5 border-white/5 text-gray-400 ${genre.color}`
                }`}
              >
                <Icon size={24} className={isSelected ? 'text-black' : 'text-inherit'} />
                <span className="text-[10px] font-black uppercase mt-2 tracking-tighter">
                  {lang === 'he' ? genre.label : genre.enLabel}
                </span>
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* כפתור הפעולה המרכזי */}
      <motion.button
        type="submit"
        disabled={loading || !journalEntry.trim()}
        whileHover={!loading ? { scale: 1.02, boxShadow: "0 0 30px rgba(212,163,115,0.3)" } : {}}
        className={`relative w-full py-5 rounded-full font-black text-xl uppercase tracking-[0.3em] transition-all duration-500 overflow-hidden ${
          loading 
            ? 'bg-gray-800 cursor-not-allowed text-gray-500' 
            : 'bg-gradient-to-r from-[#d4a373] via-[#e6ccb2] to-[#d4a373] text-black shadow-xl'
        }`}
      >
        <span className="relative z-10 flex items-center justify-center gap-3">
          {loading ? (
            <>
              <Loader2 className="animate-spin" size={24} />
              {lang === 'he' ? 'בצילומים...' : 'On Set...'}
            </>
          ) : (
            <>
              {lang === 'he' ? 'צור תסריט' : 'Generate Script'}
              <Clapperboard size={22} />
            </>
          )}
        </span>
      </motion.button>
    </form>
  );
}

export default ScriptForm;