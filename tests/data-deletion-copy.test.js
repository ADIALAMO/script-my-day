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

test('the timeline states what is real: manual processing after verification, the request log kept RETENTION.deletionLogDays, stored images expiring on their own — numbers come from config, no invented SLA', () => {
  assert.match(page, /import \{ RETENTION \} from '\.\.\/config\/limits\.js'/);
  for (const k of ['deletionLogDays', 'posterObjectDays', 'panelObjectDays', 'characterObjectDays']) assert.ok(page.includes(`RETENTION.${k}`), k);
  assert.match(page, /then process it by hand — there is no automatic deletion yet/);
  assert.match(page, /ואז מטפלים בה ידנית — אין עדיין מחיקה אוטומטית/);
  assert.match(page, /Stored images expire on their own, with or without a request/);
  assert.doesNotMatch(page, /reasonable time|זמן סביר/, 'the vague "reasonable time" is replaced by the concrete timeline');
  assert.doesNotMatch(page.replace(/\/\/.*$/gm, ''), /within \d+ (?:days|hours)|תוך \d+ (?:ימים|שעות)/, 'no promised processing deadline that the owner has not set');
});

test('no payment provider on the page (there is none): no customer ID, no payment provider, no Stripe — in both languages', () => {
  assert.doesNotMatch(page.replace(/\/\/.*$/gm, ''), /customer ID|מזהה לקוח|ספק התשלומים|payment[- ]provider|Stripe/i);
});

test('Hebrew additions are gender-neutral (plural / infinitive forms)', () => {
  const he = page.slice(page.indexOf('he: {'), page.indexOf('en: {'));
  for (const bad of [' פתח את תפריט', ' בחר "מחק', 'האימייל שלך כבר ממולא']) assert.ok(!he.includes(bad), bad);
  for (const good of ['פתחו את תפריט החשבון', 'אפשר למלא את הטופס', 'העמוד הזה נפתח עם האימייל שלכם']) assert.ok(he.includes(good), good);
});
