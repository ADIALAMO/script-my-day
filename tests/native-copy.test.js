import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { MODAL_DATA, modalDataFor } = await import('../constants/modalData.js');
const { getMsg, CODES, isNativeShell } = await import('../lib/messages.js');

// Anything that sells, prices or points to a purchase. (Free-tier wording like "unpaid" / "ללא תשלום" about an AI provider is not a purchase.)
const FORBIDDEN = /Stripe|\$\s?9\b|\b9\s?\$|9\$|upgrade|שדרג|שדרוג|subscription|מנוי|\bPro\b|\bGo Pro\b|פרו\b|waitlist|רשימת המתנה|רשימת ההמתנה|billing|חיוב|checkout|per month|לחודש\b/i;

test('the web copy is untouched by the native variant: modalDataFor(false) IS MODAL_DATA', () => {
  assert.equal(modalDataFor(false), MODAL_DATA);
});

// ── Pro is "coming soon": no price, no "cancel anytime", no processor name, nothing that is not implemented ─────────────────
const NOT_YET = /Stripe|\$\s?9\b|\b9\s?\$|9\$|cancel anytime|ביטול בכל עת|priority (?:queue|processing)|תור (?:עיבוד )?מועדף|reels? generation|יצירת רילז/i;

test('web Terms / Privacy / FAQ: Pro is "coming soon" — no price, no "Cancel anytime", no Stripe, no priority queue, no reels-as-Pro (he + en)', () => {
  const walk = (o, p = '') => (typeof o === 'string' ? [[p, o]] : o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => walk(v, `${p}.${k}`)) : []);
  const hits = walk(MODAL_DATA).filter(([, s]) => NOT_YET.test(s)).map(([p, s]) => `${p}: …${s.slice(Math.max(0, s.search(NOT_YET) - 30), s.search(NOT_YET) + 40)}…`);
  assert.deepEqual(hits, []);
  const json = JSON.stringify(MODAL_DATA);
  assert.match(json, /Pro is not yet available and no payments are collected today/);
  assert.match(json, /מסלול Pro עדיין אינו זמין וכיום לא נגבים תשלומים/);
  assert.match(json, /Billing, Renewal & Cancellation \(when Pro launches\)/);
  assert.match(json, /חיוב, חידוש וביטול מנוי \(עם השקת Pro\)/);
  assert.match(json, /through a payment provider/);
});

test('web Terms §2 (plans): the planned Pro limits are labelled "coming soon / planned" and the not-yet-available sentence is there', () => {
  for (const lang of ['en', 'he']) {
    const plans = MODAL_DATA.terms[lang].sections.find((s) => /Plans, Quotas|מסלולים, מכסות/.test(s.h)).p;
    assert.doesNotMatch(plans, NOT_YET);
    assert.match(plans, lang === 'en' ? /Pro plan \(coming soon; planned limits\)/ : /מסלול Pro \(בקרוב; מגבלות מתוכננות\)/);
    assert.match(plans, lang === 'en' ? /Pro is not yet available: any planned price or limit may change before launch, and no payments are collected today\./ : /עדיין אינו זמין: כל מחיר או מגבלה מתוכננים עשויים להשתנות לפני ההשקה, וכיום לא נגבים תשלומים\./);
  }
});

test('web quota / upsell messages never sell Pro as available now (no "upgrade", no "go Pro")', () => {
  for (const code of [CODES.NEEDS_PRO, CODES.QUOTA_COMIC_MONTH, CODES.IDENTITY_LIFETIME_USED]) for (const lang of ['en', 'he']) {
    const t = getMsg(code, lang, undefined, { native: false });
    assert.doesNotMatch(t, /upgrade|go Pro|שדרג|עבור ל-Pro/i, `${code}/${lang}: ${t}`);
    assert.match(t, lang === 'en' ? /coming soon/ : /בקרוב|שיגיע/, `${code}/${lang} says coming soon`);
  }
});

test('native app: the Terms / Privacy / FAQ do not even say "coming soon" (nothing about Pro at all)', () => {
  const native = JSON.stringify(modalDataFor(true));
  assert.doesNotMatch(native, /coming soon|not yet available|payment provider|ספק התשלומים|ספק תשלומים|בקרוב|עדיין אינו זמין/i);
});

test('native app: no price, subscription, Stripe, waitlist or "upgrade" wording anywhere in the FAQ / Terms / Privacy / About / Support copy (he + en)', () => {
  const native = modalDataFor(true);
  const walk = (o, p = '') => (typeof o === 'string' ? [[p, o]] : o && typeof o === 'object' ? Object.entries(o).flatMap(([k, v]) => walk(v, `${p}.${k}`)) : []);
  const strings = walk(native);
  assert.ok(strings.length > 100, `${strings.length} strings scanned`);
  const hits = strings.filter(([, s]) => FORBIDDEN.test(s)).map(([p, s]) => `${p}: …${s.match(FORBIDDEN) ? s.slice(Math.max(0, s.search(FORBIDDEN) - 30), s.search(FORBIDDEN) + 40) : ''}…`);
  assert.deepEqual(hits, []);
});

test('native app: removed sections are really gone and the remaining headings are renumbered 1..n without gaps', () => {
  const native = modalDataFor(true);
  for (const doc of ['terms', 'privacy']) {
    for (const lang of ['he', 'en']) {
      const nums = native[doc][lang].sections.map((s) => Number(/^(\d+)\./.exec(s.h)?.[1]));
      assert.deepEqual(nums, nums.map((_, i) => i + 1), `${doc}/${lang}`);
      assert.equal(native[doc][lang].sections.length, MODAL_DATA[doc][lang].sections.length - (doc === 'terms' ? 1 : 1), `${doc}/${lang}: one section dropped`);
    }
  }
  assert.ok(!native.support.en.sections.some((s) => /upgrade/i.test(s.h)));
  assert.equal(native.support.en.sections.length, MODAL_DATA.support.en.sections.length - 1);
  assert.equal(native.about.he.sections.length, MODAL_DATA.about.he.sections.length - 1);
});

test('Terms: the WHOLE service is 18+ (neutral reason, self-declaration) and Star Yourself keeps its own 18+ confirmation — in both languages and in the native variant too', () => {
  for (const data of [MODAL_DATA, modalDataFor(true)]) {
    const age = (lang) => data.terms[lang].sections.find((s) => /Age Restriction|הגבלת גיל/.test(s.h)).p;
    assert.match(age('en'), /LifeScript is intended for adults aged 18 and over\. The AI services we use require adult users, and generated stories may include mature themes\./);
    assert.match(age('he'), /LifeScript מיועדת לבני 18 ומעלה\. שירותי ה-AI שבהם אנחנו משתמשים דורשים משתמשים בוגרים, והסיפורים שנוצרים עשויים לכלול נושאים בוגרים\./);
    assert.match(age('en'), /Star Yourself.*confirm once/); assert.match(age('he'), /לככב בסיפור.*אישור נפרד/);
    assert.doesNotMatch(age('en') + age('he'), /guardian|אפוטרופוס|paid subscription|מנוי/i);
    const face = (lang) => data.terms[lang].sections.find((s) => /Star Yourself|לככב בסיפור/.test(s.h)).p;
    assert.match(face('en'), /aged 18 and over/); assert.match(face('en'), /you are 18 or older/);
    assert.match(face('he'), /בני 18 ומעלה/);
  }
});

test('getMsg in the native shell: the upgrade / "go Pro" messages are neutral; everything else keeps its meaning; web copy unchanged', () => {
  const sellers = [CODES.NEEDS_PRO, CODES.QUOTA_COMIC_MONTH, CODES.IDENTITY_LIFETIME_USED];
  for (const code of sellers) for (const lang of ['en', 'he']) {
    assert.doesNotMatch(getMsg(code, lang, undefined, { native: true }), FORBIDDEN, `${code}/${lang}`);
    assert.match(getMsg(code, lang, undefined, { native: false }), /Pro|פרו|Pro/, `${code}/${lang} web copy keeps the upgrade text`);
  }
  // every other code, native: only the messages addressed to people who ALREADY have the Pro plan may say "Pro plan"
  const PRO_PLAN_NOTICES = new Set([CODES.QUOTA_SCRIPT_PRO, CODES.QUOTA_SCRIPT_PRO_MONTH, CODES.QUOTA_COMIC_PRO_MONTH]);
  for (const code of Object.values(CODES)) for (const lang of ['en', 'he']) {
    const text = getMsg(code, lang, { limit: 3, reset: 'x' }, { native: true });
    if (text === code || PRO_PLAN_NOTICES.has(code)) continue;
    assert.doesNotMatch(text, FORBIDDEN, `${code}/${lang}: ${text}`);
  }
  assert.equal(isNativeShell(), false, 'plain Node: no Capacitor global');
  globalThis.window = { Capacitor: { isNativePlatform: () => true } };
  try { assert.equal(isNativeShell(), true); assert.doesNotMatch(getMsg(CODES.NEEDS_PRO, 'en'), FORBIDDEN, 'default flag comes from the Capacitor global'); }
  finally { delete globalThis.window; }
});

// ── Source guard: a pricing / upgrade literal in a component must sit next to a native check ─────────────────────────────────
const LITERAL = /Upgrade to Pro|Go Pro|\bPro Only\b|פרו בלבד|שדרג ל-?[Pp]ro|שדרג לצפייה|Upgrade to view|\$9\/month|9\$ לחודש|Manage Subscription|נהל מנוי|Casting yourself is a Pro feature|ליהוק עצמי הוא פיצ׳ר Pro/;
const GUARDED = ['components/Navbar.jsx', 'components/LaunchTicket.jsx', 'components/CharacterModal.jsx', 'components/StoryboardView.jsx', 'components/AuthModal.jsx', 'pages/index.js'];
const WEB_ONLY = new Set(['components/UpgradeModal.jsx', 'components/WaitlistModal.jsx']);   // only ever opened through openAuthModal('upgrade'), a no-op in the app

test('every component that carries pricing / upgrade text uses useNative(); the upgrade route is a no-op natively; nothing else has such text', () => {
  for (const rel of GUARDED.filter((f) => f !== 'pages/index.js')) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    assert.match(src, /useNative\(\)/, `${rel} must call useNative()`);
    assert.match(src, /import \{ useNative \}/, `${rel} must import the hook`);
  }
  const index = readFileSync(path.join(ROOT, 'pages/index.js'), 'utf8');
  assert.match(index, /context === 'upgrade' && native\) return;/);
  assert.match(index, /modalDataFor\(native\)/);
  assert.match(readFileSync(path.join(ROOT, 'components/LegalPage.jsx'), 'utf8'), /modalDataFor\(native\)/);
  // specific hides: Manage Subscription, the Pro card of the launch ticket, the AuthModal upgrade context
  assert.match(readFileSync(path.join(ROOT, 'components/Navbar.jsx'), 'utf8'), /\{isPro && hasBillingCustomer && !native && \(/);   // and only with a payment-provider customer on record (api/me.hasBillingCustomer)
  assert.match(readFileSync(path.join(ROOT, 'components/LaunchTicket.jsx'), 'utf8'), /native && d\.icon === "👑"/);
  assert.match(readFileSync(path.join(ROOT, 'components/AuthModal.jsx'), 'utf8'), /native && context === 'upgrade'/);
  // the launch ticket: on native the button/badge/title/description only refer to the invite bonus, and the web Pro card has no price
  const ticket = readFileSync(path.join(ROOT, 'components/LaunchTicket.jsx'), 'utf8');
  assert.match(ticket, /badge: native \?/); assert.match(ticket, /title: native \?/); assert.match(ticket, /desc: native/);
  assert.match(ticket, /Pro plan — coming soon/); assert.doesNotMatch(ticket, NOT_YET);
  assert.match(readFileSync(path.join(ROOT, 'components/WaitlistModal.jsx'), 'utf8').replace(/\s+/g, ' '), /COMING SOON/);
  assert.doesNotMatch(readFileSync(path.join(ROOT, 'components/WaitlistModal.jsx'), 'utf8'), /priority queue|תור מועדף|reels/i);
  // and the web-only modals are still the ONLY other places with such literals
  const walk = (dir) => readdirSync(path.join(ROOT, dir)).flatMap((f) => { const rel = `${dir}/${f}`; return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : [rel]; });
  const others = walk('components').filter((f) => /\.jsx?$/.test(f) && !GUARDED.includes(f) && !WEB_ONLY.has(f));
  const extra = others.filter((f) => LITERAL.test(readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepEqual(extra, [], 'a new component with pricing text must use useNative()');
});

// ── Trademarks ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('no third-party marks in UI strings, prompts, style names or store-listing copy', () => {
  const BAD = /marvel|x-men|xmen|sin city|\bimax\b|oscar-worthy|disney|pixar|ghibli|netflix|מארוול|אוסקר/i;
  const files = ['components', 'pages', 'constants', 'lib', 'hooks', 'store-listing'].flatMap(function walk(dir) {
    return readdirSync(path.join(ROOT, dir)).flatMap((f) => { const rel = `${dir}/${f}`; const st = statSync(path.join(ROOT, rel)); return st.isDirectory() ? walk(rel) : /\.(jsx?|md)$/.test(f) ? [rel] : []; });
  });
  const offenders = [];
  for (const rel of files) {
    if (rel === 'lib/gender-detect.js') continue;   // a first-name list ("oscar" as a given name)
    readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      if (!BAD.test(line)) return;
      if (/^\s*marvel: \{/.test(line) || /value: 'marvel'/.test(line) || /key stays `marvel`/.test(line) || /`marvel`/.test(line)) return;   // the internal style KEY, never user-facing
      offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, []);
  const styles = readFileSync(path.join(ROOT, 'components/ScriptOutput.jsx'), 'utf8');
  assert.match(styles, /RETRO COMIC/); assert.match(styles, /קומיקס רטרו/);
});

// ── Minimum age is 18 for the whole service: no 13+ / teens anywhere users (or the store) can read, and the notices exist ─────────────────
test('no user-facing text or store-listing file says 13+, "13 or older", an age of 13 or teens/minors-are-welcome wording', () => {
  const BAD = /\b13\s?\+|13 or older|13 and (?:above|over|older)|aged 13|ages 13|age of 13|age 13|מגיל 13|גיל 13|13 ומעלה|\bteens?\b|teenagers?|teenage|בני נוער|נוער|family-friendly|all ages|כל הגילאים/i;
  const walk = (dir) => readdirSync(path.join(ROOT, dir)).flatMap((f) => { const rel = `${dir}/${f}`; const st = statSync(path.join(ROOT, rel)); return st.isDirectory() ? walk(rel) : /\.(jsx?|md)$/.test(f) ? [rel] : []; });
  const files = [...walk('components'), ...walk('pages'), ...walk('constants'), ...walk('store-listing')].filter((f) => !/showcase\.js$|proposed-description/.test(f));
  const offenders = [];
  for (const rel of files) readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => { if (BAD.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 90)}`); });
  assert.deepEqual(offenders, []);
  const walkData = (o) => (typeof o === 'string' ? [o] : o && typeof o === 'object' ? Object.values(o).flatMap(walkData) : []);
  for (const data of [MODAL_DATA, modalDataFor(true)]) assert.deepEqual(walkData(data).filter((s) => BAD.test(s)).map((s) => s.slice(0, 80)), []);
});

test('sign-in shows the 18+ self-declaration with Terms and Privacy links (he + en); the footer carries the notice for guests; nothing calls it age verification', () => {
  const auth = readFileSync(path.join(ROOT, 'components/AuthModal.jsx'), 'utf8');
  assert.match(auth, /By continuing you confirm you are 18 or older and agree to the/);
  assert.match(auth, /בהמשך אתה מאשר שאתה בן\/בת 18 ומעלה ומסכים ל/);
  assert.match(auth, /href="\/terms"/); assert.match(auth, /href="\/privacy"/);
  const index = readFileSync(path.join(ROOT, 'pages/index.js'), 'utf8');
  assert.match(index, /LifeScript is intended for adults aged 18 and over\./); assert.match(index, /LifeScript מיועדת לבני 18 ומעלה\./);
  for (const rel of ['components/AuthModal.jsx', 'pages/index.js', 'constants/modalData.js', 'constants/limits-copy.js']) assert.doesNotMatch(readFileSync(path.join(ROOT, rel), 'utf8').replace(/never "age verification"|not age verification/gi, ''), /age[- ]verif|אימות גיל/i, rel);
});

test('no visible "Stripe" or "Together AI" in any component (comments excepted): the sign-in modal names no payment provider or AI vendor, the data-deletion page is processor-neutral', () => {
  const offenders = [];
  for (const f of readdirSync(path.join(ROOT, 'components')).filter((x) => /\.jsx?$/.test(x))) {
    readFileSync(path.join(ROOT, 'components', f), 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line)) return;
      if (/Stripe|Together AI/i.test(line.replace(/\/\/.*$/, '').replace(/\{\/\*.*\*\/\}/, ''))) offenders.push(`components/${f}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(offenders, []);
  const del = readFileSync(path.join(ROOT, 'components/DataDeletionPage.jsx'), 'utf8');
  assert.match(del, /payment-provider customer ID \(if any\)/); assert.match(del, /!\(native && \/ספק התשלומים\|payment-provider\/\.test\(line\)\)/);
});
