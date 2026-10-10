// Privacy-policy wording about accounts, external AI providers and data sharing (privacy §3, §7, §8).
// Lives in its own module so the Google tier disclosure can be switched without editing the policy text.
//
// NEXT_PUBLIC_GEMINI_API_TIER — which Google Gemini API plan the production key is on:
//   'free' (default, also used for any unknown value): the policy tells users that Google may use submitted content to improve
//                                                      its products and that human reviewers may read it (Google's terms for the free tier).
//   'paid'                                           : that sentence is removed (set it once billing is enabled on the Google project).
// It is NEXT_PUBLIC_ because the policy is rendered in the browser; it is read at call time so tests can set it per process.
export const geminiTier = () => (process.env.NEXT_PUBLIC_GEMINI_API_TIER === 'paid' ? 'paid' : 'free');

export const privacyAccountHe = () =>
  'אם אתה נרשם, אנחנו שומרים את כתובת האימייל והשם שלך (מ-Google או מקישור הכניסה) וכן, בהתחברות עם Google, את כתובת תמונת הפרופיל שלך ואת רשומת ההתחברות הטכנית שספריית ההתחברות שומרת עבור חשבון ה-Google שלך, כדי לנהל את החשבון, המכסה והמנוי. מידע זה נשמר עד שתבקש למחוק את חשבונך. מלבד נתוני החשבון, אנחנו מחזיקים מידע אישי נוסף המתואר בסעיפים 2, 4, 5 ו-6 (למשל תמונות פנים שהעלית, כתובות IP של גולשים שאינם מחוברים ומזהה לקוח של Stripe).';
export const privacyAccountEn = () =>
  'If you sign up, we store your email address and name (from Google or the magic-link sign-in) and, for Google sign-in, your profile-photo URL and the technical sign-in record that the sign-in library keeps for your Google account, to manage your account, quota and subscription. This data is kept until you ask us to delete your account. Besides this account data we hold other personal data described in sections 2, 4, 5 and 6 (for example face photos you upload, IP addresses of visitors who are not signed in, and a Stripe customer ID).';

export const privacyProvidersHe = () =>
  'כדי ליצור תסריטים, קומיקס ופוסטרים אנחנו שולחים לספקי AI חיצוניים (בהצפנת HTTPS) את הטקסט שכתבת, תיאורי תמונה שנגזרים ממנו, ובפיצ\'ר "לככב בסיפור" גם את תמונת הפנים שלך. הספקים: ' +
  '(א) Google (Gemini API) מקבלת את הטקסט שלך ליצירת תסריטים ותוכנית הקומיקס.' +
  (geminiTier() === 'free'
    ? ' אנחנו משתמשים במסלול החינמי (ללא תשלום) של Gemini API; לפי התנאים של Google למסלול זה, Google עשויה להשתמש בתוכן שנשלח כדי לשפר את מוצריה, ובודקים אנושיים עשויים לקרוא אותו.'
    : '') +
  ' (ב) OpenRouter מנתבת בקשות למודלים של ספקים נוספים (למשל Gemma, DeepSeek, FLUX, xAI Grok, Gemini לתמונות, ומודל בטיחות שבודק תמונות פנים); חלק מהמסלולים הם חינמיים. לכל ספק מדיניות משלו בנוגע לתיעוד, שמירה ואימון, שלא אימתנו מול כולם, וחלקם עשויים לעבד מידע מחוץ לישראל ולאזור הכלכלי האירופי.' +
  ' (ג) Cloudflare Workers AI מקבלת תיאורי תמונה ליצירת תמונות.' +
  ' (ד) ספקי גיבוי כגון Cohere ו-Pollinations; Pollinations הוא שירות ציבורי אנונימי שמקבל את תיאור התמונה בתוך כתובת הבקשה.' +
  ' לכן איננו יכולים להבטיח שהתוכן שלך אינו נשמר או משמש אצל ספקים אלה. אל תזין מידע רגיש במיוחד או תמונות של אנשים אחרים ללא הסכמתם. אנחנו לא מוכרים את התוכן ולא משתמשים בו לפרסום.';
export const privacyProvidersEn = () =>
  'To create scripts, comics and posters we send to external AI providers (over HTTPS) the text you wrote, image descriptions derived from it and, for "Star Yourself", your face photo. The providers: ' +
  '(a) Google (Gemini API) receives your text to create scripts and the comic plan.' +
  (geminiTier() === 'free'
    ? " We use Google's free (unpaid) Gemini API tier; under Google's terms for that tier, Google may use submitted content to improve its products and human reviewers may read it."
    : '') +
  ' (b) OpenRouter routes requests to models from other providers (for example Gemma, DeepSeek, FLUX, xAI Grok, Gemini for images, and a content-safety model that checks face photos); some of these run on free routes. Each provider has its own policy on logging, retention and training, which we have not verified for all of them, and some may process data outside Israel and the EEA.' +
  ' (c) Cloudflare Workers AI receives image descriptions to create images.' +
  ' (d) Backup providers such as Cohere and Pollinations; Pollinations is an anonymous public service that receives the image description inside the request address.' +
  ' For these reasons we cannot promise that your content is not retained or used by these providers. Do not enter highly sensitive information, or photos of other people without their consent. We do not sell your content or use it for advertising.';

export const privacySharingHe = () =>
  'אנחנו לא מוכרים את המידע שלך. אנחנו משתפים אותו רק עם ספקי השירות הנחוצים להפעלת השירות (סעיפים 3, 5 ו-7), ולא משתמשים בקלטים שלך לפרסום. LIFESCRIPT מרוויחה מהיכולת לייצר עבורך — לא ממה שאתה כותב.';
export const privacySharingEn = () =>
  'We do not sell your data. We share it only with the service providers needed to run the service (sections 3, 5 and 7), and we do not use your inputs for advertising. LIFESCRIPT profits from the ability to generate for you — not from what you write.';
