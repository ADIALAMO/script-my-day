// Single source of truth for all user-facing strings.
//
// Usage — API routes:
//   import { CODES } from '../../lib/messages.js';
//   return res.status(429).json({ success: false, code: CODES.QUOTA_SCRIPT });
//
// Usage — frontend components:
//   import { getMsg, CODES, isQuotaError } from '../lib/messages.js';
//   const display = getMsg(data.code, lang);

export const CODES = {
  // Quota — hard limits, reset daily
  QUOTA_SCRIPT:    'QUOTA_SCRIPT',
  QUOTA_POSTER:    'QUOTA_POSTER',
  QUOTA_COMIC:     'QUOTA_COMIC',

  // Network — transient, always retryable
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',

  // Server / providers
  SERVER_ERROR:    'SERVER_ERROR',
  EMPTY_RESPONSE:  'EMPTY_RESPONSE',
  PROVIDERS_BUSY:  'PROVIDERS_BUSY', // cascade exhausted → placeholder shown

  // Auth
  ADMIN_REJECTED:  'ADMIN_REJECTED',

  // Tier gates
  NEEDS_ACCOUNT:   'NEEDS_ACCOUNT',  // anonymous user hitting a free-tier feature
  NEEDS_PRO:       'NEEDS_PRO',      // free user hitting a pro-only feature

  // Feature failures — retryable
  SCRIPT_FAIL:     'SCRIPT_FAIL',
  POSTER_FAIL:     'POSTER_FAIL',
  STORYBOARD_FAIL: 'STORYBOARD_FAIL',

  // User input
  INPUT_TOO_SHORT: 'INPUT_TOO_SHORT',

  // Feedback form
  FEEDBACK_FAIL:   'FEEDBACK_FAIL',
};

// isQuota: true  → daily limit hit; show "come back tomorrow" + upgrade nudge, no retry
// isRetryable: true → transient; always show a retry CTA
const MAP = {
  [CODES.QUOTA_SCRIPT]: {
    isQuota: true,
    en: "🎬 That's a wrap for today. You've used your 3 daily scripts — come back tomorrow for your next premiere.",
    he: '🎬 הצילומים של היום הסתיימו. ניצלת 3 תסריטים — נתראה מחר בבכורה הבאה.',
  },
  [CODES.QUOTA_POSTER]: {
    isQuota: true,
    en: "🎬 Your poster quota for today is used up. See you at tomorrow's screening.",
    he: '🎬 הפוסטרים של היום נוצלו. נחזור לסט מחר.',
  },
  [CODES.QUOTA_COMIC]: {
    isQuota: true,
    en: "🎬 You've drawn your last panel for today. The next issue drops tomorrow.",
    he: '🎬 הגיליון של היום הסתיים. החלק הבא יוצא מחר.',
  },
  [CODES.NETWORK_OFFLINE]: {
    isRetryable: true,
    en: 'No internet connection — production halted. Check your network and try again.',
    he: 'אין חיבור לרשת — ההפקה הופסקה. בדוק את החיבור ונסה שוב.',
  },
  [CODES.SERVER_ERROR]: {
    isRetryable: true,
    en: 'Our servers are taking a beat. Try again in a moment.',
    he: 'השרת לוקח רגע. נסה שוב בעוד כמה שניות.',
  },
  [CODES.EMPTY_RESPONSE]: {
    isRetryable: true,
    en: 'The studio went quiet — no output received. Try generating again.',
    he: 'האולפן שתק — לא התקבלה תוצאה. נסה שוב.',
  },
  [CODES.PROVIDERS_BUSY]: {
    isRetryable: true,
    en: 'All image providers are busy right now — try again in a moment.',
    he: 'כל ספקי התמונות עמוסים כרגע. נסה שוב בעוד רגע.',
  },
  [CODES.ADMIN_REJECTED]: {
    en: 'Access code rejected. Double-check your key and try again.',
    he: 'קוד הגישה שגוי. בדוק אותו ונסה שוב.',
  },
  [CODES.NEEDS_ACCOUNT]: {
    en: '🎬 Sign in to unlock this feature — it only takes a second.',
    he: '🎬 התחבר כדי לפתוח את הפיצ׳ר הזה — לוקח שנייה.',
  },
  [CODES.NEEDS_PRO]: {
    en: '🎬 This feature is available on the Pro plan. Upgrade to keep creating.',
    he: '🎬 פיצ׳ר זה זמין במסלול Pro. שדרג כדי להמשיך ליצור.',
  },
  [CODES.SCRIPT_FAIL]: {
    isRetryable: true,
    en: 'Script generation hit a snag. Try again.',
    he: 'יצירת התסריט נתקלה בבעיה. נסה שוב.',
  },
  [CODES.POSTER_FAIL]: {
    isRetryable: true,
    en: 'Poster generation failed. Try again.',
    he: 'הפקת הפוסטר נכשלה. נסה שוב.',
  },
  [CODES.STORYBOARD_FAIL]: {
    isRetryable: true,
    en: "Storyboard generation failed. Let's try that scene again.",
    he: 'יצירת הסטוריבורד נכשלה. ננסה שוב.',
  },
  [CODES.INPUT_TOO_SHORT]: {
    en: 'Your story is too short — write a little more so we can build a script.',
    he: 'הסיפור קצר מדי. כתוב קצת יותר כדי שנוכל לבנות תסריט.',
  },
  [CODES.FEEDBACK_FAIL]: {
    isRetryable: true,
    en: "Message not sent — check your connection and try again.",
    he: 'ההודעה לא נשלחה. בדוק את הרשת ונסה שוב.',
  },
};

/**
 * Returns the user-facing string for a given error code.
 * Falls back to English if lang is not found.
 * Falls back to the raw code string if the code is unknown.
 */
export function getMsg(code, lang = 'en') {
  const entry = MAP[code];
  if (!entry) return code;
  return entry[lang] || entry.en;
}

/** True if this code represents a hard daily quota block (not retryable until reset). */
export function isQuotaError(code) {
  return MAP[code]?.isQuota === true;
}

/** True if this error is transient and a retry CTA makes sense. */
export function isRetryableError(code) {
  return MAP[code]?.isRetryable === true;
}

/**
 * Infer a CODES key from a raw error object returned by a failed fetch.
 * Use as a last resort when the API doesn't return a `code` field.
 */
export function inferCode(err) {
  if (!navigator.onLine || err?.message?.includes('fetch failed')) return CODES.NETWORK_OFFLINE;
  if (err?.message?.includes('401') || err?.message?.toLowerCase().includes('unauthorized')) return CODES.ADMIN_REJECTED;
  if (err?.message?.includes('429')) return CODES.QUOTA_SCRIPT;
  return CODES.SERVER_ERROR;
}
