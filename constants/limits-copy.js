// User-facing wording of the plan limits, BUILT from config/limits.js so the Terms, FAQ, upgrade
// table, launch card and checkout text can never drift from the enforced numbers.
// tests/limits-copy.test.js fails if any user-facing file states a number that differs from config.
import { TIER_LIMITS, COMIC, SHEET_LIMITS, SCRIPT_MONTHLY_LIMITS } from '../config/limits.js';

const A = TIER_LIMITS.anonymous, F = TIER_LIMITS.free, P = TIER_LIMITS.pro;
const proScriptsMonth = SCRIPT_MONTHLY_LIMITS.pro;

export const LIMITS = {
  guestScriptsPerDay: A.script,
  guestPosters: A.poster,                 // lifetime
  freeScriptsPerDay: F.script,
  freePostersPerDay: F.poster,
  freeComicsPerMonth: F.comic,
  freeFirstComicPanels: COMIC.freeFirstComicPanels,
  freeLaterComicPanels: COMIC.freeLaterComicPanels,
  freeUploadsPerMonth: SHEET_LIMITS.free,
  freeStarPosters: F.identity,            // lifetime
  proScriptsPerDay: P.script,
  proScriptsPerMonth: proScriptsMonth,
  proPostersPerDay: P.poster,
  proComicsPerDay: P.comic,
  proComicsPerMonth: COMIC.proPerMonth,
  proUploadsPerMonth: SHEET_LIMITS.pro,
  proPanels: P.maxPanels,
  proStarPostersPerMonth: P.identity,
};
const L = LIMITS;

// Full plan description (Terms of Use, section "plans and limits").
export const termsPlansHe = () =>
  `LIFESCRIPT מציעה מסלול חינמי ומסלול Pro. במסלול החינמי: ${L.freeScriptsPerDay} תסריטים ו-${L.freePostersPerDay} פוסטרים ביום, ${L.freeComicsPerMonth} קומיקסים בחודש ו-${L.freeUploadsPerMonth} העלאות תמונת פנים בחודש (הקומיקס הראשון שלך נפתח במלואו, ${L.freeFirstComicPanels} פאנלים; בקומיקסים הבאים ${L.freeLaterComicPanels} פאנלים פתוחים), וכן ${L.freeStarPosters} פוסטר "לככב בסיפור" חינם (חד-פעמי). במסלול Pro (9$ לחודש): עד ${L.proScriptsPerDay} תסריטים ביום (ועד ${L.proScriptsPerMonth} בחודש), ${L.proPostersPerDay} פוסטרים ביום, עד ${L.proComicsPerDay} קומיקסים ביום (ועד ${L.proComicsPerMonth} בחודש), עד ${L.proUploadsPerMonth} העלאות תמונת פנים בחודש, עד ${L.proPanels} פאנלים לקומיקס, יצירת רילז ותור עיבוד מועדף. גולשים שאינם רשומים מוגבלים ל-${L.guestScriptsPerDay} תסריטים ביום ול-${L.guestPosters} פוסטר אחד בלבד, ויתכן שמכסת האורחים היומית הכוללת תיגמר במהלך היום (ההרשמה בחינם פותרת זאת). המגבלות היומיות מתאפסות בחצות UTC והחודשיות בתחילת החודש, ונועדו לשמור על איכות השירות לכלל המשתמשים.`;
export const termsPlansEn = () =>
  `LIFESCRIPT offers a Free plan and a Pro plan. Free plan: ${L.freeScriptsPerDay} scripts and ${L.freePostersPerDay} posters per day, ${L.freeComicsPerMonth} comics and ${L.freeUploadsPerMonth} face-photo uploads per month (your first comic is fully unlocked with ${L.freeFirstComicPanels} panels; later comics unlock ${L.freeLaterComicPanels} panels), plus ${L.freeStarPosters} free "Star Yourself" poster (one-time). Pro plan ($9/month): up to ${L.proScriptsPerDay} scripts per day (${L.proScriptsPerMonth} per month), ${L.proPostersPerDay} posters per day, up to ${L.proComicsPerDay} comics per day (${L.proComicsPerMonth} per month), up to ${L.proUploadsPerMonth} face-photo uploads per month, up to ${L.proPanels} comic panels, reels generation, and a priority processing queue. Unregistered visitors are limited to ${L.guestScriptsPerDay} scripts per day and ${L.guestPosters} poster in total, and the shared daily guest capacity can run out during the day (signing up for free solves this). Daily limits reset at UTC midnight and monthly limits at the start of the month; they exist to maintain quality service for all users.`;

// FAQ "what do I get for free / what does Pro add".
export const faqPlansHe = () =>
  `במסלול החינמי תכתוב ${L.freeScriptsPerDay} תסריטים ו-${L.freePostersPerDay} פוסטרים ביום, ותקבל ${L.freeComicsPerMonth} קומיקסים בחודש — מספיק כדי להתאהב. מסלול Pro (9$ לחודש) פותח עד ${L.proScriptsPerDay} תסריטים ביום (${L.proScriptsPerMonth} בחודש), ${L.proPostersPerDay} פוסטרים ביום, ${L.proComicsPerDay} קומיקסים ביום (עד ${L.proComicsPerMonth} בחודש), רילז ותור עיבוד מועדף. ויש בונוס: על כל חבר שתזמין שנרשם ויוצר פוסטר ראשון — אתה מקבל פוסטר "לככב בסיפור" חינם נוסף.`;
export const faqPlansEn = () =>
  `On the Free plan you write ${L.freeScriptsPerDay} scripts and ${L.freePostersPerDay} posters a day and get ${L.freeComicsPerMonth} comics a month — enough to fall in love. Pro ($9/month) unlocks up to ${L.proScriptsPerDay} scripts a day (${L.proScriptsPerMonth} a month), ${L.proPostersPerDay} posters a day, ${L.proComicsPerDay} comics a day (up to ${L.proComicsPerMonth} a month), reels, and a priority queue. And there's a bonus: for every friend you invite who signs up and makes their first poster, you earn another free "Star Yourself" poster.`;

// Short Pro blurbs (launch card, checkout).
export const proBlurbHe = () => `עד ${L.proScriptsPerDay} תסריטים ביום (${L.proScriptsPerMonth} בחודש), ${L.proPostersPerDay} פוסטרים ביום ו-${L.proComicsPerDay} קומיקסים ביום (עד ${L.proComicsPerMonth} בחודש), רילז ותור מועדף. ביטול בכל עת.`;
export const proBlurbEn = () => `Up to ${L.proScriptsPerDay} scripts a day (${L.proScriptsPerMonth} a month), ${L.proPostersPerDay} posters a day & ${L.proComicsPerDay} comics a day (up to ${L.proComicsPerMonth} a month), reels, and a priority queue. Cancel anytime.`;
export const checkoutDescription = () => `${L.proScriptsPerDay} scripts/day (${L.proScriptsPerMonth}/month) · ${L.proPostersPerDay} posters/day · ${L.proComicsPerDay} full comic books/day (${L.proComicsPerMonth}/month) · Reels generation`;

// FAQ "Star Yourself": monthly upload allowance sentence.
export const uploadsSentenceHe = () => `העלאת תמונת פנים כלולה עד ${L.freeUploadsPerMonth} פעמים בחודש במסלול החינמי ועד ${L.proUploadsPerMonth} בחודש ב-Pro, והמכסה מתחדשת ב-1 לחודש.`;
export const uploadsSentenceEn = () => `Face-photo uploads are included up to ${L.freeUploadsPerMonth} per month on Free and ${L.proUploadsPerMonth} per month on Pro, and the quota renews on the 1st of the month.`;
