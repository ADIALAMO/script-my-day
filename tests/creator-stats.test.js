import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODAL_DATA } from '../constants/modalData.js';
import { RETENTION } from '../config/limits.js';
import { readActiveCreators, creatorsKey, creatorClass } from '../lib/creator-stats.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

/** a client whose pipeline answers each PFCOUNT from `table(keys)` */
function stubClient(table) {
  const asked = [];
  return { asked, pipeline() { const q = []; const p = { pfcount: (...k) => { q.push(k); asked.push(k); return p; }, exec: async () => q.map((k) => table(k)) }; return p; } };
}

test('readActiveCreators: 34 PFCOUNTs in one pipeline; returning = today ∩ previous 6 days by inclusion–exclusion, split in/guest', async () => {
  const now = new Date('2026-10-28T10:00:00Z');
  // in: today 4, previous-6 union 5, 7-day union 7 → returning 4+5-7 = 2 ; guest: today 3, prev6 2, 7d 5 → returning 0
  const client = stubClient((k) => {
    if (k.length === 1) return k[0].endsWith(':in') ? 4 : 3;
    const cls = k[0].endsWith(':in') ? 'in' : 'guest';
    if (k.length === 30) return cls === 'in' ? 20 : 9;
    if (k.length === 7) return cls === 'in' ? 7 : 5;
    if (k.length === 6) return cls === 'in' ? 5 : 2;
    throw new Error(`unexpected ${k.length}`);
  });
  const r = await readActiveCreators(client, now);
  assert.equal(client.asked.length, 34);
  assert.deepEqual(r.today, { in: 4, guest: 3, total: 7, returning: 2, fresh: 5 });
  assert.deepEqual(r.d7, { in: 7, guest: 5, total: 12 });
  assert.deepEqual(r.d30, { in: 20, guest: 9, total: 29 });
  assert.equal(r.daily.length, 14); assert.equal(r.daily[0].day, '2026-10-28'); assert.equal(r.daily[13].day, '2026-10-15');
  assert.deepEqual(client.asked[0], [creatorsKey('in', '2026-10-28')]);
  const prev = client.asked.find((k) => k.length === 6);
  assert.ok(!prev.includes(creatorsKey('in', '2026-10-28')) && prev[0] === creatorsKey('in', '2026-10-27'), 'the previous-6-days keys never include today');
});

test('readActiveCreators is fail-open (null) and never reports a negative or oversized returning count', async () => {
  assert.equal(await readActiveCreators({ pipeline() { throw new Error('down'); } }), null);
  const odd = stubClient((k) => (k.length === 1 ? 3 : k.length === 7 ? 9 : k.length === 6 ? 6 : 1));   // |A|+|B|-|U| = 0
  const r = await readActiveCreators(odd, new Date('2026-10-28T10:00:00Z'));
  assert.ok(r.today.returning >= 0 && r.today.fresh >= 0);
});

test('class: anonymous = guest, every account tier = signed in', () => {
  assert.equal(creatorClass('anonymous'), 'guest');
  for (const t of ['free', 'pro', 'admin']) assert.equal(creatorClass(t), 'in');
});

test('the module stores only a keyed hash in a HyperLogLog, with the retention from config, and never logs or writes an identifier', () => {
  const src = read('lib/creator-stats.js');
  assert.match(src, /pfadd\(key, creatorSegment\(identifier\)\)/);
  assert.match(src, /RETENTION\.creatorStatsDays/);
  assert.equal((src.match(/console\./g) || []).length, 1, 'one log call: the missing-secret warning');
  assert.match(src, /console\.warn\('[^'$`]*'\);/, 'fixed text: no interpolation, no values');
  assert.ok(!/\.(set|sadd|incr|zadd)\(/.test(src), 'only PFADD / EXPIREAT / PFCOUNT');
  assert.equal(RETENTION.creatorStatsDays, 60);
});

test('all four routes count only on success and never for the admin key', () => {
  const sc = read('pages/api/generate-script.js'), po = read('pages/api/generate-poster.js'), sb = read('pages/api/generate-storyboard.js'), up = read('pages/api/upload-character.js');
  assert.match(sc, /if \(!isAdmin\) await recordCreator\(identifier, tier\)/);
  assert.match(sb, /if \(!isAdmin\) await recordCreator\(identifier, tier\)/);
  assert.match(po, /if \(creator\) await recordCreator\(creator\.identifier, creator\.tier\)/);
  assert.match(po, /creator = \{ identifier, tier \}/);
  assert.match(up, /outcome === 'succeeded' && req\._creator/);
  assert.match(up, /if \(!isAdminRequest\(req\)\)/);
  // placement: the script's count comes after the output check, the poster's inside trackUsage (after the image check), the comic's after the hard-time check
  assert.ok(sc.indexOf('checkTextOutput') < sc.indexOf('recordCreator(identifier'));
  assert.ok(po.indexOf('const trackUsage') < po.indexOf('recordCreator(creator'));
  assert.ok(sb.indexOf('ROUTE_HARD_MS) {') < sb.indexOf('recordCreator(identifier'));
});

test('privacy text: the usage paragraph says what is counted, one-way keyed hash, cannot be read back as a list, retention from config (en + he); date is the update day', () => {
  const en = MODAL_DATA.privacy.en.sections.map((s) => s.p).join('\n'), he = MODAL_DATA.privacy.he.sections.map((s) => s.p).join('\n');
  assert.ok(en.includes('To count how many different people use the service each day, we add a one-way keyed hash of your account id (or, for visitors who are not signed in, of your network address) to a statistical counter that cannot be read back as a list of identifiers (we count in the same way how many different people reached each step of using the service, such as visiting the site, starting to type, creating a script, poster or comic, sharing, and signing up); these counters are kept for up to 60 days.'));
  assert.ok(he.includes('כדי לספור כמה אנשים שונים משתמשים בשירות בכל יום, אנחנו מוסיפים גיבוב חד-כיווני ומפתחי של מזהה החשבון שלך (או, לגולשים שאינם רשומים, של כתובת הרשת שלך) למונה סטטיסטי שאי אפשר לקרוא ממנו רשימת מזהים (באותו אופן אנחנו סופרים כמה אנשים שונים הגיעו לכל שלב בשימוש, למשל כניסה לאתר, התחלת כתיבה, יצירת תסריט, פוסטר או קומיקס, שיתוף והרשמה); המונים נשמרים עד 60 ימים.'));
  assert.match(MODAL_DATA.privacy.en.summary, /29 October 2026/);
  assert.match(MODAL_DATA.privacy.he.summary, /29 באוקטובר 2026/);
});

test('the admin page has the "Active creators" card with the double-count note, fed by its own route', () => {
  const page = read('pages/admin.js');
  assert.match(page, /Active creators/);
  assert.match(page, /counts twice in the totals/);
  assert.match(page, /\/api\/admin\/active-creators/);
  assert.ok(!read('pages/api/admin/stats.js').includes('creator'), 'the auto-refreshed stats route knows nothing about creators');
});

test('admin page: creators are fetched on load and on the manual Refresh button only (never inside refreshAll / the interval); the interval pauses while the tab is hidden', () => {
  const page = read('pages/admin.js');
  const refreshAll = page.slice(page.indexOf('const refreshAll = useCallback'), page.indexOf('// refreshAll\'s identity'));
  assert.ok(!refreshAll.includes('fetchCreators'), 'refreshAll (called by the interval) must not fetch the creators');
  assert.match(page, /onClick=\{\(\) => \{ refreshAll\(\); fetchCreators\(\);/);
  assert.match(page, /refreshAllRef\.current\(\);\s*\n\s*fetchCreators\(\);/);
  assert.match(page, /document\.visibilityState !== 'hidden'/);
  assert.match(page, /setInterval\(\(\) => \{ if \(visible\(\)\) run\(\); \}, AUTO_REFRESH_MS\)/);
  assert.match(page, /addEventListener\('visibilitychange'/); assert.match(page, /removeEventListener\('visibilitychange'/);
});

test('admin page: auto-refresh every 5 minutes; the script-stage list is load / Refresh only, like the creators; stats no longer carries it', () => {
  const page = read('pages/admin.js');
  assert.match(page, /const AUTO_REFRESH_MS = 5 \* 60 \* 1000;/);
  assert.ok(!/30_000/.test(page), 'no 30 s interval left');
  assert.match(page, /auto-refresh 5 min/);
  const refreshAll = page.slice(page.indexOf('const refreshAll = useCallback'), page.indexOf('// refreshAll\'s identity'));
  assert.ok(!refreshAll.includes('fetchScriptStages') && !refreshAll.includes('fetchCreators') && !refreshAll.includes('fetchFunnel'));
  assert.match(page, /onClick=\{\(\) => \{ refreshAll\(\); fetchCreators\(\); fetchFunnel\(\); fetchScriptStages\(\); \}\}/);
  assert.match(page, /fetchCreators\(\);\s*\n\s*fetchFunnel\(\);\s*\n\s*fetchScriptStages\(\);/);
  assert.match(page, /\/api\/admin\/script-stages/);
  const stats = read('pages/api/admin/stats.js');
  assert.ok(!stats.includes('scriptStages') && !stats.includes('readScriptStages'));
  assert.match(read('pages/api/admin/script-stages.js'), /requireAdmin/);
});
