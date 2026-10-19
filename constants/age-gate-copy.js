// Guest 18+ notice (shown once, before the first script of a visitor who is not signed in). Every string exists in he AND en; Hebrew is gender-neutral.
// A self-declaration, never "age verification" (tests/native-copy.test.js and tests/age-gate.test.js scan for that).
export const AGE_GATE_COPY = {
  title: { he: 'לפני שממשיכים', en: 'Before you continue' },
  body: {
    he: 'LifeScript מיועדת לבני 18 ומעלה. שירותי ה-AI שבהם אנחנו משתמשים דורשים משתמשים בוגרים, והסיפורים שנוצרים עשויים לכלול נושאים בוגרים.',
    en: 'LifeScript is intended for adults aged 18 and over. The AI services we use require adult users, and generated stories may include mature themes.',
  },
  checkbox: { he: 'אני בן/בת 18 ומעלה', en: 'I am 18 or older' },
  agreeBefore: { he: 'בהמשך אתם מסכימים ל', en: 'By continuing you agree to the ' },
  terms: { he: 'תנאי השימוש', en: 'Terms' },
  and: { he: ' ול', en: ' and ' },
  privacy: { he: 'מדיניות הפרטיות', en: 'Privacy Policy' },
  confirm: { he: 'אישור והמשך', en: 'Confirm and continue' },
  cancel: { he: 'ביטול', en: 'Cancel' },
};
export const ageGateCopy = (key, lang) => AGE_GATE_COPY[key][lang === 'he' ? 'he' : 'en'];
