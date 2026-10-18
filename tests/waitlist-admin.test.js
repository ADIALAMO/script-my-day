// GET /api/admin/waitlist — list + CSV: mixed v1 / legacy values, sorting, paging, search, headers, no e-mail in logs, no key in the answer.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
mem.scan = async (cursor, { match }) => {            // single page, like the integration fake
  const re = new RegExp(`^${match.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
  return ['0', [...mem._store.keys()].filter((k) => re.test(k))];
};
global._redisClient = mem;
process.env.ADMIN_SECRET_KEY = 'unit-test-admin-key';
process.env.ADMIN_EMAILS = 'admin@test.example';

const W = await import('../lib/waitlist.js');
const { default: handler } = await import('../pages/api/admin/waitlist.js');

const T = Date.UTC(2026, 9, 1);
const v1 = (email, o = {}) => JSON.stringify({ ...W.buildRecord({ email, lang: 'he', now: new Date(T) }), ...o });
function seed() {
  mem._store.clear();
  mem._store.set('waitlist:old@example.com', String(T - 5 * 864e5));                                   // legacy, 5 days before
  mem._store.set('waitlist:new@example.com', v1('new@example.com', { createdAt: new Date(T + 864e5).toISOString(), userId: 'u:77' }));
  mem._store.set('waitlist:mid@example.com', v1('mid@example.com', { locale: 'en' }));
  mem._store.set('waitlist:nodate@example.com', '123');                                                // legacy with an implausible timestamp -> createdAt null
  mem._store.set('waitlist:=evil@example.com', v1('=evil@example.com'));                               // formula-looking local part
  mem._store.set('waitlist:broken@example.com', 'hello');                                              // unreadable
  mem._store.set('waitlist:not an email', '1');                                                        // not a valid key
  mem._store.set('user:email:x@y.com', 'u:1');                                                         // unrelated key
}
beforeEach(seed);

function call({ query = {}, headers = { 'x-admin-key': 'unit-test-admin-key' }, method = 'GET' } = {}) {
  const hdr = {};
  const req = { method, query, headers, cookies: {}, socket: {} };
  const res = { code: null, body: null, hdr, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, send(b) { this.body = b; return this; }, setHeader(k, v) { hdr[k.toLowerCase()] = v; }, end() { return this; } };
  return handler(req, res).then(() => res);
}
const captureLogs = async (fn) => { const lines = []; const o = { w: console.warn, e: console.error, l: console.log }; console.warn = console.error = console.log = (...a) => lines.push(a.map(String).join(' ')); try { return { out: await fn(), lines }; } finally { Object.assign(console, { warn: o.w, error: o.e, log: o.l }); } };

test('auth: no session and no key -> 401; wrong key -> 401; the key in the URL does NOT authenticate; POST -> 405; none return data', async () => {
  for (const o of [{ headers: {} }, { headers: { 'x-admin-key': 'wrong' } }, { headers: {}, query: { 'x-admin-key': 'unit-test-admin-key', key: 'unit-test-admin-key', adminKey: 'unit-test-admin-key' } }]) {
    const r = await call(o); assert.equal(r.code, 401, JSON.stringify(o)); assert.deepEqual(Object.keys(r.body), ['error']);
    assert.equal(r.hdr['cache-control'].includes('no-store'), true);
  }
  assert.equal((await call({ method: 'POST' })).code, 405);
});

test('list: mixed v1 + legacy, newest first, undated last, unreadable counted, keys never returned, userId never in the JSON list', async () => {
  const r = await call();
  assert.equal(r.code, 200);
  // newest first; equal dates (=evil and mid, both at T) fall back to e-mail ascending; the undated legacy row is last
  assert.deepEqual(r.body.entries.map((e) => e.email), ['new@example.com', '=evil@example.com', 'mid@example.com', 'old@example.com', 'nodate@example.com']);
  assert.equal(r.body.total, 5); assert.equal(r.body.unreadable, 2); assert.equal(r.body.legacy, 2); assert.equal(r.body.signedIn, 1); assert.equal(r.body.truncated, false);
  const text = JSON.stringify(r.body);
  assert.ok(!text.includes('waitlist:') && !text.includes('u:77') && !text.includes('userId'), 'no key, no userId in the list');
  const n = r.body.entries.find((e) => e.email === 'new@example.com');
  assert.deepEqual(n, { email: 'new@example.com', createdAt: new Date(T + 864e5).toISOString(), locale: 'he', source: 'pro-modal', signedIn: true });
  const o = r.body.entries.find((e) => e.email === 'old@example.com');
  assert.deepEqual(o, { email: 'old@example.com', createdAt: new Date(T - 5 * 864e5).toISOString(), locale: null, source: 'legacy-waitlist', signedIn: false });
});

test('paging + search: limit/offset/hasMore, clamps, case-insensitive substring, filtered vs total', async () => {
  let r = await call({ query: { limit: '2', offset: '0' } });
  assert.equal(r.body.entries.length, 2); assert.equal(r.body.hasMore, true); assert.equal(r.body.filtered, 5);
  r = await call({ query: { limit: '2', offset: '4' } }); assert.equal(r.body.entries.length, 1); assert.equal(r.body.hasMore, false);
  r = await call({ query: { limit: '9999', offset: '-5' } }); assert.equal(r.body.limit, 200); assert.equal(r.body.offset, 0);
  r = await call({ query: { q: 'NEW@' } }); assert.deepEqual(r.body.entries.map((e) => e.email), ['new@example.com']); assert.equal(r.body.filtered, 1); assert.equal(r.body.total, 5);
  r = await call({ query: { q: 'nope-nothing' } }); assert.equal(r.body.entries.length, 0); assert.equal(r.body.hasMore, false);
});

test('headers on JSON, CSV and error answers: private, no-store, noindex, nosniff', async () => {
  const bad = await call({ headers: {} });
  for (const r of [await call(), await call({ query: { format: 'csv' } }), bad]) {
    assert.match(r.hdr['cache-control'], /no-store/); assert.equal(r.hdr['pragma'], 'no-cache'); assert.match(r.hdr['x-robots-tag'], /noindex/); assert.equal(r.hdr['x-content-type-options'], 'nosniff');
  }
});

test('CSV: whole filtered list (ignores paging), BOM, CRLF, columns, userId present, formula-looking e-mail neutralised, dated attachment name, text/csv', async () => {
  const r = await call({ query: { format: 'csv', limit: '1', offset: '3' } });
  assert.equal(r.code, 200); assert.match(r.hdr['content-type'], /^text\/csv; charset=utf-8$/);
  assert.match(r.hdr['content-disposition'], /^attachment; filename="waitlist-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(r.body.charCodeAt(0), 0xFEFF);
  const lines = r.body.slice(1).split('\r\n'); assert.equal(lines.at(-1), '');
  assert.equal(lines[0], 'email,createdAt,locale,source,userId,consentVersion');
  assert.equal(lines.length - 2, 5, 'all 5 readable rows regardless of limit/offset');
  assert.ok(lines.some((l) => l.startsWith('new@example.com,') && l.includes(',u:77,1')));
  assert.ok(lines.some((l) => l.startsWith("'=evil@example.com,")), 'formula-looking address prefixed');
  assert.ok(lines.some((l) => l.startsWith('nodate@example.com,,,legacy-waitlist,,')));
  const filtered = await call({ query: { format: 'csv', q: 'example.com' } }); assert.equal(filtered.body.slice(1).split('\r\n').length - 2, 5);
  const one = await call({ query: { format: 'csv', q: 'MID@' } }); assert.equal(one.body.slice(1).split('\r\n').length - 2, 1);
});

test('no e-mail address in any console output — success paths and the Redis-failure path', async () => {
  const { lines } = await captureLogs(async () => { await call(); await call({ query: { format: 'csv' } }); });
  assert.deepEqual(lines, []);
  const origScan = mem.scan; mem.scan = async () => { throw Object.assign(new Error('boom new@example.com'), { name: 'UpstashError' }); };
  try {
    const { out, lines: l2 } = await captureLogs(() => call());
    assert.equal(out.code, 500); assert.deepEqual(out.body, { error: 'Could not load the waitlist.' });
    assert.ok(!l2.join('\n').includes('example.com')); assert.match(l2.join('\n'), /class=UpstashError/);
    assert.match(out.hdr['cache-control'], /no-store/);
  } finally { mem.scan = origScan; }
});

test('rowFromValue / compareRows: v1 object or string, legacy number, bad createdAt -> null, unreadable -> null', () => {
  assert.equal(W.rowFromValue('a@b.com', 'junk'), null); assert.equal(W.rowFromValue('a@b.com', null), null);
  assert.equal(W.rowFromValue('a@b.com', JSON.stringify({ v: 1, email: 'x', createdAt: 'not a date', locale: 'fr', userId: '' })).createdAt, null);
  assert.equal(W.rowFromValue('a@b.com', { v: 1, email: 'x', createdAt: new Date(T).toISOString(), locale: 'fr', source: 5 }).locale, null);
  const rows = [{ email: 'b', createdAt: null }, { email: 'a', createdAt: null }, { email: 'z', createdAt: '2026-01-02T00:00:00.000Z' }, { email: 'y', createdAt: '2026-01-02T00:00:00.000Z' }, { email: 'n', createdAt: '2026-02-01T00:00:00.000Z' }];
  assert.deepEqual(rows.sort(W.compareRows).map((r) => r.email), ['n', 'y', 'z', 'a', 'b']);
});

test('static: the admin card downloads through a plain same-origin anchor (session cookie), the key never goes in a URL, and nothing polls the list', async () => {
  const { readFileSync } = await import('node:fs');
  const page = readFileSync(new URL('../pages/admin.js', import.meta.url), 'utf8');
  assert.match(page, /href=\{waitlistCsvHref\}/); assert.match(page, /Personal data\. Delete the file after use\./);
  assert.doesNotMatch(page, /x-admin-key|adminKey|ADMIN_SECRET/i);
  assert.match(page, /\/api\/admin\/waitlist\?format=csv/);
  const gssp = page.slice(page.indexOf('export async function getServerSideProps'), page.indexOf('function CircuitBadge'));
  assert.doesNotMatch(gssp, /waitlist/i, 'no waitlist data in page props');
  const refresh = page.slice(page.indexOf('const refreshAll = useCallback'), page.indexOf('const refreshAllRef'));
  assert.doesNotMatch(refresh, /Waitlist/, 'not part of the 30 s auto-refresh');
});
