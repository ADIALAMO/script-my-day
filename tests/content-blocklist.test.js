import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkContent, isBlocked, BLOCKLIST_SIZE } from '../lib/content-blocklist.js';

// The blocklist itself is deliberately not exported or printed; these tests use a handful of blatant, unambiguous
// probes and a list of innocent look-alikes that must NEVER be blocked (the usual substring false positives).

test('the list is populated in both languages', () => {
  assert.ok(BLOCKLIST_SIZE.en >= 30, `en ${BLOCKLIST_SIZE.en}`);
  assert.ok(BLOCKLIST_SIZE.he >= 20, `he ${BLOCKLIST_SIZE.he}`);
});

test('blatant English wording is blocked, in any case', () => {
  for (const t of ['a nude woman on a beach', 'NUDE model', 'an erotic scene', 'porn', 'she wore only lingerie', 'topless sunbathing', 'they were completely naked']) {
    assert.equal(isBlocked(t), true, t);
  }
});

test('blatant Hebrew wording is blocked, including attached prefix letters', () => {
  for (const t of ['אישה בעירום מלא', 'העירום', 'סרט פורנו', 'סצנת סקס', 'הם היו ערומים', 'בלי בגדים בכלל']) {
    assert.equal(isBlocked(t), true, t);
  }
});

test('a minor next to a sexual word is blocked in both languages; the same words apart are not', () => {
  assert.equal(checkContent('a child and sexual content').category, 'minor-sexual');
  assert.equal(checkContent('ילדה בעירום').category, 'minor-sexual');
  assert.equal(isBlocked('my kids had a lovely day at the zoo'), false);
  assert.equal(isBlocked('הילדים שיחקו בגינה'), false);
});

test('simple obfuscation is normalised away: spaced letters, leetspeak, zero-width characters, niqqud', () => {
  assert.equal(isBlocked('n u d e'), true);
  assert.equal(isBlocked('n.u.d.e'), true);
  assert.equal(isBlocked('p0rn'), true);
  assert.equal(isBlocked('nu​de'), true);
  assert.equal(isBlocked('עִירוּם'), true);
});

test('innocent look-alikes are NOT blocked (no substring matching, no ambiguous single words)', () => {
  for (const t of [
    'We drove through Essex and Sussex on a classic road trip', 'Middlesex hospital', 'I saw it with the naked eye',
    'breast cancer awareness month', 'a novel analysis of the assessment', 'the bass guitar and a saxophone', 'cucumber salad',
    'It was a day with all kinds of things', 'He is a pass-the-ball kind of player',
  ]) assert.equal(isBlocked(t), false, t);
  for (const t of ['הוא ניגן בסקסופון', 'כל מיני דברים קרו לי היום', 'זינוק מהיר בבוקר', 'מינימום שיחה', 'הנחש היה ערמומי', 'בית ספר יסודי ילדים ומורים']) {
    assert.equal(isBlocked(t), false, t);
  }
});

test('ordinary journal and screenplay text passes', () => {
  assert.equal(isBlocked('I walked to the café, met an old friend and we talked about our plans for the summer.'), false);
  assert.equal(isBlocked('הלכתי לקפה, פגשתי חברה ישנה ודיברנו על התוכניות שלנו לקיץ.'), false);
});

test('non-string / empty input never throws and is not blocked', () => {
  for (const v of [undefined, null, 42, {}, '', '   ']) assert.deepEqual(checkContent(v), { blocked: false, category: null });
});

test('the result never echoes the matched text', () => {
  const r = checkContent('a nude woman');
  assert.deepEqual(Object.keys(r).sort(), ['blocked', 'category']);
});

// ─── false-positive guard: innocent phrases that sit close to blocked wording ───────────────────────────────────────
const INNOCENT = {
  'medical (en)': [
    'I have a breast cancer screening appointment on Tuesday', 'Mammogram results came back clear today',
    'The doctor examined my chest and prescribed antibiotics', 'He had a prostate check and a routine blood test',
    'The nurse said the baby was healthy and the birth went well', 'Sexual health clinics were mentioned in the news article',
  ],
  'medical (he)': [
    'יש לי בדיקת סקר לסרטן השד ביום שלישי', 'התוצאות של הממוגרפיה יצאו תקינות', 'הרופא בדק את החזה שלי ורשם אנטיביוטיקה',
    'האחות אמרה שהתינוק בריא והלידה עברה בשלום',
  ],
  'cooking (en)': [
    'Grilled chicken breast with lemon and herbs', 'I seasoned the turkey breast and roasted it for an hour',
    'We made cocktail sausages, cucumber rolls and a cumin rice', 'The recipe calls for a naked cake with fresh berries',
    'Cooked the duck breast until the skin was crisp',
  ],
  'cooking (he)': ['חזה עוף בגריל עם לימון ועשבי תיבול', 'הכנתי חזה הודו בתנור עם תפוחי אדמה'],
  'place names (en)': [
    'We spent a weekend in Essex, then drove to Sussex and Middlesex', 'Scunthorpe, Penistone and Cockermouth are towns in England',
    'The Dick Whittington pantomime was fun', 'We took the train to Bangor and then to Cumbria', 'Lake Titicaca is beautiful at sunrise',
    'Our flight to Sexmoan was delayed, then Anus village in France was on the map',
  ],
  'place names (he)': ['טיילנו בעין גדי ובנחל ערוגות', 'נסענו לזכרון יעקב ואחר כך לבית שאן', 'המעיין של ערוגות היה קסום'],
  'baby gender reveal (en)': [
    'We hosted a gender reveal party and the balloons were pink', 'The baby shower had blue and pink cupcakes', 'Finding out the baby is a girl made us cry with joy',
    'My newborn baby boy slept through the night for the first time',
  ],
  'baby gender reveal (he)': ['עשינו מסיבת חשיפת מין העובר והבלונים היו ורודים', 'גילינו שנולדה לנו בת והתרגשנו עד דמעות', 'התינוק הקטן ישן כל הלילה בפעם הראשונה'],
  'romance / drama (en)': [
    'They kissed under the streetlight and held hands all the way home', 'Her heart raced as his fingers brushed hers across the table',
    'He wore a tuxedo and she wore a long red evening dress to the wedding', 'The couple danced slowly in the candlelit room',
    'She slipped into a bikini and ran to the sea', 'He took off his wet shirt and hung it on the chair',
    'They spent the night talking until sunrise, falling in love', 'A sensual cello solo filled the concert hall',
    'The film was rated R for strong language and violence', 'She felt exposed and vulnerable when she gave the speech',
    'After the breakup he felt naked without her',
  ],
  'romance / drama (he)': [
    'הם התנשקו מתחת לפנס ונכנסו הביתה יד ביד', 'הלב שלה דפק כשאצבעותיו נגעו בשלה מעבר לשולחן', 'הוא לבש חליפה והיא שמלת ערב אדומה לחתונה',
    'הזוג רקד לאט באולם המואר בנרות', 'היא נכנסה לבגד ים ורצה אל הים', 'אחרי הפרידה הוא הרגיש חשוף בלעדיה', 'היא התאהבה בו באמצע הלילה',
  ],
  'children (en/he)': [
    'The kids built a sandcastle while the children played ball', 'My teenager passed the driving test', 'A little girl sold lemonade on the corner',
    'הילדים בנו טירת חול והנערים שיחקו כדורגל', 'הילדה שלי קיבלה תעודה מצטיינת', 'התינוקת צחקה כל הדרך הביתה',
  ],
};

for (const [group, phrases] of Object.entries(INNOCENT)) {
  test(`false positives: ${group} passes`, () => {
    for (const p of phrases) assert.equal(isBlocked(p), false, p);
  });
}

test('documented trade-off: the Hebrew standalone nudity adjectives are blocked even in the baking term "naked cake" (English "naked cake" passes, since "naked" alone is not listed)', () => {
  assert.equal(isBlocked('עוגה עירומה עם פירות יער לקינוח'), true);
});
