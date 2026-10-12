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

const enforced = () => new Set([RETENTION.characterPointerDays, RETENTION.deletionLogDays, RETENTION.referralCookieDays, GUEST_RETENTION.ipDays, Math.round(COMIC.sessionTtlSec / 3600)]);
const UNIT = /(\d+)\s*(?:days?|hours?|ימים|יום|שעות)/gi;

test('every "N days/hours" in the privacy and terms text is a retention value that exists in config/limits.js', () => {
  const text = JSON.stringify({ p: MODAL_DATA.privacy, t: MODAL_DATA.terms });
  const found = [...text.matchAll(UNIT)].map((m) => Number(m[1]));
  assert.ok(found.length >= 6, `expected several retention statements, found ${found.length}`);
  for (const n of found) assert.ok(enforced().has(n), `privacy/terms state a retention of ${n} that config/limits.js does not enforce (allowed: ${[...enforced()].join(', ')})`);
});

test('the face-photo sections state the pointer retention from config, say the original is deleted, and give R2 NO invented period', () => {
  for (const lang of ['he', 'en']) {
    const s2 = MODAL_DATA.privacy[lang].sections.find((s) => /^2\./.test(s.h)).p;
    const t5 = MODAL_DATA.terms[lang].sections.find((s) => /^5\./.test(s.h)).p;
    for (const s of [s2, t5]) {
      assert.ok(s.includes(String(RETENTION.characterPointerDays)), `${lang}: pointer days`);
      assert.deepEqual([...s.matchAll(UNIT)].map((m) => Number(m[1])), [RETENTION.characterPointerDays], `${lang}: the only period named is the Redis pointer`);
      assert.match(s, lang === 'he' ? /המקורית נמחקת/ : /original (face )?photo is deleted/);
      assert.match(s, lang === 'he' ? /אין(?: כרגע)? מחיקה אוטומטית|ללא מחיקה אוטומטית/ : /no automatic deletion/);
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
  // the no-automatic-deletion sentence stays
  assert.match(sec('privacy', 'en', 1), /We do not currently promise automatic deletion of them/);
  assert.match(sec('privacy', 'he', 1), /אנחנו לא מתחייבים כרגע על מחיקה אוטומטית שלהם/);
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
  assert.match(sec('privacy', 'en', 4), /Waitlist email addresses are kept until you ask us to delete them/);
  assert.match(sec('privacy', 'en', 4), /standard server logs/);
  assert.match(sec('privacy', 'he', 4), /צ'אט טלגרם פרטי/);
  assert.match(sec('privacy', 'he', 4), /יומני שרת סטנדרטיים/);
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
  assert.match(sec('privacy', 'en', 6), /If you accept analytics cookies, we also use Google Analytics/);
  assert.match(sec('privacy', 'he', 6), /אם תאשר עוגיות אנליטיקה, אנחנו משתמשים גם ב-Google Analytics/);
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
