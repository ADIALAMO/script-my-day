import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODAL_DATA } from '../constants/modalData.js';
import { RETENTION } from '../config/limits.js';
import { FUNNEL_STEPS, CLIENT_STEPS, funnelKey, readFunnel } from '../lib/funnel-stats.js';
import { isExcludedReferrer } from '../utils/funnel-client.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function stubClient(table) {
  const asked = [];
  return { asked, pipeline() { const q = []; const p = { pfcount: (...k) => { q.push(k); asked.push(k); return p; }, exec: async () => q.map((k) => table(k)) }; return p; } };
}

test('steps: the ten funnel steps in order; only landing / typed / share come from the browser', () => {
  assert.deepEqual(FUNNEL_STEPS, ['landing', 'typed', 'script_req', 'script_ok', 'poster_req', 'poster_ok', 'comic_start', 'star_start', 'share', 'signup']);
  assert.deepEqual(CLIENT_STEPS, ['landing', 'typed', 'share']);
  assert.equal(funnelKey('landing', 'web', 'guest', '2026-10-28'), 'stats:funnel:2026-10-28:landing:web:guest');
});

test('readFunnel: 50 PFCOUNTs in one pipeline (union + 4 segments per step), 7 days each, shaped per step', async () => {
  const now = new Date('2026-10-28T10:00:00Z');
  const client = stubClient((k) => (k.length === 28 ? 100 : k[0].endsWith(':web:in') ? 1 : k[0].endsWith(':web:guest') ? 2 : k[0].endsWith(':app:in') ? 3 : 4));
  const r = await readFunnel(7, client, now);
  assert.equal(client.asked.length, 50);
  assert.equal(r.length, 10);
  assert.deepEqual(r[0], { step: 'landing', total: 100, web: { in: 1, guest: 2 }, app: { in: 3, guest: 4 } });
  assert.equal(client.asked[0].length, 28);
  assert.equal(client.asked[1].length, 7); assert.equal(client.asked[1][0], 'stats:funnel:2026-10-28:landing:web:in'); assert.equal(client.asked[1][6], 'stats:funnel:2026-10-22:landing:web:in');
});

test('readFunnel fails open (null)', async () => {
  assert.equal(await readFunnel(7, { pipeline() { throw new Error('down'); } }), null);
});

test('the click-farm referrer is excluded from landing (host and subdomains), other referrers are not', () => {
  assert.equal(isExcludedReferrer('https://clickbaitpays.me/x?y=1'), true);
  assert.equal(isExcludedReferrer('https://www.clickbaitpays.me/'), true);
  for (const r of ['https://l.facebook.com/l.php?u=1', 'https://notclickbaitpays.me.evil.com/', '', undefined, 'not a url']) assert.equal(isExcludedReferrer(r), false, String(r));
});

test('the browser helper stores nothing on the device (in-memory flags only) and sends no identifier', () => {
  const src = read('utils/funnel-client.js').replace(/\/\*[\s\S]*?\*\//g, '');   // code only, not the doc comment
  assert.ok(!/localStorage|sessionStorage|document\.cookie|indexedDB/.test(src));
  assert.ok(/body: JSON\.stringify\(\{ event, native: isCapacitorNative\(\) \}\)/.test(src));
});

test('the route and counters carry no raw identifier and the funnel never counts the admin key', () => {
  const route = read('pages/api/funnel-event.js'); const lib = read('lib/funnel-stats.js');
  assert.ok(/isAdminRequest\(req\)/.test(route));
  assert.ok(/creatorSegment\(identifier\)/.test(lib));
  assert.ok(!/console\.(log|warn|error)\([^)]*(identifier|who)/.test(route + lib));
  assert.ok(/'funnel-event':\s*\{ requests: 20, window: '10 m' \}/.test(read('lib/rate-limit.js')));
});

test('Privacy copy says the counters also record which steps were reached, with the same retention, dated 29 October 2026', () => {
  const limits = read('constants/limits-copy.js');
  assert.ok(limits.includes('how many different people reached each step') && limits.includes('כמה אנשים שונים הגיעו לכל שלב'));
  assert.ok(limits.includes('these counters are kept for up to ${L.creatorStatsDays} days'));
  assert.equal(RETENTION.creatorStatsDays, 60);
  assert.ok(MODAL_DATA.privacy.en.summary.includes('29 October 2026') && MODAL_DATA.privacy.he.summary.includes('29 באוקטובר 2026'));
});

test('admin: the Funnel card is fetched on load / Refresh only, never by the auto-refresh', () => {
  const src = read('pages/admin.js');
  assert.ok(src.includes("fetch('/api/admin/funnel'"));
  const run = src.slice(src.indexOf('const AUTO_REFRESH_MS'));
  const interval = run.slice(run.indexOf('setInterval('), run.indexOf('setInterval(') + 200);
  assert.ok(!/fetchFunnel/.test(interval));
  assert.ok(src.includes('fetchCreators(); fetchFunnel(); fetchScriptStages();'));
});
