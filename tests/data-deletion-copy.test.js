// /data-deletion: the in-app path, the real (manual) processing timeline from config, and no payment provider anywhere.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const page = read('components/DataDeletionPage.jsx');

test('the page tells people how to start it in the app (account menu → "Delete my account", which exists and opens this page) and on the web', () => {
  assert.match(page, /In the app: open the account menu and choose "Delete my account" — this page opens with your email already filled in\./);
  assert.match(page, /באפליקציה: פתחו את תפריט החשבון ובחרו "מחק את החשבון שלי"/);
  const nav = read('components/Navbar.jsx');
  assert.match(nav, /href="\/data-deletion\?from=account"/); assert.match(nav, /'מחק את החשבון שלי' : 'Delete my account'/);
  assert.doesNotMatch(read('components/Navbar.jsx').slice(nav.indexOf('data-deletion?from=account') - 400, nav.indexOf('data-deletion?from=account')), /!native/, 'the account-menu entry is also available inside the Android app');
});

test('the timeline states what is real: manual processing after verification, the request log kept RETENTION.deletionLogDays, stored images expiring on their own — numbers come from config, and the owner-committed 30-day SLA', async () => {
  assert.match(page, /import \{ RETENTION \} from '\.\.\/config\/limits\.js'/);
  for (const k of ['deletionLogDays', 'posterObjectDays', 'panelObjectDays', 'characterObjectDays']) assert.ok(page.includes(`RETENTION.${k}`), k);
  assert.match(page, /then process it by hand — there is no automatic deletion yet/);
  assert.match(page, /ואז מטפלים בה ידנית — אין עדיין מחיקה אוטומטית/);
  assert.match(page, /Stored images expire on their own, with or without a request/);
  assert.doesNotMatch(page, /reasonable time|זמן סביר/, 'the vague "reasonable time" is replaced by the concrete timeline');
  // the owner-committed SLA: 30 days from receipt (from the user's confirmation when we must confirm first) — shown in the timeline, the form text and the success message, he + en
  assert.equal((page.match(/within 30 days of receiving it/g) || []).length, 3);
  assert.equal((page.match(/תוך 30 ימים מקבלתה/g) || []).length, 3);
  assert.match(page, /if we need to confirm it with you first, the 30 days count from your confirmation/); assert.match(page, /30 הימים נספרים מרגע האישור שלכם/);
  assert.doesNotMatch(page.replace(/\/\/.*$/gm, ''), /within (?!30 days)\d+ (?:days|hours)|תוך (?!30 ימים)\d+ (?:ימים|שעות)/, 'only the committed 30 days');
  const { MODAL_DATA } = await import('../constants/modalData.js');
  for (const lang of ['en', 'he']) assert.match(MODAL_DATA.privacy[lang].sections.find((x) => x.h.startsWith('9.')).p, lang === 'en' ? /within 30 days of receiving it/ : /תוך 30 ימים מקבלתה/);
});

test('the deletion list names a payment-provider customer ID only conditionally ("if one exists"), never Stripe, and hides it in the app', () => {
  const code = page.replace(/\/\/.*$/gm, '');
  assert.match(code, /מזהה הלקוח שלך אצל ספק התשלומים \(אם קיים\)/);
  assert.match(code, /Your payment-provider customer ID \(if one exists\)/);
  assert.match(code, /!\(native && \/ספק התשלומים\|payment-provider\/\.test\(line\)\)/);
  assert.doesNotMatch(code, /Stripe/i);
});

test('Hebrew additions are gender-neutral (plural / infinitive forms)', () => {
  const he = page.slice(page.indexOf('he: {'), page.indexOf('en: {'));
  for (const bad of [' פתח את תפריט', ' בחר "מחק', 'האימייל שלך כבר ממולא']) assert.ok(!he.includes(bad), bad);
  for (const good of ['פתחו את תפריט החשבון', 'אפשר למלא את הטופס', 'העמוד הזה נפתח עם האימייל שלכם']) assert.ok(he.includes(good), good);
});

test('the request record outlives the 30-day processing SLA (45 days), the pages and Privacy quote the same number from config, and the route uses it as the key TTL', async () => {
  const { RETENTION } = await import('../config/limits.js');
  const { MODAL_DATA } = await import('../constants/modalData.js');
  assert.equal(RETENTION.deletionLogDays, 45); assert.ok(RETENTION.deletionLogDays > 30 + 7, 'a safe margin past the SLA');
  for (const lang of ['en', 'he']) {
    const p4 = MODAL_DATA.privacy[lang].sections.find((x) => x.h.startsWith('4.')).p;
    assert.match(p4, lang === 'en' ? /A deletion request is kept for 45 days/ : /בקשת מחיקה נשמרת 45 ימים/);
  }
  assert.match(read('pages/api/request-deletion.js'), /ex: RETENTION\.deletionLogDays/);
  assert.equal(process.env.DELETION_LOG_DAYS, undefined, 'the test environment uses the default');
});
