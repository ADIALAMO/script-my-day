// Privacy §3 (accounts), §7 (external AI providers) and §8 (sharing), the Terms' provider sentence, the About page and the dates: wording guards.
// §7 describes PRODUCTION with privacy mode ON (OpenRouter with data_collection "deny"; the direct Google key, Cohere and the free routes are not used).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODAL_DATA as m } from '../constants/modalData.js';
import { PROVIDER_RETENTION } from '../config/limits.js';

const sec = (doc, l, n) => m[doc][l].sections.find((s) => s.h.startsWith(`${n}.`)).p;
const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ALL = JSON.stringify({ p: m.privacy, t: m.terms, a: m.about });

test('no bracketed internal note or TODO/owner remark appears in any user-visible policy or terms text', () => {
  const t = [m.privacy, m.terms].flatMap((d) => ['he', 'en'].flatMap((l) => [d[l].title, d[l].summary, ...d[l].sections.flatMap((s) => [s.h, s.p])])).join('\n');
  assert.doesNotMatch(t, /\[[^\]]*\]/, 'no [bracketed] text');
  assert.doesNotMatch(t, /OWNER-CONFIRM|\bTODO\b|REMOVE THIS|\bDRAFT\b/);
});

test('the legal copy no longer says "free routes", the outdated backup-check sentence, Cohere, the free Gemini tier, or that models race each other', () => {
  for (const re of [/free routes/i, /some of these run on free/i, /When the primary safety check is unavailable/i, /backup safety check may be run/i, /Cohere/, /free \(unpaid\)/i, /Gemini API tier/i,
    /simultaneously races/i, /מסלולים הם חינמיים/, /בדיקת הבטיחות הראשית אינה זמינה/, /בדיקת בטיחות גיבוי/, /המסלול החינמי/, /במסלול החינמי/, /ספק גיבוי נוסף/, /בו-זמנית מספר מודלי שפה/]) {
    assert.doesNotMatch(ALL, re, String(re));
  }
});

test('§7 says who sees what, in both languages: OpenRouter and every company that receives text or images, the safety checks on EVERY image, and the Character Sheet re-sent per poster', () => {
  for (const [l, must] of [
    ['en', ['OpenRouter', 'Google AI Studio', 'DeepInfra', 'Nebius', 'Novita', 'Parasail', 'StreamLake', 'Cloudflare Workers AI', 'Black Forest Labs', 'xAI (Grok)', 'Gemini image models on Google Cloud', 'NVIDIA safety model',
      'every generated image, and the face photo and Character Sheet, is checked automatically by two services', 'Each time you create a poster or panel with your character, the Character Sheet is sent']],
    ['he', ['OpenRouter', 'Google AI Studio', 'DeepInfra', 'Nebius', 'Novita', 'Parasail', 'StreamLake', 'Cloudflare Workers AI', 'Black Forest Labs', 'xAI (Grok)', 'Google Cloud', 'מודל בטיחות של NVIDIA',
      'כל תמונה שנוצרה, וכן תמונת הפנים וגיליון הדמות, נבדקת אוטומטית בשני שירותים', 'בכל פעם שאתה יוצר פוסטר או פאנל עם הדמות שלך, גיליון הדמות נשלח']],
  ]) { const t = sec('privacy', l, 7); for (const n of must) assert.ok(t.includes(n), `${l}: ${n}`); }
});

test('§7 explains "deny": providers that state they do not TRAIN — not that they delete — with the published retention from config, "according to what the providers publish", unverifiable', () => {
  const en = sec('privacy', 'en', 7); const he = sec('privacy', 'he', 7); const P = PROVIDER_RETENTION;
  assert.match(en, /data_collection=deny option, which allows only providers that state they do not train on the data\. It does not mean the provider deletes the data after the request\./);
  assert.match(he, /data_collection=deny של OpenRouter, שמתירה רק ספקים שמצהירים שאינם מאמנים על המידע\. האפשרות הזו אינה אומרת שהספק מוחק את המידע בתום הבקשה\./);
  assert.match(en, /According to what the providers publish, Google may keep requests for up to 55 days/); assert.equal(P.googleAiStudioDays, 55);
  assert.ok(en.includes(`up to ${P.googleAiStudioDays} days`) && en.includes(`${P.xaiDays} days`) && he.includes(`עד ${P.googleAiStudioDays} ימים`) && he.includes(`${P.xaiDays} ימים`), 'the numbers come from PROVIDER_RETENTION');
  assert.match(en, /DeepInfra states that it does not keep them/); assert.match(he, /DeepInfra מצהירה שהיא אינה שומרת אותן/);
  assert.match(en, /abuse monitoring/); assert.match(he, /ניטור שימוש לרעה/);
  assert.match(en, /We rely on these published statements and cannot independently verify them/); assert.match(he, /ואיננו יכולים לאמת אותן באופן עצמאי/);
  assert.match(en, /OpenRouter handles the requests it passes on under its own privacy policy/);
  assert.doesNotMatch(en, /do not collect the data/i); assert.doesNotMatch(he, /אינם אוספים את המידע/);
});

test('§7 text classifier bullet: it checks what we GENERATE (script / comic text), not the user\'s own entry, which only meets a keyword list on our server (he + en)', () => {
  assert.match(sec('privacy', 'en', 7), /The finished script or comic text that we generate for you is then checked by an automatic safety classifier on Google's Gemini models; your own entry is not sent to that classifier, it is only screened against a keyword list on our server\./);
  assert.match(sec('privacy', 'he', 7), /את התסריט או טקסט הקומיקס שנוצרו עבורך בודק לאחר מכן מסווג בטיחות אוטומטי במודלי Gemini של Google; הטקסט שכתבת בעצמך אינו נשלח למסווג הזה, הוא נבדק רק מול רשימת מילים בשרת שלנו\./);
  // the code really does that: the AI classifier gets the OUTPUT, the entry only goes through the local blocklist
  const script = read('pages/api/generate-script.js');
  assert.match(script, /checkContent\(`\$\{safeJournalEntry\}/); assert.match(script, /checkTextOutput\(result\.output/);
  assert.doesNotMatch(script, /checkTextOutput\(safeJournalEntry/);
  const sb = read('pages/api/generate-storyboard.js');
  assert.match(sb, /checkTextOutput\(storyboardText\(enrichedPanels\)/);
});

test('§7 is honest: no retention promise, sensitive-data warning, no ad/sale use; the "age" check is basic and cannot reliably determine age; bullets are separate lines', () => {
  const en = sec('privacy', 'en', 7); const he = sec('privacy', 'he', 7);
  assert.match(en, /we cannot promise that your content is not kept or used by these providers/); assert.match(he, /איננו יכולים להבטיח שהתוכן שלך אינו נשמר או משמש אצל ספקים אלה/);
  assert.match(en, /Do not enter highly sensitive information/); assert.match(he, /אל תזין מידע רגיש במיוחד/);
  assert.match(en, /do not sell your content or use it for advertising/); assert.match(he, /לא מוכרים את התוכן ולא משתמשים בו לפרסום/);
  assert.match(en, /This is a basic check and cannot reliably determine anyone's age\./); assert.match(he, /זו בדיקה בסיסית, והיא אינה יכולה לקבוע בוודאות את גילו של אדם\./);
  assert.doesNotMatch(en, /age verification/i);
  assert.match(he, /לא נשמר ולא נוצר דבר, לא נוצל דבר מהמכסה שלך/);
  for (const t of [en, he]) assert.equal(t.split('\n').filter((l) => l.startsWith('• ')).length, 4, 'four bullets');
  assert.match(read('components/LegalPage.jsx'), /leading-\[1\.85\] whitespace-pre-line/, 'LegalPage shows the line breaks');
});

test('§2 and Terms §5/§7 say which companies see the photo, that they keep it for their stated period, and that our deletion does not delete their copies (he + en)', () => {
  for (const [l, a, b] of [['en', /xAI \(Grok\) or to Google \(Gemini image models\)/, /deleting it from our storage does not delete those copies, and we do not control them/], ['he', /ל-xAI \(Grok\) או ל-Google \(מודלי Gemini לתמונות\)/, /מחיקה מהאחסון שלנו אינה מוחקת עותקים אלה, והם אינם בשליטתנו/]]) {
    const s2 = sec('privacy', l, 2); assert.match(s2, a); assert.match(s2, b);
  }
  assert.match(sec('terms', 'en', 5), /checked and processed by external AI providers, who may keep it for the period they state \(Privacy Policy, section 7\)/);
  assert.match(sec('terms', 'he', 5), /נבדקת ומעובדת על ידי ספקי AI חיצוניים, שעשויים לשמור אותה למשך התקופה שהם מצהירים עליה/);
  assert.match(sec('terms', 'en', 7), /through OpenRouter \(including Google, xAI, Black Forest Labs and DeepInfra\) and Cloudflare; see the Privacy Policy, section 7/);
  assert.match(sec('terms', 'he', 7), /דרך OpenRouter \(בהם Google, xAI, Black Forest Labs ו-DeepInfra\) וב-Cloudflare; ראה מדיניות הפרטיות, סעיף 7/);
});

test('§3 no longer claims email/name/avatar is the ONLY personal data; §8 no longer says inputs are not shared', () => {
  const en3 = sec('privacy', 'en', 3), he3 = sec('privacy', 'he', 3), en8 = sec('privacy', 'en', 8), he8 = sec('privacy', 'he', 8);
  assert.doesNotMatch(en3, /only personally identifying/i);
  assert.doesNotMatch(he3, /המידע המזהה אישית היחיד/);
  assert.match(en3, /other personal data described in sections 2, 4, 5 and 6/);
  assert.match(he3, /מידע אישי נוסף המתואר בסעיפים 2, 4, 5 ו-6/);
  assert.doesNotMatch(en8, /do not sell, share, or repurpose/i);
  assert.match(en8, /only with the service providers/);
  assert.match(he8, /רק עם ספקי השירות/);
});

test('privacy (29 October 2026: funnel counters) and terms (28 October 2026) carry the day they were updated in both languages; the accessibility statement is a separate document and keeps its own date', () => {
  assert.match(m.privacy.he.summary, /עודכן 29 באוקטובר 2026/); assert.match(m.privacy.en.summary, /Updated 29 October 2026/);
  assert.equal(m.terms.he.summary, 'עודכן לאחרונה: 28 באוקטובר 2026'); assert.equal(m.terms.en.summary, 'Last updated: 28 October 2026');
  assert.doesNotMatch(m.privacy.he.summary + m.privacy.en.summary, /יוני 2026|June 2026/);
  assert.match(m.accessibility.en.summary, /October 2026/);
});

test('the About page describes the engine as it is: models tried in turn, not raced', () => {
  const en = JSON.stringify(m.about.en); const he = JSON.stringify(m.about.he);
  assert.match(en, /tries AI models in turn — Gemini first, with Gemma and DeepSeek as backups/); assert.match(he, /מנסה מודלי AI בזה אחר זה — קודם Gemini, ו-Gemma ו-DeepSeek כגיבוי/);
  assert.match(en, /Cloudflare AI, FLUX and, for Star Yourself, Grok and Gemini/);
});

test('NEXT_PUBLIC_GEMINI_API_TIER and geminiTier() are gone (the direct Google free tier is not used in production, so the policy has no tier switch)', () => {
  assert.doesNotMatch(read('.env.example'), /GEMINI_API_TIER/);
  assert.doesNotMatch(read('constants/ai-provider-copy.js'), /geminiTier|GEMINI_API_TIER/);
});
