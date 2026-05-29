/**
 * Single source of truth for all genre metadata.
 * Consumed by: lib/agent.js, components/GenreSelector.jsx,
 *              components/HistoryPanel.jsx, components/ScriptOutput.jsx
 */

export const GENRE_META = {
  drama: {
    key:         'drama',
    label:       { en: 'Drama',    he: 'דרמה'     },
    color:       '#6366f1',
    bg:          'rgba(99,102,241,0.12)',
    border:      'rgba(99,102,241,0.25)',
    chipCls:     'bg-indigo-500/20 text-indigo-400',
    glowColor:   '#6366f1',
    activeClass: 'bg-indigo-600/20 border-indigo-500 shadow-[0_0_30px_rgba(99,102,241,0.3)]',
    textClass:   'text-indigo-400',
  },
  comedy: {
    key:         'comedy',
    label:       { en: 'Comedy',   he: 'קומדיה'   },
    color:       '#f59e0b',
    bg:          'rgba(245,158,11,0.12)',
    border:      'rgba(245,158,11,0.25)',
    chipCls:     'bg-amber-500/20 text-amber-400',
    glowColor:   '#f59e0b',
    activeClass: 'bg-amber-500/20 border-amber-500 shadow-[0_0_30px_rgba(245,158,11,0.3)]',
    textClass:   'text-amber-400',
  },
  action: {
    key:         'action',
    label:       { en: 'Action',   he: 'פעולה'    },
    color:       '#ef4444',
    bg:          'rgba(239,68,68,0.12)',
    border:      'rgba(239,68,68,0.25)',
    chipCls:     'bg-red-500/20 text-red-400',
    glowColor:   '#ef4444',
    activeClass: 'bg-red-600/20 border-red-500 shadow-[0_0_30px_rgba(239,68,68,0.4)]',
    textClass:   'text-red-500',
  },
  'sci-fi': {
    key:         'sci-fi',
    label:       { en: 'Sci-Fi',  he: 'מד"ב'    },
    color:       '#06b6d4',
    bg:          'rgba(6,182,212,0.12)',
    border:      'rgba(6,182,212,0.25)',
    chipCls:     'bg-cyan-500/20 text-cyan-400',
    glowColor:   '#06b6d4',
    activeClass: 'bg-cyan-500/20 border-cyan-500 shadow-[0_0_30px_rgba(6,182,212,0.3)]',
    textClass:   'text-cyan-400',
  },
  horror: {
    key:         'horror',
    label:       { en: 'Horror',   he: 'אימה'     },
    color:       '#10b981',
    bg:          'rgba(16,185,129,0.12)',
    border:      'rgba(16,185,129,0.25)',
    chipCls:     'bg-emerald-500/20 text-emerald-400',
    glowColor:   '#10b981',
    activeClass: 'bg-emerald-900/40 border-emerald-500 shadow-[0_0_30px_rgba(16,185,129,0.2)]',
    textClass:   'text-emerald-500',
  },
  romance: {
    key:         'romance',
    label:       { en: 'Romance',  he: 'רומנטיקה' },
    color:       '#f43f5e',
    bg:          'rgba(244,63,94,0.12)',
    border:      'rgba(244,63,94,0.25)',
    chipCls:     'bg-rose-500/20 text-rose-400',
    glowColor:   '#f43f5e',
    activeClass: 'bg-rose-500/20 border-rose-500 shadow-[0_0_30px_rgba(244,63,94,0.3)]',
    textClass:   'text-rose-400',
  },
};

export const FALLBACK_GENRE_META = {
  key:       '',
  label:     { en: 'Script', he: 'תסריט' },
  color:     '#d4a373',
  bg:        'rgba(212,163,115,0.12)',
  border:    'rgba(212,163,115,0.25)',
  chipCls:   'bg-[#d4a373]/20 text-[#d4a373]',
  glowColor: '#d4a373',
};

/** Returns the metadata for a genre key, falling back to the gold fallback. */
export function getGenreMeta(key) {
  return GENRE_META[key?.toLowerCase().trim()] || FALLBACK_GENRE_META;
}

/** Returns the display label for a genre key in the given language. */
export function getGenreLabel(key, lang = 'en') {
  const meta = getGenreMeta(key);
  return meta.label[lang] || meta.label.en;
}
