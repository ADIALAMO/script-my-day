/**
 * Server-side keyword blocklist (English + Hebrew) for user-supplied text that ends up in an LLM or image prompt.
 *
 * Why it exists: LifeScript is a general-audience app (Google Play "Sexual Content" / "AI-Generated Content" policy),
 * and none of the providers in the cascade is guaranteed to filter. This is the cheap first line of defence; it is a
 * floor, not a classifier — it only catches blatant wording. Positive prompt rules (lib/content-safety.js) and, later,
 * an output image check are the other layers.
 *
 * Design rules:
 *   - Whole-word matching only (Latin `\b`, Hebrew letter look-arounds with the optional one-letter prefixes ה/ו/ב/ל/…),
 *     so "Essex", "Sussex", "classic" or the Hebrew word for "saxophone" never match.
 *   - Terms are chosen to be unambiguous. Words with common innocent uses ("breast", "sex" alone, "naked eye") are NOT
 *     listed on their own; the "minor + sexual word nearby" rule covers the dangerous combinations.
 *   - Input is normalised first (case, niqqud, zero-width characters, simple leetspeak, spaced-out letters).
 *   - A hit returns only a category — the matched text is never returned or logged (it is user content).
 *
 * Applied in pages/api/generate-script.js, generate-storyboard.js and generate-poster.js, BEFORE any quota is reserved.
 */

const HE = '\\u0590-\\u05FF';
const HE_PREFIX = '[הוכלבמש]{0,3}';

const EN_SEXUAL = [
  'nude[sd]?', 'nudity', 'topless', 'porn\\w*', 'erotic\\w*', 'hentai', 'nsfw', 'xxx', 'orgy', 'orgies',
  'blow\\s?jobs?', 'hand\\s?jobs?', 'masturbat\\w*', 'genitals?', 'genitalia', 'penis', 'vagina', 'nipples?',
  'lingerie', 'strippers?', 'strip\\s?tease', 'undress\\w*', 'unclothed', 'cum\\s?shots?', 'fetish\\w*',
  'without (?:any )?clothes', 'no clothes', 'bare[- ]breast\\w*', 'bare breasts?',
  'sex (?:scenes?|acts?|tapes?|toys?)', 'having sex', 'sexual (?:intercourse|acts?)',
  '(?:fully|completely|totally|stark) naked',
  'naked (?:bod(?:y|ies)|wom[ae]n|m[ae]n|girls?|boys?|people|person|couples?|models?)',
];

// Always blocked, whatever else the text says.
const EN_CSAM = ['loli', 'lolicon', 'shota', 'shotacon', 'p(?:a)?edophil\\w*', 'csam', 'child porn\\w*'];

const EN_MINOR = [
  'child', 'children', 'kids?', 'minors?', 'under-?age', 'teens?', 'teenagers?', 'teenage', 'tweens?', 'pre-?teens?',
  'toddlers?', 'infants?', 'babies', 'baby', 'schoolgirls?', 'schoolboys?', 'little (?:girl|boy)s?', 'young (?:girl|boy)s?',
];
const EN_SEXWORD = [
  'sex\\w*', 'nude[sd]?', 'nudity', 'naked', 'erotic\\w*', 'porn\\w*', 'undress\\w*', 'topless', 'seduc\\w*',
  'molest\\w*', 'rap(?:e|es|ed|ing)', 'lust(?:ful)?',
];

const HE_SEXUAL = [
  'עירום', 'עירומה', 'עירומים', 'עירומות', 'ערום', 'ערומה', 'ערומים', 'ערומות', 'סקס', 'סקסים',
  'פורנו', 'פורנוגרפי[הת]?', 'פורנוגרפיה', 'אירוטי', 'אירוטית', 'אירוטיקה', 'חשפנית', 'חשפניות', 'חשפנות',
  'אוננות', 'אוננתי', 'מציצה', 'זין', 'זיון', 'זיונים', 'לזיין', 'מזיין', 'פטמות', 'פטמה', 'איבר מין', 'אברי מין',
  'בלי בגדים', 'ללא בגדים', 'טופלס', 'אורגיה', 'אורגיות', 'לבוש מינית',
];
const HE_CSAM = ['פדופיל', 'פדופילים', 'פדופיליה', 'פורנו ילדים'];
const HE_MINOR = [
  'ילד', 'ילדה', 'ילדים', 'ילדות', 'קטין', 'קטינה', 'קטינים', 'קטינות', 'נער', 'נערה', 'נערים', 'נערות',
  'תינוק', 'תינוקת', 'תינוקות', 'פעוט', 'פעוטה', 'פעוטות',
];
const HE_SEXWORD = ['סקס', 'עירום', 'עירומה', 'ערום', 'ערומה', 'אירוטי', 'אירוטית', 'פורנו', 'מינית', 'מיניים', 'מיניות'];

const en = (list) => `\\b(?:${list.join('|')})\\b`;
const he = (list) => `(?<![${HE}])${HE_PREFIX}(?:${list.join('|')})(?![${HE}])`;
const near = (a, b, gap = 60) => `${a}[\\s\\S]{0,${gap}}?${b}|${b}[\\s\\S]{0,${gap}}?${a}`;

const RULES = [
  { category: 'sexual', re: new RegExp(en(EN_SEXUAL), 'iu') },
  { category: 'minor-sexual', re: new RegExp(en(EN_CSAM), 'iu') },
  { category: 'minor-sexual', re: new RegExp(near(en(EN_MINOR), en(EN_SEXWORD)), 'iu') },
  { category: 'sexual', re: new RegExp(he(HE_SEXUAL), 'u') },
  { category: 'minor-sexual', re: new RegExp(he(HE_CSAM), 'u') },
  { category: 'minor-sexual', re: new RegExp(near(he(HE_MINOR), he(HE_SEXWORD)), 'u') },
];

/** how many terms/patterns are configured, for the changelog/report (the list itself is deliberately not exported) */
export const BLOCKLIST_SIZE = {
  en: EN_SEXUAL.length + EN_CSAM.length + EN_MINOR.length + EN_SEXWORD.length,
  he: HE_SEXUAL.length + HE_CSAM.length + HE_MINOR.length + HE_SEXWORD.length,
};

const LEET = { '@': 'a', '0': 'o', '1': 'i', '3': 'e', '$': 's' };

/** case, niqqud/cantillation, zero-width + bidi controls, simple leetspeak */
function normalize(text) {
  return String(text)
    .normalize('NFKC')
    .replace(/[֑-ׇ]/g, '')                       // Hebrew niqqud + cantillation
    .replace(/[​-‏‪-‮⁠-⁤﻿­]/g, '')    // zero-width, bidi controls, soft hyphen
    .toLowerCase()
    .replace(/[@013$]/g, (c) => LEET[c]);
}

/** "n u d e", "n.u.d.e", "p-o-r-n" → "nude", "porn" (runs of 3+ single Latin letters joined by one separator) */
function joinSpelledOut(text) {
  return text.replace(/\b(?:[a-z][ ._*\-]){2,}[a-z]\b/g, (m) => m.replace(/[ ._*\-]/g, ''));
}

/**
 * @param {unknown} text
 * @returns {{ blocked: boolean, category: 'sexual'|'minor-sexual'|null }}
 */
export function checkContent(text) {
  if (typeof text !== 'string' || !text) return { blocked: false, category: null };
  const a = normalize(text);
  const variants = [a];
  const joined = joinSpelledOut(a);
  if (joined !== a) variants.push(joined);
  // minor-sexual first: it is the more serious category, so it wins when both match
  const ordered = [...RULES].sort((x, y) => (x.category === 'minor-sexual' ? -1 : 0) - (y.category === 'minor-sexual' ? -1 : 0));
  for (const rule of ordered) {
    for (const v of variants) if (rule.re.test(v)) return { blocked: true, category: rule.category };
  }
  return { blocked: false, category: null };
}

export const isBlocked = (text) => checkContent(text).blocked;
