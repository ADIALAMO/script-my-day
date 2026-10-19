// Privacy / terms wording guards (see the review note in constants/modalData.js).
// Guard: it must never promise "no retention" / "not stored" by third-party AI providers, which we cannot verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODAL_DATA } from '../constants/modalData.js';

test('no unverifiable no-retention / no-training promise about AI providers, in either language', () => {
  const text = JSON.stringify({ p: MODAL_DATA.privacy, t: MODAL_DATA.terms });
  assert.doesNotMatch(text, /אינם שומרים|אינו שומר|לא שומרים את התוכן|do(es)? not (store|retain|keep) your|no retention|zero retention|never retain/i);
});

test('privacy text names the provider categories, says content is sent to them, in he + en', () => {
  for (const lang of ['he', 'en']) {
    const s7 = MODAL_DATA.privacy[lang].sections.find((s) => /^7\./.test(s.h));
    for (const name of ['Google', 'OpenRouter', 'Cloudflare']) assert.ok(s7.p.includes(name), `${lang}: ${name}`);
    assert.match(s7.p, lang === 'he' ? /תמונת הפנים/ : /face photo/);
  }
});

test('the provider-policy review note stays next to the privacy text, and no owner-confirmation TODO is left', () => {
  const src = readFileSync(new URL('../constants/modalData.js', import.meta.url), 'utf8');
  assert.match(src, /Re-read it whenever a provider, a plan or a retention setting changes/);
  assert.doesNotMatch(src, /OWNER-CONFIRM/);
});

// ── retention numbers in the wording must be the ones the code enforces (config/limits.js) ──────────
import { execFileSync } from 'node:child_process';
import { RETENTION, GUEST_RETENTION, COMIC } from '../config/limits.js';

const enforced = () => new Set([RETENTION.characterPointerDays, RETENTION.characterObjectDays, RETENTION.posterObjectDays, RETENTION.panelObjectDays, RETENTION.deletionLogDays, RETENTION.referralCookieDays, GUEST_RETENTION.ipDays, Math.round(COMIC.sessionTtlSec / 3600)]);
const UNIT = /(\d+)\s*(?:days?|hours?|ימים|יום|שעות)/gi;

test('every "N days/hours" in the privacy and terms text is a retention value that exists in config/limits.js', () => {
  const text = JSON.stringify({ p: MODAL_DATA.privacy, t: MODAL_DATA.terms });
  const found = [...text.matchAll(UNIT)].map((m) => Number(m[1]));
  assert.ok(found.length >= 6, `expected several retention statements, found ${found.length}`);
  for (const n of found) assert.ok(enforced().has(n), `privacy/terms state a retention of ${n} that config/limits.js does not enforce (allowed: ${[...enforced()].join(', ')})`);
});

test('the face-photo sections state the pointer retention and the character-file retention from config and say the original is deleted (posters/panels are described in §1)', () => {
  for (const lang of ['he', 'en']) {
    const s2 = MODAL_DATA.privacy[lang].sections.find((s) => /^2\./.test(s.h)).p;
    const t5 = MODAL_DATA.terms[lang].sections.find((s) => /^5\./.test(s.h)).p;
    for (const s of [s2, t5]) {
      assert.ok(s.includes(String(RETENTION.characterPointerDays)), `${lang}: pointer days`);
      assert.ok(s.includes(String(RETENTION.characterObjectDays)), `${lang}: character file days`);
      assert.deepEqual([...s.matchAll(UNIT)].map((m) => Number(m[1])).sort((a, b) => a - b), [RETENTION.characterPointerDays, RETENTION.characterObjectDays], `${lang}: the only periods named are the Redis pointer and the character file (R2 lifecycle rule + margin)`);
      assert.match(s, lang === 'he' ? /המקורית נמחקת/ : /original (face )?photo is deleted/);
      assert.match(s, lang === 'he' ? /נמחק אוטומטית/ : /deleted automatically/);
      assert.match(s, lang === 'he' ? /ידנית/ : /manually/);
    }
  }
});

test('changing the retention in config changes the wording (nothing is hard-coded): CHARACTER_POINTER_DAYS=45', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const m=await import('./constants/modalData.js');const d=m.MODAL_DATA;console.log(JSON.stringify([d.privacy.en.sections[1].p,d.terms.he.sections[4].p]))"],
  { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, CHARACTER_POINTER_DAYS: '45' }, encoding: 'utf8' });
  const [en, he] = JSON.parse(out);
  assert.match(en, /45 days/); assert.doesNotMatch(en, /90 days/);
  assert.match(he, /45 ימים/);
});

// ── wording that must match what the code actually does ────────────────────────────────────────────
const sec = (doc, lang, n) => MODAL_DATA[doc][lang].sections.find((s) => s.h.startsWith(`${n}.`)).p;

test('§1 describes posters/panels as a random, unlisted address that anyone holding it can open (no "unguessable" promise)', () => {
  assert.doesNotMatch(sec('privacy', 'en', 1), /unguessable/i);
  assert.doesNotMatch(sec('privacy', 'he', 1), /לא ניתנת לניחוש/);
  assert.match(sec('privacy', 'en', 1), /random web address that is not listed anywhere/);
  assert.match(sec('privacy', 'en', 1), /anyone who has the address can open the file/);
  assert.match(sec('privacy', 'he', 1), /כתובת אינטרנט אקראית שאינה מופיעה באף רשימה/);
  assert.match(sec('privacy', 'he', 1), /מי שמחזיק בכתובת יכול לפתוח את הקובץ/);
  // older files: be honest that they may sit at a less random address, and offer deletion
  assert.match(sec('privacy', 'en', 1), /Files created before October 2026 may be stored at a less random address, and you can ask us to delete them \(section 9\)\./);
  assert.match(sec('privacy', 'he', 1), /קבצים שנוצרו לפני אוקטובר 2026 עשויים להישמר בכתובת פחות אקראית, וניתן לבקש את מחיקתם \(סעיף 9\)\./);
  // posters / panels ARE deleted automatically (R2 lifecycle rules 60 / 30 days — numbers from config), and the text no longer says otherwise
  assert.match(sec('privacy', 'en', 1), /Posters are deleted automatically from storage about 60 days after they are created and comic panels about 30 days after/);
  assert.match(sec('privacy', 'he', 1), /פוסטרים נמחקים אוטומטית מהאחסון כ-60 ימים לאחר יצירתם ופאנלי קומיקס כ-30 ימים לאחר יצירתם/);
  assert.doesNotMatch(sec('privacy', 'en', 1), /do not currently promise automatic deletion/); assert.doesNotMatch(sec('privacy', 'he', 1), /לא מתחייבים כרגע על מחיקה אוטומטית/);
});

test('§8 points to every section where data goes to providers or the team: 3, 4 (Telegram), 5 and 7 — and §4 really mentions the Telegram forwarding', () => {
  assert.match(sec('privacy', 'en', 8), /\(sections 3, 4, 5 and 7\)/);
  assert.match(sec('privacy', 'he', 8), /\(סעיפים 3, 4, 5 ו-7\)/);
  assert.match(sec('privacy', 'en', 4), /private Telegram chat/);
  assert.match(sec('privacy', 'he', 4), /צ'אט טלגרם פרטי/);
});

test('§2 says earlier photos may still be stored (plain text, no brackets) and that the sheet address is openable by anyone holding it', () => {
  assert.match(sec('privacy', 'en', 2), /Photos uploaded before this change may still be stored, and you can ask us to delete them\./);
  assert.match(sec('privacy', 'he', 2), /תמונות שהועלו לפני שינוי זה עשויות עדיין להיות שמורות, וניתן לבקש את מחיקתן\./);
  assert.match(sec('privacy', 'en', 2), /anyone who has a file's web address can open it/);
  assert.match(sec('privacy', 'he', 2), /כל מי שמחזיק בכתובת האינטרנט של קובץ יכול לפתוח אותו/);
  for (const lang of ['he', 'en']) assert.doesNotMatch(sec('privacy', lang, 2), /[\[\]]/);
});

test('§4 covers rate-limit records, the deletion log with e-mail/note/IP, Telegram forwarding (masked e-mail) and hosting logs', () => {
  assert.match(sec('privacy', 'en', 4), /rate-limit records keyed by IP address/);
  assert.match(sec('privacy', 'en', 4), /together with your email address, your note and your IP address/);
  assert.match(sec('privacy', 'en', 4), /private Telegram chat[^.]*partly hidden email address/);
  // waitlist: what is stored, the one purpose, retention + removal — no price, no payment processor, and the Telegram "partly hidden" line is said ONCE (above)
  const w4 = sec('privacy', 'en', 4);
  assert.match(w4, /If you join the Pro waitlist we store your email address, your language, the date, the version of the notice you saw and, if you were signed in, your account id\. We use them only to tell you once when Pro is available, and keep them until then or until you ask us to remove them \(through the data-deletion page or by email\)\./);
  assert.equal((w4.match(/partly hidden email address/g) || []).length, 1);
  assert.doesNotMatch(w4.slice(w4.indexOf('If you join the Pro waitlist')), /\$|price|Stripe|payment|per month/i);
  const h4 = sec('privacy', 'he', 4);
  assert.match(h4, /אם תצטרפו לרשימת ההמתנה ל-Pro, נשמור את כתובת האימייל, את השפה, את התאריך, את גרסת ההודעה שראיתם, ואם הייתם מחוברים — את מזהה החשבון\. נשתמש בהם רק כדי לעדכן אתכם פעם אחת כש-Pro יהיה זמין, ונשמור אותם עד אז או עד שתבקשו להסיר אותם \(דרך עמוד מחיקת הנתונים או במייל\)\./);
  assert.doesNotMatch(h4.slice(h4.indexOf('אם תצטרפו')), /\$|מחיר|Stripe|תשלום/);
  assert.match(sec('privacy', 'en', 4), /standard server logs/);
  assert.match(sec('privacy', 'he', 4), /צ'אט טלגרם פרטי/);
  assert.match(sec('privacy', 'he', 4), /יומני שרת סטנדרטיים/);
});

test('§5 Payments: Pro is not yet available, no payments today, "a payment provider" (no Stripe); §3/§4 mention no subscription and no payment-provider customer ID (none exists today)', () => {
  assert.match(sec('privacy', 'en', 5), /Pro is not yet available and no payments are collected today\. When Pro launches, subscription payments will be processed entirely by a payment provider/);
  assert.match(sec('privacy', 'he', 5), /עדיין אינו זמין וכיום לא נגבים תשלומים/);
  assert.match(sec('privacy', 'he', 5), /ספק תשלומים/);
  for (const lang of ['he', 'en']) {
    assert.doesNotMatch(JSON.stringify(MODAL_DATA.privacy[lang]), /Stripe/);
    for (const n of [3, 4]) assert.doesNotMatch(sec('privacy', lang, n), /customer ID|מזהה לקוח|subscription|מנוי|Stripe/i, `§${n} ${lang}`);
    assert.match(sec('privacy', lang, 4), lang === 'en' ? /your plan \(Free or Pro, including any Pro access we granted\)/ : /המסלול שלך \(חינמי או Pro, כולל גישת Pro שהענקנו\)/);
    assert.match(sec('privacy', lang, 3), lang === 'en' ? /to manage your account and quota\./ : /כדי לנהל את החשבון והמכסה\./);
  }
});

test('§6 names Vercel Web Analytics (no cookies to identify visitors, aggregate) and Google Analytics only after consent; no Speed Insights, no user-typed-text caveat', () => {
  for (const lang of ['he', 'en']) {
    const t = sec('privacy', lang, 6);
    assert.match(t, /Vercel Web Analytics/);
    assert.match(t, /Google Analytics/);
    assert.doesNotMatch(t, /Speed Insights|Vercel Analytics/);
    assert.doesNotMatch(t, /producer|מפיק|film title|שם הסרט/);
  }
  assert.match(sec('privacy', 'en', 6), /does not use cookies to identify visitors/);
  // GA: website only, only after acceptance, never in the Android app; Vercel: aggregate approximate location / device / OS / browser, web + app
  assert.match(sec('privacy', 'en', 6), /On the website only, and only after you accept analytics cookies, we also load Google Analytics/);
  assert.match(sec('privacy', 'en', 6), /consent choice that is stored on your device \(Google Consent Mode: analytics storage is "denied" by default and becomes "granted" only when you accept; advertising storage is always denied\)\. Before you decide it is not loaded and nothing is sent to Google; if you accept it is loaded and starts counting your visits; if you decline it is never loaded\./);
  assert.match(sec('privacy', 'en', 6), /It is never loaded in the Android app\./);
  assert.match(sec('privacy', 'en', 6), /approximate location \(country, region and city\), device type, operating system and browser/);
  assert.match(sec('privacy', 'en', 6), /It runs on the website and in the Android app\./);
  assert.match(sec('privacy', 'he', 6), /באתר בלבד, ורק לאחר שתאשרו עוגיות אנליטיקה, אנחנו טוענים גם את Google Analytics/);
  assert.match(sec('privacy', 'he', 6), /Google Analytics פועל לפי בחירת הסכמה השמורה במכשיר שלכם \(Google Consent Mode: אחסון האנליטיקה מוגדר כברירת מחדל כ-"denied" והופך ל-"granted" רק כשתאשרו; אחסון הפרסום חסום תמיד\)/);
  assert.match(sec('privacy', 'he', 6), /הוא אינו נטען לעולם באפליקציית האנדרואיד\./);
  assert.match(sec('privacy', 'he', 6), /מיקום משוער \(מדינה, אזור ועיר\), סוג מכשיר, מערכת הפעלה ודפדפן/);
  assert.match(sec('privacy', 'he', 6), /הוא פועל באתר ובאפליקציית האנדרואיד\./);
  assert.doesNotMatch(sec('privacy', 'he', 6).slice(sec('privacy', 'he', 6).indexOf('באתר בלבד')), /תאשר |שלך כדי/, 'the new Hebrew GA sentence is gender-neutral');
});

test('terms §5: we ourselves do not train on or sell the photo; providers act under their own terms (no "share beyond processing" promise)', () => {
  assert.match(sec('terms', 'en', 5), /We ourselves do not use the photo to train models or sell it; the AI providers that process it act under their own terms/);
  assert.doesNotMatch(sec('terms', 'en', 5), /share it beyond the processing required/);
  assert.match(sec('terms', 'he', 5), /אנחנו עצמנו לא משתמשים בתמונה לאימון מודלים ולא מוכרים אותה; ספקי ה-AI שמעבדים אותה פועלים לפי תנאיהם/);
  assert.doesNotMatch(sec('terms', 'he', 5), /לא משתפים אותה מעבר לעיבוד הנדרש/);
});

test('terms last-updated date is October 2026 in both languages', () => {
  assert.equal(MODAL_DATA.terms.he.summary, 'עודכן לאחרונה: אוקטובר 2026');
  assert.equal(MODAL_DATA.terms.en.summary, 'Last updated: October 2026');
});

test('18+ wording (DRAFT, needs owner/legal review): Terms §5 and Privacy §2 state the age rules, the account record with its time, and the real retention — in he + en', () => {
  const t5 = (l) => sec('terms', l, 5), p2 = (l) => sec('privacy', l, 2);
  assert.match(t5('en'), /intended for adults aged 18 and over/); assert.doesNotMatch(t5('en'), /\b13\b/);
  assert.match(t5('en'), /Upload only a photo of yourself; do not upload a photo of another person without that person's consent, and never upload photos of minors/);
  assert.match(t5('en'), /appear to depict minors, or that are sexual or otherwise prohibited, are blocked and may be removed/);
  assert.match(t5('en'), /You can report generated content/);
  assert.match(t5('he'), /מיועד לבני 18 ומעלה/); assert.doesNotMatch(t5('he'), /\b13\b/);
  assert.match(t5('he'), /אסור להעלות תמונה של אדם אחר ללא הסכמתו, ואסור להעלות תמונות של קטינים/);
  assert.match(t5('he'), /נחסמות ועשויות להימחק/); assert.match(t5('he'), /ניתן לדווח על תוכן שנוצר/);
  assert.match(p2('en'), /checked automatically/); assert.match(p2('en'), /your account stores that you confirmed you are 18 or older, together with the time of the confirmation/);
  assert.match(p2('he'), /נבדקת אוטומטית/); assert.match(p2('he'), /החשבון שלך שומר שאישרת שאתה בן\/בת 18 ומעלה, יחד עם מועד האישור/);
  // the original is deleted after EVERY attempt now — the old "kept if the sheet fails" sentence must be gone
  assert.doesNotMatch(p2('en'), /original is kept/); assert.doesNotMatch(p2('he'), /המקור נשמר/);
  assert.match(p2('en'), /Remove my character/); assert.match(p2('he'), /הסר את הדמות שלי/);
});

test('R2 lifecycle numbers (dashboard: characters 90, posters 60, panels 30 days): the promises come from config, characters get "about 100" for lag, and nothing says posters/panels are kept forever', () => {
  assert.deepEqual([RETENTION.characterObjectDays, RETENTION.posterObjectDays, RETENTION.panelObjectDays], [100, 60, 30], 'defaults = real rules (90→"within about 100" for lag, 60, 30); change them together with the dashboard');
  assert.ok(RETENTION.characterObjectDays >= RETENTION.characterPointerDays, 'the file promise is never shorter than the pointer');
  for (const lang of ['he', 'en']) for (const [doc, n] of [['privacy', 2], ['terms', 5]]) {
    const t = sec(doc, lang, n);
    assert.match(t, lang === 'he' ? /קובץ גיליון הדמות[^.;]*נמחק אוטומטית תוך כ-100 ימים מרגע ההעלאה/ : /Character Sheet file[^.;]*deleted automatically within about 100 days of the upload/, `${doc}/${lang}`);
    assert.match(t, lang === 'he' ? /הסר את הדמות שלי/ : /Remove my character/, `${doc}/${lang}`);
  }
  for (const doc of ['privacy', 'terms']) for (const lang of ['he', 'en']) {
    const all = MODAL_DATA[doc][lang].sections.map((s) => s.p).join('\n');
    assert.doesNotMatch(all, /no automatic deletion|do not currently promise automatic deletion|ללא מחיקה אוטומטית|אין כרגע מחיקה אוטומטית|לא מתחייבים כרגע על מחיקה אוטומטית/i, `${doc}/${lang}: stale "kept forever" wording`);
  }
});

test('changing the object retention in config changes the wording: CHARACTER_OBJECT_DAYS=120, POSTER_OBJECT_DAYS=45, PANEL_OBJECT_DAYS=14', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const m=await import('./constants/modalData.js');const d=m.MODAL_DATA;console.log(JSON.stringify([d.privacy.en.sections[1].p,d.terms.he.sections[4].p,d.privacy.en.sections[0].p,d.privacy.he.sections[0].p]))"],
  { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, CHARACTER_OBJECT_DAYS: '120', POSTER_OBJECT_DAYS: '45', PANEL_OBJECT_DAYS: '14' }, encoding: 'utf8' });
  const [en, he, en1, he1] = JSON.parse(out);
  assert.match(en, /within about 120 days/); assert.doesNotMatch(en, /about 100 days/); assert.match(he, /כ-120 ימים/);
  assert.match(en1, /about 45 days after they are created and comic panels about 14 days/); assert.match(he1, /כ-45 ימים[^.]*כ-14 ימים/);
});

test('§7: the apparent-minor photo check is described as best-effort, never age verification, and as FAILING CLOSED (photo not used, nothing stored or generated, retry) — he + en', () => {
  assert.match(sec('privacy', 'en', 7), /a best-effort check that cannot confirm the age of anyone\. If this check cannot run \(for example during a provider outage\), the photo is not used: nothing is stored or generated, nothing is used from your quota, and you can try again in a moment\./);
  assert.match(sec('privacy', 'he', 7), /בדיקה מאמץ סביר שאינה יכולה לאשר את גילו של איש\. אם הבדיקה אינה יכולה לפעול \(למשל בעת תקלה אצל ספק\), לא נעשה בתמונה שימוש: דבר אינו נשמר או נוצר, לא נוצל דבר מהמכסה שלכם, ואפשר לנסות שוב בעוד רגע\./);
});

test('§7 names every AI provider the code really uses: Google Gemini API (free tier), OpenRouter, Cloudflare Workers AI, Cohere', () => {
  for (const lang of ['en', 'he']) { const t = sec('privacy', lang, 7); for (const n of ['Gemini API', 'OpenRouter', 'Cloudflare Workers AI', 'Cohere']) assert.ok(t.includes(n), `${lang}: ${n}`); }
  assert.match(sec('privacy', 'en', 7), /free \(unpaid\) Gemini API tier/); assert.match(sec("privacy", "he", 7), /במסלול החינמי \(ללא תשלום\) של Gemini API/);
});

test('§4: reporting a generated script stores/sends no text — only reason, genre, language reach the team, the script is hidden on the device (he + en)', () => {
  assert.match(sec('privacy', 'en', 4), /If you report a generated script \(text\), nothing about the script is stored or sent: our team only receives an alert with the reason, the genre and the language, and the script is hidden on your device\./);
  assert.match(sec('privacy', 'he', 4), /אם תדווחו על תסריט שנוצר \(טקסט\), דבר אינו נשמר או נשלח מהתסריט: הצוות שלנו מקבל רק התראה עם הסיבה, הז'אנר והשפה, והתסריט מוסתר במכשיר שלכם\./);
});

test('the accessibility statement is dated October 2026 (he + en), like the Terms and the Privacy policy', () => {
  assert.equal(MODAL_DATA.accessibility.he.summary, 'הצהרת הנגישות עודכנה לאחרונה באוקטובר 2026.');
  assert.equal(MODAL_DATA.accessibility.en.summary, 'This accessibility statement was last updated in October 2026.');
});
