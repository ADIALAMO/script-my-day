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
  QUOTA_COMIC_MONTH: 'QUOTA_COMIC_MONTH', // Free comics reset MONTHLY
  QUOTA_COMIC_PRO_MONTH: 'QUOTA_COMIC_PRO_MONTH', // Pro monthly comic cap
  QUOTA_PANEL_REGEN: 'QUOTA_PANEL_REGEN', // replacements for this comic used up (server-enforced)
  QUOTA_PANEL_DAILY: 'QUOTA_PANEL_DAILY', // per-user daily panel-image cap
  COMIC_SESSION_EXPIRED: 'COMIC_SESSION_EXPIRED', // panel request for a comic that is unknown/expired/not yours

  // Quota — GUEST (anonymous) variants. Same hard block, but the CTA is "sign in for a
  // renewing daily quota" instead of "come back tomorrow". The anonymous poster is a
  // LIFETIME taste (one only), so its message nudges signup — and the selfie behind it.
  QUOTA_SCRIPT_PRO: 'QUOTA_SCRIPT_PRO', // Pro daily script cap
  QUOTA_SCRIPT_PRO_MONTH: 'QUOTA_SCRIPT_PRO_MONTH', // Pro monthly script cap
  GUEST_CAPACITY_REACHED: 'GUEST_CAPACITY_REACHED', // global daily guest-script budget used up
  QUOTA_SCRIPT_GUEST: 'QUOTA_SCRIPT_GUEST',
  QUOTA_POSTER_GUEST: 'QUOTA_POSTER_GUEST',
  QUOTA_IDENTITY:  'QUOTA_IDENTITY', // character-image credits — reset MONTHLY
  IDENTITY_LIFETIME_USED: 'IDENTITY_LIFETIME_USED', // free one-time identity poster already spent — upgrade nudge
  QUOTA_SHEET:     'QUOTA_SHEET',     // character-sheet uploads — per-user, reset MONTHLY (message takes {limit}, {reset})
  IMAGE_BUDGET_REACHED: 'IMAGE_BUDGET_REACHED', // global daily image spend cap hit and no free provider could serve the request
  IDENTITY_BUDGET_REACHED: 'IDENTITY_BUDGET_REACHED', // global daily identity spend cap hit — feature paused for everyone

  // Content safety
  SAFETY_REJECTED: 'SAFETY_REJECTED', // uploaded selfie failed moderation

  // Network — transient, always retryable
  NETWORK_OFFLINE: 'NETWORK_OFFLINE',

  // Server / providers
  SERVER_ERROR:    'SERVER_ERROR',
  EMPTY_RESPONSE:  'EMPTY_RESPONSE',
  PROVIDERS_BUSY:  'PROVIDERS_BUSY', // cascade exhausted → placeholder shown
  RATE_LIMITED:    'RATE_LIMITED',   // sliding-window limiter (lib/rate-limit.js), not a quota block

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
  CONSENT_REQUIRED: 'CONSENT_REQUIRED', // biometric face upload without the required consent

  // Feedback form
  FEEDBACK_FAIL:   'FEEDBACK_FAIL',
};

// isQuota: true  → daily limit hit; show "come back tomorrow" + upgrade nudge, no retry
// isRetryable: true → transient; always show a retry CTA
const MAP = {
  [CODES.QUOTA_SCRIPT]: {
    isQuota: true,
    en: "🎬 That's a wrap for today. You've used all of your daily scripts — come back tomorrow for your next premiere.",
    he: '🎬 הצילומים של היום הסתיימו. ניצלת את כל התסריטים היומיים — נתראה מחר בבכורה הבאה.',
  },
  [CODES.QUOTA_SCRIPT_PRO]: {
    isQuota: true,
    en: "🎬 You've reached today's script limit on your Pro plan. It resets at midnight UTC — see you at the next premiere.",
    he: '🎬 הגעת למכסת התסריטים היומית במסלול Pro. היא מתאפסת בחצות (UTC) — נתראה בבכורה הבאה.',
  },
  [CODES.QUOTA_SCRIPT_PRO_MONTH]: {
    isQuota: true,
    en: "🎬 You've used all the scripts included in your Pro plan this month. The quota renews on the 1st of next month (UTC).",
    he: '🎬 ניצלת את כל התסריטים הכלולים במסלול Pro שלך החודש. המכסה מתחדשת ב-1 לחודש הבא (UTC).',
  },
  [CODES.GUEST_CAPACITY_REACHED]: {
    isQuota: true,
    en: '🎬 Guest screenings are full for today. Sign in with your email to keep creating — it only takes a moment, and it\'s free.',
    he: '🎬 האולם של האורחים מלא להיום. התחבר עם המייל כדי להמשיך ליצור — זה לוקח רגע ובחינם.',
  },
  [CODES.QUOTA_SCRIPT_GUEST]: {
    isQuota: true,
    en: '🎬 Guest quota reached. Sign in with your email for a bigger renewing quota — scripts, posters & comics, free.',
    he: '🎬 נגמרה המכסה לאורחים. התחבר עם המייל וקבל מכסה מתחדשת גדולה יותר — תסריטים, פוסטרים וקומיקס, בחינם.',
  },
  [CODES.QUOTA_POSTER]: {
    isQuota: true,
    en: "🎬 Your poster quota for today is used up. See you at tomorrow's screening.",
    he: '🎬 הפוסטרים של היום נוצלו. נחזור לסט מחר.',
  },
  [CODES.QUOTA_POSTER_GUEST]: {
    isQuota: true,
    en: "🎬 You've used your free guest poster. Sign in free for a renewing daily quota — and to star with your own face in the poster.",
    he: '🎬 ניצלת את פוסטר האורח החינמי שלך. התחבר בחינם וקבל מכסה יומית מתחדשת — וגם פוסטר שאתה מככב בו עם הפנים שלך.',
  },
  [CODES.QUOTA_COMIC]: {
    isQuota: true,
    en: "🎬 You've drawn your last comic for today. The next issue drops tomorrow.",
    he: '🎬 הגיליון של היום הסתיים. החלק הבא יוצא מחר.',
  },
  [CODES.QUOTA_COMIC_MONTH]: {
    isQuota: true,
    en: "🎬 You've used your free comics for this month. They refresh on the 1st — or go Pro for a fresh comic every day.",
    he: '🎬 ניצלת את הקומיקסים החינמיים של החודש. הם מתחדשים ב-1 לחודש — או עבור ל-Pro לקומיקס חדש בכל יום.',
  },
  [CODES.QUOTA_COMIC_PRO_MONTH]: {
    isQuota: true,
    en: "🎬 You've used all the comics included in your Pro plan this month. The quota renews on the 1st of next month (UTC).",
    he: '🎬 ניצלת את כל הקומיקסים הכלולים במסלול Pro שלך החודש. המכסה מתחדשת ב-1 לחודש הבא (UTC).',
  },
  [CODES.QUOTA_PANEL_REGEN]: {
    isQuota: true,
    en: "🎬 You've used all the image replacements for this comic.",
    he: '🎬 ניצלת את כל החלפות התמונות של הקומיקס הזה.',
  },
  [CODES.QUOTA_PANEL_DAILY]: {
    isQuota: true,
    en: "🎬 You've reached today's limit for comic images. Come back tomorrow.",
    he: '🎬 הגעת למכסה היומית של תמונות הקומיקס. נחזור מחר.',
  },
  [CODES.COMIC_SESSION_EXPIRED]: {
    en: 'This comic session has expired. Generate the comic again to create or replace images.',
    he: 'ההפקה של הקומיקס הזה פגה. צור את הקומיקס מחדש כדי ליצור או להחליף תמונות.',
  },
  [CODES.QUOTA_IDENTITY]: {
    isQuota: true,
    en: "🎭 You've used all your character-image credits this month. Invite a friend to earn another, or they refresh on the 1st.",
    he: '🎭 ניצלת את כל קרדיטי הדמות החודשיים. הזמן חבר וקבל קרדיט נוסף, או חזור ב-1 לחודש.',
  },
  [CODES.IDENTITY_LIFETIME_USED]: {
    isQuota: true,
    en: "🎭 You've already starred in your free poster! Invite a friend and earn another selfie credit when they make their first poster — or upgrade to Pro for new characters and full comics.",
    he: '🎭 כבר ניצלת את הפוסטר החינמי שבכיכובך! הזמן חבר ותקבל קרדיט סלפי נוסף כשהוא ייצור את הפוסטר הראשון שלו — או שדרג ל-Pro ליצירת דמויות חדשות וקומיקסים מלאים.',
  },
  [CODES.QUOTA_SHEET]: {
    isQuota: true,
    // {limit} = uploads included in the plan per month, {reset} = the date it renews (UTC).
    // `fallback` is used when the server did not send them (older response shape).
    en: "🎭 You've used all {limit} face-photo uploads included in your plan this month. The quota renews on {reset} (UTC).",
    he: '🎭 ניצלת את כל {limit} העלאות תמונות הפנים הכלולות במסלול שלך החודש. המכסה מתחדשת ב-{reset} (UTC).',
    fallback: {
      en: "🎭 You've used all the face-photo uploads included in your plan this month. The quota renews on the 1st of next month (UTC).",
      he: '🎭 ניצלת את כל העלאות תמונות הפנים הכלולות במסלול שלך החודש. המכסה מתחדשת ב-1 לחודש הבא (UTC).',
    },
  },
  [CODES.IMAGE_BUDGET_REACHED]: {
    en: "🎨 Image generation has hit its daily capacity, so we've paused it to keep the studio running. Please try again tomorrow.",
    he: '🎨 יצירת התמונות הגיעה היום לתקרת הקיבולת, ולכן עצרנו אותה כדי לשמור על יציבות האולפן. נסה שוב מחר.',
  },
  [CODES.IDENTITY_BUDGET_REACHED]: {
    en: "🎭 Casting yourself has hit its daily capacity, so we've paused it to keep the studio running. Please try again tomorrow.",
    he: '🎭 ליהוק עצמי הגיע היום לתקרת הקיבולת, ולכן עצרנו אותו כדי לשמור על יציבות האולפן. נסה שוב מחר.',
  },
  [CODES.SAFETY_REJECTED]: {
    en: "🚫 That image couldn't be used. Please upload a clear, appropriate selfie.",
    he: '🚫 לא ניתן להשתמש בתמונה הזו. אנא העלה סלפי ברור והולם.',
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
  [CODES.RATE_LIMITED]: {
    isRetryable: true,
    en: 'Too many requests right now — try again in a moment.',
    he: 'יותר מדי בקשות כרגע. נסה שוב בעוד רגע.',
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
  [CODES.CONSENT_REQUIRED]: {
    en: 'Please confirm the consent checkbox before uploading a face photo.',
    he: 'יש לאשר את תיבת ההסכמה לפני העלאת תמונת פנים.',
  },
};

/**
 * Returns the user-facing string for a given error code.
 * Falls back to English if lang is not found.
 * Falls back to the raw code string if the code is unknown.
 */
export function getMsg(code, lang = 'en', vars) {
  const entry = MAP[code];
  if (!entry) return code;
  const text = entry[lang] || entry.en;
  if (!text.includes('{')) return text;
  // Messages with {placeholders} need `vars`; without them use the entry's generic fallback.
  const keys = (text.match(/\{(\w+)\}/g) || []).map((m) => m.slice(1, -1));
  const missing = !vars || keys.some((k) => vars[k] === undefined || vars[k] === null);
  if (missing) return (entry.fallback && (entry.fallback[lang] || entry.fallback.en)) || text.replace(/\{\w+\}/g, '').replace(/\s+/g, ' ');
  return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k]));
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
