// Guided tour + "next step" copy. Pure data (no React) so tests can scan it. Every string exists in he AND en.
// Wording must stay free of pricing / plan words — the Android app scans for them (tests/tour.test.js reuses that list).

// `anchor` = the data-tour attribute on a real element. `fixed` = the element is pinned (navbar): never scroll to it.
// Steps whose anchor is missing or not visible are skipped at run time (resolveSteps), so the poster / comic steps only
// appear when the guide is restarted while those buttons are on screen.
export const TOUR_STEPS = [
  {
    id: 'stepper', anchor: 'stepper',
    copy: {
      he: 'שלושה שלבים לסרט אחד: יומן, תסריט, פוסטר. את הבימוי משאירים לך.',
      en: "Three acts, one film: Story, Script, Poster. You're the director.",
    },
  },
  {
    id: 'journal', anchor: 'journal',
    copy: {
      he: 'סצנה ראשונה: ספר מה עבר עליך היום. משפט או שניים מספיקים.',
      en: 'Scene one: tell us about your day. A sentence or two is enough.',
    },
  },
  {
    id: 'genre', anchor: 'genre',
    copy: {
      he: 'בחר ז\'אנר, הוא קובע את האווירה של הסרט.',
      en: 'Pick a genre. It sets the mood of your film.',
    },
  },
  {
    id: 'generate', anchor: 'generate',
    copy: {
      he: 'אמור "אקשן!" וה-AI כותב את התסריט.',
      en: 'Say "Action!" and the AI writes your script.',
    },
  },
  {
    id: 'poster', anchor: 'poster-cta',
    copy: {
      he: 'הפוך את התסריט לפוסטר קולנועי, אפילו עם הפנים שלך.',
      en: 'Turn the script into a movie poster, even starring you.',
    },
  },
  {
    id: 'comic', anchor: 'comic-cta',
    copy: {
      he: 'ואז המשך לקומיקס.',
      en: 'Then continue to a comic storyboard.',
    },
  },
  {
    id: 'guide', anchor: 'guide', fixed: true,
    copy: {
      he: 'הלכת לאיבוד? אפשר להפעיל את ההדרכה שוב מכאן.',
      en: 'Lost? Replay this guide any time from here.',
    },
  },
];

export const TOUR_UI = {
  next: { he: 'הבא', en: 'Next' },
  back: { he: 'חזור', en: 'Back' },
  skip: { he: 'דלג', en: 'Skip' },
  done: { he: 'סיום', en: 'Done' },
  guide: { he: 'הדרכה', en: 'Guide' },
  dialog: { he: 'הדרכה קצרה', en: 'Quick guide' },
  stepOf: { he: (n, total) => `${n} מתוך ${total}`, en: (n, total) => `${n} of ${total}` },
};

// "Next step" pills. `target` = data-tour anchor the pill scrolls to.
export const NEXT_STEPS = {
  journal: { target: 'generate',   he: 'עכשיו מביימים את התסריט', en: 'Now direct your script' },
  script:  { target: 'poster-cta', he: 'עכשיו יוצרים פוסטר',      en: 'Now make your poster' },
  poster:  { target: 'comic-cta',  he: 'הלאה: הופכים לקומיקס',    en: 'Next: turn it into a comic' },
};

export const tourText = (entry, lang) => (lang === 'he' ? entry.he : entry.en);
