// Overwrite confirmation for "Create script" when a script is already on screen. Pure data (tests scan it). Every string exists in he AND en.
// What it lists is what the code does (pages/index.js handleGenerateScript): the screen is cleared (script, poster, comic, reel); History keeps the old entry with what was
// saved to it (script text and edits, a poster that reached storage, comic frames that were generated); a reel is never saved; the journal text in the form stays.
export const REPLACE_SCRIPT_COPY = {
  title: { he: 'להחליף את התסריט הנוכחי?', en: 'Replace the current script?' },
  lead: {
    he: 'יצירת תסריט חדש מחליפה את התסריט שעל המסך.',
    en: 'Creating a new script replaces the one on your screen.',
  },
  clears: {
    he: 'יימחקו מהמסך: התסריט, הפוסטר, הקומיקס והריל שנוצרו ממנו.',
    en: 'Cleared from the screen: the script and the poster, comic and reel made from it.',
  },
  keeps: {
    he: 'נשמר בהיסטוריה: התסריט (כולל עריכות), פוסטר וקומיקס שכבר נשמרו. ריל לא נשמר ולא ניתן לשחזר אותו. הטקסט ביומן נשאר בטופס.',
    en: 'Kept in History: the script (with your edits) and any poster or comic already saved. A reel is not saved and cannot be restored. Your journal text stays in the form.',
  },
  uses: {
    he: 'התסריט החדש נספר במכסת התסריטים שלך.',
    en: 'The new script counts toward your scripts.',
  },
  cancel: { he: 'ביטול', en: 'Cancel' },
  confirm: { he: 'כן, צור תסריט חדש', en: 'Yes, create a new script' },
  lockedLabel: { he: 'התסריט נכתב…', en: 'Writing your script…' },
};
export const replaceCopy = (key, lang) => REPLACE_SCRIPT_COPY[key][lang === 'he' ? 'he' : 'en'];
