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
  CONTENT_BLOCKED: 'CONTENT_BLOCKED', // the user's text hit the server-side keyword blocklist (lib/content-blocklist.js) — nothing was generated or charged
  CONTENT_CHECK_UNAVAILABLE: 'CONTENT_CHECK_UNAVAILABLE', // the generated image could not be safety-checked in time — it is NOT shown; retryable, nothing charged
  REPORT_INVALID: 'REPORT_INVALID', // a report that cannot be accepted (not one of our generated images, unknown reason, too many refs)
  CONTENT_REFUSED: 'CONTENT_REFUSED', // an AI provider refused the content (safety filter) — the request ends, it is never retried on another provider

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
  MINOR_REJECTED: 'MINOR_REJECTED', // the photo clearly appears to show a child (best-effort screen — not age verification)
  PHOTO_CHECK_UNAVAILABLE: 'PHOTO_CHECK_UNAVAILABLE', // the face-photo screen could not run (provider down / unreadable / circuit / budget): fail closed, retryable
  ADULT_CONFIRMATION_REQUIRED: 'ADULT_CONFIRMATION_REQUIRED', // "Star Yourself" is 18+: the account has not confirmed it (403 from upload-character)
  IMAGE_UNSUPPORTED: 'IMAGE_UNSUPPORTED', // the selfie is not a real JPEG / PNG / WebP (checked by its bytes)
  CHARACTER_SHEET_FAILED: 'CHARACTER_SHEET_FAILED', // the character sheet could not be made / checked / stored — nothing was charged, the photo was deleted
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
    en: "🎬 You've used your free comics for this month. They refresh on the 1st.",
    he: '🎬 ניצלת את הקומיקסים החינמיים של החודש. הם מתחדשים ב-1 לחודש.',
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
    en: "🎭 You've already starred in your free poster! Invite a friend and earn another selfie credit when they make their first poster.",
    he: '🎭 כבר ניצלת את הפוסטר החינמי שבכיכובך! הזמן חבר ותקבל קרדיט סלפי נוסף כשהוא ייצור את הפוסטר הראשון שלו.',
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
  [CODES.CONTENT_BLOCKED]: {
    en: "🚫 We can't create this story. LifeScript makes general-audience scripts and images, so please rewrite it without sexual or explicit content.",
    he: '🚫 לא ניתן ליצור את הסיפור הזה. LifeScript יוצרת תסריטים ותמונות לקהל הרחב, ולכן אנא נסח אותו מחדש ללא תוכן מיני או בוטה.',
  },
  [CODES.CONTENT_REFUSED]: {
    en: "🚫 This scene couldn't be created because it didn't pass our content safety check. Try rewording the story — nothing was charged.",
    he: '🚫 לא ניתן היה ליצור את הסצנה הזו כי היא לא עברה את בדיקת הבטיחות שלנו. נסה לנסח את הסיפור מחדש — לא חויבת.',
  },
  [CODES.CONTENT_CHECK_UNAVAILABLE]: {
    isRetryable: true,
    en: "🛡️ We couldn't run the safety check on this image right now, so it wasn't shown. Nothing was charged — please try again in a moment.",
    he: '🛡️ לא הצלחנו להריץ כרגע את בדיקת הבטיחות על התמונה הזו, ולכן היא לא הוצגה. לא חויבת — נסה שוב בעוד רגע.',
  },
  [CODES.REPORT_INVALID]: {
    en: "This image can't be reported.",
    he: 'לא ניתן לדווח על התמונה הזו.',
  },
  [CODES.ADULT_CONFIRMATION_REQUIRED]: {
    en: '"Star Yourself" is for users aged 18 and over. Please confirm that you are 18 or older to continue. You can keep using the app without a photo.',
    he: '"לככב בסיפור" מיועד למשתמשים בני 18 ומעלה. אנא אשר שאתה בן/בת 18 ומעלה כדי להמשיך. אפשר להמשיך להשתמש באפליקציה גם בלי תמונה.',
  },
  [CODES.PHOTO_CHECK_UNAVAILABLE]: {
    isRetryable: true,
    en: "🛡️ We couldn't check the photo right now, so it wasn't used. Nothing was charged — please try again in a moment.",
    he: '🛡️ לא הצלחנו לבדוק את התמונה כרגע, ולכן לא השתמשנו בה. לא חויבתם — נסו שוב בעוד רגע.',
  },
  [CODES.MINOR_REJECTED]: {
    en: "🚫 This photo can't be used. \"Star Yourself\" is for adults only — please upload a photo of an adult who agreed to it.",
    he: '🚫 לא ניתן להשתמש בתמונה הזו. "לככב בסיפור" מיועד למבוגרים בלבד — אנא העלה תמונה של בגיר שהסכים לכך.',
  },
  [CODES.IMAGE_UNSUPPORTED]: {
    en: '🚫 That file could not be used. Please upload a JPEG, PNG or WebP photo.',
    he: '🚫 לא ניתן להשתמש בקובץ הזה. אנא העלה תמונה בפורמט JPEG, PNG או WebP.',
  },
  [CODES.CHARACTER_SHEET_FAILED]: {
    isRetryable: true,
    en: "🎭 We couldn't create your character this time. Your photo was deleted and nothing was charged — please try again in a moment.",
    he: '🎭 לא הצלחנו ליצור את הדמות שלך הפעם. התמונה נמחקה ולא חויבת — נסה שוב בעוד רגע.',
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
    en: '🎬 This feature is not available on your account.',
    he: '🎬 הפיצ׳ר הזה אינו זמין בחשבון שלך.',
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
// Inside the Android app (Capacitor) no text may point to a purchase, a price or an "upgrade" (Google Play payments policy).
// These codes get neutral wording there; Pro entitlements themselves are unaffected (the tier comes from the server).
const NATIVE_NEUTRAL = {
  [CODES.NEEDS_PRO]: {
    en: "🎬 This feature isn't available on your current plan.",
    he: '🎬 פיצ׳ר זה אינו זמין במסלול הנוכחי שלך.',
  },
  [CODES.QUOTA_COMIC_MONTH]: {
    en: "🎬 You've used your comics for this month. They refresh on the 1st.",
    he: '🎬 ניצלת את הקומיקסים של החודש. הם מתחדשים ב-1 לחודש.',
  },
  [CODES.IDENTITY_LIFETIME_USED]: {
    en: "🎭 You've already starred in your free poster! Invite a friend and earn another selfie credit when they make their first poster.",
    he: '🎭 כבר ניצלת את הפוסטר החינמי שבכיכובך! הזמן חבר ותקבל קרדיט סלפי נוסף כשהוא ייצור את הפוסטר הראשון שלו.',
  },
};
/** the Capacitor global is only present inside the native shell; never throws (SSR, tests) */
export const isNativeShell = () => typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() === true;

export function getMsg(code, lang = 'en', vars, opts = {}) {
  const base = MAP[code];
  if (!base) return code;
  const native = opts.native ?? isNativeShell();
  const entry = native && NATIVE_NEUTRAL[code] ? { ...base, ...NATIVE_NEUTRAL[code] } : base;
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
