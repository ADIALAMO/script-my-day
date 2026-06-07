// lib/gender-detect.js
//
// Zero-cost, deterministic protagonist-gender detector for the "Cast the Hero/ine"
// UX. The journal is the user's own day → the protagonist IS the user, so we read
// the gender that *leaks* through Hebrew morphology + the creator-credit name.
//
// Returns one of the three values the rest of the app already speaks:
//   'male' | 'female' | 'neutral'   (neutral == group / they / unknown)
// plus a confidence score so the UI can decide how loudly to suggest.
//
// DESIGN: this only ever produces a *suggestion*. The user confirms/overrides
// with one tap, so we bias toward precision over recall — when in doubt, stay
// 'neutral' rather than guess wrong. First-person PAST tense in Hebrew is
// gender-neutral ("הלכתי"), so it carries no signal and is ignored.

// ── Signal weights ───────────────────────────────────────────────────────────
const W_NAME = 4; // a recognised first name is the single strongest signal
const W_WORD = 1; // each gendered self-word / present-tense verb
const W_PLURAL = 2; // each first-person-plural marker → group

// Confidence needed before we dare suggest male/female over neutral.
const SUGGEST_THRESHOLD = 2;

// ── Curated Hebrew first names (common Israeli) ───────────────────────────────
// Suffix heuristics alone are unreliable (יהודה/נחמיה are male; many female names
// don't end in ־ה), so we lead with a curated list and fall back to suffixes only
// for clearly feminine endings.
const HE_MALE_NAMES = new Set([
  'אבי', 'אביב', 'אבישי', 'אדם', 'אהרון', 'אופיר', 'אור', 'אורי', 'איתי', 'איתמר',
  'אלון', 'אליה', 'אלעד', 'אמיר', 'אסף', 'ארז', 'אריאל', 'בן', 'גיא', 'גל',
  'גיל', 'דביר', 'דוד', 'דן', 'דניאל', 'דר', 'הראל', 'זיו', 'חן', 'יאיר',
  'יהונתן', 'יהודה', 'יואב', 'יובל', 'יונתן', 'יוסי', 'יוסף', 'ינון', 'יעקב', 'יצחק',
  'ירין', 'לביא', 'לוי', 'ליאור', 'מאור', 'מתן', 'נדב', 'נועם', 'נחמיה', 'ניב',
  'ניר', 'נתי', 'נתנאל', 'עדי', 'עומר', 'עידו', 'עידן', 'עמית', 'עמרי', 'ערן',
  'רועי', 'רון', 'רוני', 'רותם', 'שגיא', 'שון', 'שחר', 'שי', 'שלום', 'תום', 'תומר',
]);

const HE_FEMALE_NAMES = new Set([
  'אביגיל', 'אדל', 'אופיר', 'אור', 'אורית', 'איה', 'איילת', 'אילנה', 'אלה', 'אסתר',
  'אפרת', 'בר', 'גאיה', 'גל', 'דנה', 'דניאלה', 'הדס', 'הדר', 'הילה', 'ורד',
  'חן', 'טל', 'יעל', 'יערה', 'ליאור', 'ליהי', 'לימור', 'לינוי', 'מאיה', 'מורן',
  'מיכל', 'מירב', 'נועה', 'נטע', 'נטלי', 'נילי', 'נעמה', 'נעמי', 'סיון', 'סתיו',
  'עדי', 'עדן', 'עינב', 'ענבל', 'ענבר', 'רוני', 'רותם', 'רחל', 'רינת', 'שירה',
  'שירן', 'שני', 'שקד', 'תמר', 'תמי', 'תהל',
]);

// ── Curated gendered self-words (adjectives + first-person present verbs) ──────
// Only forms whose gender is UNAMBIGUOUS in spelling are listed — e.g. "רוצה" and
// "עושה" read identically for both genders, so they are deliberately omitted.
const HE_MALE_WORDS = new Set([
  // adjectives / states
  'עייף', 'שמח', 'עצוב', 'כועס', 'בטוח', 'מאוכזב', 'נרגש', 'רגוע', 'מבולבל',
  'גמור', 'הרוס', 'מותש', 'בודד', 'מאוהב', 'פנוי', 'לחוץ', 'מודאג', 'גאה',
  'מתוסכל', 'נבוך', 'אבוד', 'שבור', 'מאושר', 'חולה', 'רעב', 'צודק',
  // first-person present verbs
  'הולך', 'חושב', 'מרגיש', 'יושב', 'אומר', 'עובד', 'יודע', 'מבין', 'אוהב',
  'חושש', 'מדבר', 'רואה', 'שומע', 'כותב', 'קם', 'נשאר', 'מחפש', 'מקווה',
  'זוכר', 'מנסה', 'יכול', 'צריך', 'רוצה',
]);

const HE_FEMALE_WORDS = new Set([
  // adjectives / states
  'עייפה', 'שמחה', 'עצובה', 'כועסת', 'בטוחה', 'מאוכזבת', 'נרגשת', 'רגועה', 'מבולבלת',
  'גמורה', 'הרוסה', 'מותשת', 'בודדה', 'מאוהבת', 'פנויה', 'לחוצה', 'מודאגת', 'גאה',
  'מתוסכלת', 'נבוכה', 'אבודה', 'שבורה', 'מאושרת', 'חולה', 'רעבה', 'צודקת',
  // first-person present verbs
  'הולכת', 'חושבת', 'מרגישה', 'יושבת', 'אומרת', 'עובדת', 'יודעת', 'מבינה', 'אוהבת',
  'חוששת', 'מדברת', 'רואה', 'שומעת', 'כותבת', 'קמה', 'נשארת', 'מחפשת', 'מקווה',
  'זוכרת', 'מנסה', 'יכולה', 'צריכה', 'רוצה',
]);

// First-person-plural markers → the story has a group protagonist.
const HE_PLURAL_WORDS = new Set([
  'אנחנו', 'אנו', 'כולנו', 'שנינו', 'יחד', 'ביחד', 'הלכנו', 'היינו', 'עשינו',
  'אמרנו', 'ישבנו', 'הגענו', 'יצאנו', 'נסענו', 'שלנו', 'אצלנו', 'איתנו',
]);

// English fallback name lists (gender barely matters for the English script, but a
// recognised name still lets us pre-highlight the right pill).
const EN_MALE_NAMES = new Set([
  'adam', 'alex', 'ben', 'daniel', 'david', 'eli', 'guy', 'jack', 'james', 'john',
  'jonathan', 'josh', 'leo', 'liam', 'mark', 'matt', 'michael', 'noah', 'omer',
  'oscar', 'paul', 'ryan', 'sam', 'tom',
]);
const EN_FEMALE_NAMES = new Set([
  'anna', 'dana', 'emma', 'eve', 'hannah', 'julia', 'lea', 'leah', 'lily', 'maya',
  'mia', 'mira', 'noa', 'olivia', 'rachel', 'sara', 'sarah', 'shir', 'tamar', 'yael',
]);

// Strip Hebrew niqqud + punctuation so token matching is clean.
function tokenize(text) {
  return (text || '')
    .replace(/[֑-ׇ]/g, '') // niqqud / cantillation
    .split(/[^֐-׿A-Za-z']+/)
    .filter(Boolean);
}

function firstNameOf(name) {
  const toks = tokenize(name);
  return toks[0] || '';
}

/**
 * Detect the protagonist gender from the journal text and the creator-credit name.
 *
 * @param {string} text - the raw journal entry
 * @param {string} name - the creator-credit / producer name (strongest signal)
 * @param {'he'|'en'} lang - active UI language (selects the lexicon)
 * @returns {{ gender: 'male'|'female'|'neutral', confidence: number }}
 */
export function detectGender(text = '', name = '', lang = 'he') {
  let male = 0;
  let female = 0;
  let group = 0;

  // 1) Name signal (weighted highest) ────────────────────────────────────────
  const first = firstNameOf(name);
  if (first) {
    if (lang === 'he') {
      if (HE_MALE_NAMES.has(first)) male += W_NAME;
      else if (HE_FEMALE_NAMES.has(first)) female += W_NAME;
      else if (/(ית|את)$/.test(first)) female += W_NAME - 1; // clearly feminine suffix
    } else {
      const lc = first.toLowerCase();
      if (EN_MALE_NAMES.has(lc)) male += W_NAME;
      else if (EN_FEMALE_NAMES.has(lc)) female += W_NAME;
    }
  }

  // 2) Morphology signal from the journal body (Hebrew only) ──────────────────
  if (lang === 'he') {
    for (const tok of tokenize(text)) {
      if (HE_PLURAL_WORDS.has(tok)) group += W_PLURAL;
      else if (HE_FEMALE_WORDS.has(tok)) female += W_WORD;
      else if (HE_MALE_WORDS.has(tok)) male += W_WORD;
    }
  }

  // 3) Resolve ────────────────────────────────────────────────────────────────
  // A strong group signal that beats both singular signals → group/neutral.
  if (group >= SUGGEST_THRESHOLD && group > male && group > female) {
    return { gender: 'neutral', confidence: group };
  }

  const lead = Math.max(male, female);
  const margin = Math.abs(male - female);
  // Need both an absolute floor AND a clear lead over the other gender to commit.
  if (lead >= SUGGEST_THRESHOLD && margin >= 1) {
    return { gender: male > female ? 'male' : 'female', confidence: margin };
  }

  return { gender: 'neutral', confidence: 0 };
}

export default detectGender;
