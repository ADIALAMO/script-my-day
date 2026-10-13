// Comic frame / resume copy (he + en). Pure data so tests can scan it; no pricing / plan / upgrade wording (the Android app scans for it).
export const COMIC_COPY = {
  frameFailed: { he: 'הפריים לא נטען', en: "Frame didn't load" },
  retryFrame: { he: 'נסה שוב את הפריים', en: 'Retry this frame' },
  retrying: { he: 'מנסה שוב...', en: 'Retrying...' },
  sessionExpiredTile: { he: 'ההפקה של הקומיקס פגה', en: "This comic's session expired" },
  newComic: { he: 'צור קומיקס חדש', en: 'Make a new comic' },
  generateMissing: { he: 'צור את הפריימים החסרים', en: 'Generate missing frames' },
  missingBanner: {
    he: (n) => `${n} פריימים לא נטענו. אפשר לנסות שוב.`,
    en: (n) => `${n} frames didn't load. You can try again.`,
  },
  sessionExpiredBanner: {
    he: 'אי אפשר להמשיך את הקומיקס הזה. אפשר ליצור קומיקס חדש כדי לקבל את הפריימים החסרים.',
    en: "This comic can't be resumed any more. Make a new one to get the missing frames.",
  },
};
export const comicText = (entry, lang, ...args) => {
  const v = lang === 'he' ? entry.he : entry.en;
  return typeof v === 'function' ? v(...args) : v;
};
