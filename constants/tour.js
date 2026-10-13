// Guided tour chapters + "next step" copy. Pure data (no React) so tests can scan it. Every string exists in he AND en.
// Wording must stay free of pricing / plan / upgrade / offer words — the Android app scans for them (tests/tour.test.js reuses that list).
//
// A step points at the FIRST usable `data-tour` anchor in `anchors` (several = fallbacks). `fixed` = pinned element (navbar): never scroll to it.
// `wait` = ms the step waits for its anchor to appear (it is not on screen yet) before it is dropped silently.
// `interactive` = the spotlighted control stays clickable (the tour never blocks the one control it explains).
// A step whose anchor vanishes while shown (e.g. the typewriter's Skip once typing ends) is dropped silently and the chapter continues.
// `stage` = the screen a chapter needs to have been reached ('script' | 'poster' | 'comic'; null = always). The Guide menu starts the chapter
// when the stage was reached (on screen or earlier in this session), otherwise it says what to do first (`unavailable` label, `note` sentence).
export const CHAPTERS = [
  {
    id: 1, name: { he: 'סיפור', en: 'Story' }, stage: null,
    unavailable: { he: '', en: '' }, note: { he: '', en: '' },
    steps: [
      { id: 'spark', anchors: ['spark'], copy: {
        he: 'תקוע? "הצתת השראה" ממלאת את הדף ברעיון להתחלה.',
        en: 'Stuck? Spark Inspiration fills the page with a starter story.' } },
      { id: 'journal', anchors: ['journal'], copy: {
        he: 'סצנה ראשונה: ספר מה עבר עליך היום. משפט או שניים מספיקים.',
        en: 'Scene one: tell us about your day. A sentence or two is enough.' } },
      { id: 'genre', anchors: ['genre'], copy: {
        he: 'בחר ז\'אנר, הוא קובע את האווירה של הסרט.',
        en: 'Pick a genre. It sets the mood of your film.' } },
      { id: 'creator', anchors: ['creator'], copy: {
        he: 'לא חובה: שמך יופיע בקרדיטי הפוסטר ובפתיח התסריט.',
        en: 'Optional: your name appears in the poster credits and script header.' } },
      { id: 'generate', anchors: ['generate'], copy: {
        he: 'אמור "אקשן!" וה-AI כותב את התסריט.',
        en: 'Say "Action!" and the AI writes your script.' } },
      { id: 'guide', anchors: ['guide'], fixed: true, copy: {
        he: 'הלכת לאיבוד? אפשר להפעיל את ההדרכה שוב מכאן.',
        en: 'Lost? Replay this guide any time from here.' } },
    ],
  },
  {
    id: 2, name: { he: 'תסריט', en: 'Script' }, stage: 'script',
    unavailable: { he: 'זמין אחרי שתיצור תסריט', en: 'Available after you make a script' },
    note: { he: 'ההדרכה הזו מתחילה אחרי שתיצור את התסריט הראשון שלך.', en: 'This guide starts after you create your first script.' },
    steps: [
      // The typewriter's SKIP only completes the animation (shows the whole script at once) — nothing more.
      { id: 'skip-typing', anchors: ['skip-typing'], interactive: true, copy: {
        he: 'לוקח זמן? "דלג" מציג את כל התסריט מיד.',
        en: 'Too slow? Skip shows the whole script at once.' } },
      { id: 'edit', anchors: ['edit-review', 'edit'], wait: 60000, copy: {
        he: 'רוצה לשנות שורה? "עריכה" הופכת את התסריט לטקסט שאפשר לשכתב ולשמור.',
        en: 'Want a different line? Edit turns the script into text you can rewrite and keep.' } },
      // The star area holds "Cast yourself" until a face is added; after that it holds the on/off switch (and a remove button).
      { id: 'star', anchors: ['star'], wait: 4000, copy: {
        he: 'הוסף את הפנים שלך כדי לככב בפוסטר, או כבה את זה כדי לקבל פוסטר בלעדיך.',
        en: 'Add your face to star in your poster, or switch it off to keep the poster without you.' } },
      { id: 'poster', anchors: ['poster-cta'], wait: 4000, copy: {
        he: 'ואז מצלמים: לחיצה אחת ויוצרת את הפוסטר.',
        en: 'Then roll the camera: one tap makes your poster.' } },
    ],
  },
  {
    id: 3, name: { he: 'פוסטר', en: 'Poster' }, stage: 'poster',
    unavailable: { he: 'זמין אחרי שתיצור פוסטר', en: 'Available after you make a poster' },
    note: { he: 'ההדרכה הזו מתחילה אחרי שתיצור את הפוסטר הראשון שלך.', en: 'This guide starts after you create your first poster.' },
    steps: [
      { id: 'poster-share', anchors: ['poster-share'], wait: 4000, copy: {
        he: 'אהבת? שתף או שמור את הפוסטר.',
        en: 'Love it? Share or save your poster.' } },
      { id: 'comic-style', anchors: ['comic-style'], wait: 4000, copy: {
        he: 'בחר מראה לקומיקס: אנימה, רטרו, נואר או ציור.',
        en: 'Pick a look for the comic: Anime, Retro, Noir or Painted.' } },
      { id: 'comic', anchors: ['comic-cta'], wait: 4000, copy: {
        he: 'ואז הופכים את הסיפור לקומיקס.',
        en: 'Then turn the story into a comic.' } },
    ],
  },
  {
    id: 4, name: { he: 'קומיקס', en: 'Comic' }, stage: 'comic',
    unavailable: { he: 'זמין אחרי שתיצור קומיקס', en: 'Available after you make a comic' },
    note: { he: 'ההדרכה הזו מתחילה אחרי שתיצור את הקומיקס הראשון שלך.', en: 'This guide starts after you create your first comic.' },
    steps: [
      // Replace re-renders ONE finished, unlocked panel (the old image stays if the new one fails); the budget is shared across the
      // whole comic (server value, default 2) and the button itself shows how many are left. It lives in a hover/tap bar on the panel.
      { id: 'replace', anchors: ['comic-panel'], wait: 4000, copy: {
        he: 'לא אהבת פאנל? רחף או הקש עליו: "החלף" מביא תמונה חדשה ומראה כמה החלפות נותרו.',
        en: "Don't like a panel? Hover or tap it: Replace brings a fresh image and shows how many are left." } },
      { id: 'reel', anchors: ['reel-cta'], wait: 4000, copy: {
        he: 'הופכים את הקומיקס לריל קצר.',
        en: 'Turn your comic into a short reel.' } },
      { id: 'history', anchors: ['history'], fixed: true, copy: {
        he: 'כל סרט שיצרת נשמר במכשיר הזה.',
        en: 'Every film you make is saved on this device.' } },
      { id: 'report', anchors: ['report-panel', 'comic-result'], wait: 4000, copy: {
        he: 'משהו לא נראה לך? דווח כאן.',
        en: "Something doesn't look right? Report it here." } },
    ],
  },
];

export const MILESTONE_CHAPTER = { 'typing-start': 2, 'poster-done': 3, 'comic-done': 4 };

export const TOUR_UI = {
  next: { he: 'הבא', en: 'Next' },
  back: { he: 'חזור', en: 'Back' },
  skip: { he: 'דלג על ההדרכה', en: 'Skip tour' },
  done: { he: 'סיום', en: 'Done' },
  guide: { he: 'הדרכה', en: 'Guide' },
  dialog: { he: 'הדרכה קצרה', en: 'Quick guide' },
  menuTitle: { he: 'בחר פרק', en: 'Pick a chapter' },
  chapterLabel: { he: (n, k, m) => `פרק ${n} · ${k} מתוך ${m}`, en: (n, k, m) => `Chapter ${n} · ${k} of ${m}` },
};

// "Next step" pills. `target` = data-tour anchor the pill scrolls to.
export const NEXT_STEPS = {
  journal: { target: 'generate',   he: 'עכשיו מביימים את התסריט', en: 'Now direct your script' },
  script:  { target: 'poster-cta', he: 'עכשיו יוצרים פוסטר',      en: 'Now make your poster' },
  poster:  { target: 'comic-cta',  he: 'הלאה: הופכים לקומיקס',    en: 'Next: turn it into a comic' },
};

export const tourText = (entry, lang) => (lang === 'he' ? entry.he : entry.en);
export const chapterById = (id) => CHAPTERS.find((c) => c.id === id);
