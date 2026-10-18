// Pro waitlist form copy (he + en). Hebrew is deliberately gender-neutral (plural / infinitive forms).
// WAITLIST_CONSENT_VERSION (lib/waitlist.js) must be bumped when the purpose sentence changes in substance.
// No price, no payment provider. The waitlist modal is unreachable inside the Android app (openAuthModal('upgrade') is a no-op there).

export const WAITLIST_COPY = {
  // "<before><link><after>" — the link target is /data-deletion
  purpose: {
    en: { before: 'We use your email only to tell you when Pro is available. You can ask us to remove it at any time — see ', link: 'Data deletion', after: '.' },
    he: { before: 'נשתמש באימייל שלך רק כדי לעדכן אותך כש-Pro יהיה זמין. אפשר לבקש להסיר אותו בכל עת — ראו ', link: 'מחיקת נתונים', after: '.' },
  },
  errors: {
    invalid:     { en: 'Please enter a valid email address.', he: 'נא להזין כתובת אימייל תקינה.' },
    unavailable: { en: "We couldn't save that right now. Please try again in a moment.", he: 'לא הצלחנו לשמור כרגע. נסו שוב בעוד רגע.' },
    rateLimited: { en: 'Too many attempts. Please try again later.', he: 'יותר מדי ניסיונות. נסו שוב מאוחר יותר.' },
    generic:     { en: 'Something went wrong. Please try again.', he: 'משהו השתבש. נסו שוב.' },
  },
};

// One extra line on the /data-deletion form for people who joined the waitlist without an account (web only; hidden in the app).
export const DATA_DELETION_WAITLIST_LINE = {
  en: "Joined the Pro waitlist without an account? Enter the same email address and we'll remove that sign-up too.",
  he: 'נרשמתם לרשימת ההמתנה בלי חשבון? הזינו את אותה כתובת אימייל ונסיר גם את ההרשמה הזו.',
};
