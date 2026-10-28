// Messages for a photo the browser cannot open (CharacterModal.handleFile). Hebrew is masculine singular, like lib/messages.js.
// No price / plan / upgrade wording (native-app policy, tests/native-copy.test.js). The native variant drops the "open in Safari" clause (it makes no sense in the Android app).
const COPY = {
  heic: {
    en: "This photo is in HEIC format, which this browser can't open. Export it as a JPG or PNG (Photos on Mac: File → Export), open LifeScript in Safari, or choose another photo.",
    he: "התמונה הזו בפורמט HEIC, שהדפדפן הזה לא מצליח לפתוח. ייצא אותה כ-JPG או PNG (באפליקציית 'תמונות' ב-Mac: קובץ ← ייצוא), פתח את LifeScript ב-Safari, או בחר תמונה אחרת.",
  },
  heicNative: {
    en: "This photo is in HEIC format, which can't be opened here. Convert it to a JPG or PNG, or choose another photo.",
    he: 'התמונה הזו בפורמט HEIC, שלא ניתן לפתוח כאן. המר אותה ל-JPG או PNG, או בחר תמונה אחרת.',
  },
  decode_failed: {
    en: "We couldn't open this photo. Please try a JPG or PNG photo (or take a new one).",
    he: 'לא הצלחנו לפתוח את התמונה. נסה תמונה בפורמט JPG או PNG (או צלם תמונה חדשה).',
  },
};

/** kind: 'heic' | 'decode_failed' */
export function characterFileMessage(kind, isHebrew, native = false) {
  const entry = kind === 'heic' ? COPY[native ? 'heicNative' : 'heic'] : COPY.decode_failed;
  return isHebrew ? entry.he : entry.en;
}
export const CHARACTER_FILE_COPY = COPY;
