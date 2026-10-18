// Pro waitlist: normalisation, record shape, duplicates (first record wins, identical answer), honeypot, rate limit and the Redis-failure path (retryable 503, no log of the address).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem;
process.env.TELEGRAM_BOT_TOKEN = 'unit-test-token';       // fake: the fetch below is stubbed, nothing leaves the process
process.env.TELEGRAM_CHAT_ID = '1';

const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => { sent.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, text: async () => '' }; };

const W = await import('../lib/waitlist.js');
const { default: handler } = await import('../pages/api/waitlist.js');

beforeEach(() => { mem._store.clear(); sent.length = 0; });

function call(body, { method = 'POST', headers = {} } = {}) {
  const req = { method, body, headers, socket: {}, query: {}, cookies: {} };
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  return handler(req, res).then(() => res);
}
const stored = (email) => { const raw = mem._store.get(`waitlist:${email}`); return raw === undefined ? null : JSON.parse(raw); };
const captureLogs = async (fn) => {
  const lines = []; const o = { w: console.warn, e: console.error, l: console.log };
  console.warn = console.error = console.log = (...a) => lines.push(a.map(String).join(' '));
  try { return { out: await fn(), lines }; } finally { console.warn = o.w; console.error = o.e; console.log = o.l; }
};

// ── normalisation ───────────────────────────────────────────────────────────
test('normalizeEmail: trims and lowercases; rejects non-strings, empty, >254 chars, inner whitespace, no @ or dot', () => {
  assert.equal(W.normalizeEmail('  Dana.Cohen@Example.COM \n'), 'dana.cohen@example.com');
  for (const bad of [undefined, null, 5, {}, [], '', '   ', 'a@b', 'a b@c.com', 'a@b .com', '@b.com', 'ab.com', `${'a'.repeat(250)}@b.co`]) assert.equal(W.normalizeEmail(bad), null, JSON.stringify(bad));
  assert.equal(W.normalizeEmail(`${'a'.repeat(240)}@b.com`)?.length, 246);
});

test('the route normalises before storing, and answers 400 INVALID_EMAIL without touching Redis for a bad address', async () => {
  let r = await call({ email: '  Dana@Example.COM ', lang: 'en' });
  assert.equal(r.code, 200); assert.deepEqual(r.body, { success: true });
  assert.ok(stored('dana@example.com'), 'stored under the normalised key'); assert.equal(mem._store.size >= 1, true);
  mem._store.clear();
  for (const email of ['nope', '', 7, undefined, 'a@b']) { r = await call({ email, lang: 'en' }); assert.equal(r.code, 400); assert.deepEqual(r.body, { code: 'INVALID_EMAIL' }); }
  assert.equal([...mem._store.keys()].some((k) => k.startsWith('waitlist:')), false);
});

test('405 for anything but POST', async () => { assert.equal((await call({}, { method: 'GET' })).code, 405); });

// ── record shape ────────────────────────────────────────────────────────────
test('record: v1 shape with the full email, ISO createdAt, locale whitelist, constant source, userId null for a guest, consentVersion', async () => {
  await call({ email: 'a@b.com', lang: 'he' });
  const r = stored('a@b.com');
  assert.deepEqual(Object.keys(r).sort(), ['consentVersion', 'createdAt', 'email', 'locale', 'source', 'userId', 'v']);
  assert.equal(r.v, 1); assert.equal(r.email, 'a@b.com'); assert.equal(r.locale, 'he'); assert.equal(r.source, 'pro-modal');
  assert.equal(r.userId, null); assert.equal(r.consentVersion, W.WAITLIST_CONSENT_VERSION);
  assert.equal(new Date(r.createdAt).toISOString(), r.createdAt);
  mem._store.clear();
  await call({ email: 'a@b.com', lang: 'fr', source: 'evil', userId: 'u:attacker', consentVersion: 99 });
  const g = stored('a@b.com');
  assert.equal(g.locale, null, 'unknown locale -> null'); assert.equal(g.source, 'pro-modal', 'source is server-side'); assert.equal(g.userId, null, 'userId is never taken from the client'); assert.equal(g.consentVersion, 1);
});

// ── duplicates ──────────────────────────────────────────────────────────────
test('duplicate: the FIRST record is kept byte-for-byte, the answer is identical to a new signup, and no second Telegram alert', async () => {
  const first = await call({ email: 'dup@x.com', lang: 'he' });
  const before = mem._store.get('waitlist:dup@x.com');
  assert.equal(sent.length, 1);
  const second = await call({ email: ' DUP@x.com ', lang: 'en' });
  assert.equal(mem._store.get('waitlist:dup@x.com'), before, 'not overwritten');
  assert.equal(second.code, first.code); assert.deepEqual(second.body, first.body);
  assert.ok(!('alreadyOnList' in second.body));
  assert.equal(sent.length, 1, 'only the first signup alerts');
});

test('Telegram carries the MASKED address only', async () => {
  await call({ email: 'adialamo@gmail.com', lang: 'en' });
  const text = sent[0].body.text.replace(/\\/g, '');   // Markdown escapes (a\*\*\*) removed
  assert.match(text, /a\*\*\*@gmail\.com/); assert.ok(!text.includes('adialamo'));
});

// ── honeypot ────────────────────────────────────────────────────────────────
test('honeypot: a filled hidden field answers 200 success, stores nothing, alerts nobody and does not use the rate limit', async () => {
  const r = await call({ email: 'bot@x.com', lang: 'en', [W.HONEYPOT_FIELD]: 'http://spam.example' });
  assert.equal(r.code, 200); assert.deepEqual(r.body, { success: true });
  assert.equal(stored('bot@x.com'), null); assert.equal(sent.length, 0);
  assert.equal([...mem._store.keys()].some((k) => k.startsWith('ratelimit:')), false);
  // even junk in the email field: still a silent success
  assert.equal((await call({ email: 'junk', [W.HONEYPOT_FIELD]: 'x' })).code, 200);
  // an EMPTY / whitespace honeypot is a normal signup
  assert.equal((await call({ email: 'ok@x.com', [W.HONEYPOT_FIELD]: '   ' })).code, 200); assert.ok(stored('ok@x.com'));
});

test('the honeypot name is not a standard autofill token or a word browsers fill, and the modal renders it off-screen without display:none', () => {
  const TOKENS = ['name', 'honorific-prefix', 'given-name', 'additional-name', 'family-name', 'nickname', 'email', 'username', 'new-password', 'current-password', 'one-time-code', 'organization-title', 'organization', 'street-address', 'address-line1', 'address-line2', 'address-line3', 'address-level1', 'address-level2', 'address-level3', 'address-level4', 'country', 'country-name', 'postal-code', 'cc-name', 'cc-number', 'cc-exp', 'cc-csc', 'cc-type', 'transaction-amount', 'language', 'bday', 'sex', 'tel', 'url', 'photo', 'impp'];
  const COMMON = ['website', 'site', 'homepage', 'phone', 'mobile', 'company', 'address', 'city', 'state', 'zip', 'fax', 'title', 'subject', 'message', 'comment', 'age', 'birthday', 'surname', 'firstname', 'lastname', 'fullname', 'mail', 'e-mail', 'login', 'user', 'pass', 'password', 'search', 'q', 'hp', 'honeypot', 'url_hp', 'phone_number'];
  const n = W.HONEYPOT_FIELD;
  assert.ok(!TOKENS.includes(n) && !COMMON.includes(n), n);
  assert.ok(!/^(?:section-|shipping|billing|home|work|mobile|fax|pager)/.test(n));
  assert.match(n, /^[a-z]{2}_[a-z]+\d[a-z]$/, 'unusual, non-semantic name');
  const modal = readFileSync(new URL('../components/WaitlistModal.jsx', import.meta.url), 'utf8');
  assert.match(modal, /name=\{HONEYPOT_FIELD\}/); assert.match(modal, /tabIndex=\{-1\}/); assert.match(modal, /autoComplete="off"/); assert.match(modal, /aria-hidden="true"/);
  assert.match(modal, /left: '-10000px'/); assert.doesNotMatch(modal, /display:\s*['"]none['"]/);
});

// ── rate limit ──────────────────────────────────────────────────────────────
test('rate limit: the 6th signup from one IP in the window is 429 RATE_LIMITED; a limiter outage still lets the signup through', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await call({ email: `u${i}@x.com` })).code, 200);
  const r = await call({ email: 'u5@x.com' });
  assert.equal(r.code, 429); assert.deepEqual(r.body, { code: 'RATE_LIMITED' }); assert.equal(stored('u5@x.com'), null);
  mem._store.clear();
  const origGet = mem.get; mem.get = async (k) => { if (String(k).startsWith('ratelimit:')) throw Object.assign(new Error('boom dana@example.com'), { name: 'UpstashError' }); return origGet.call(mem, k); };
  try { const { out, lines } = await captureLogs(() => call({ email: 'dana@example.com' })); assert.equal(out.code, 200); assert.ok(stored('dana@example.com')); assert.ok(!lines.join('\n').includes('dana@example.com'), 'no address in logs'); }
  finally { mem.get = origGet; }
});

// ── Redis failure ───────────────────────────────────────────────────────────
test('Redis write failure: 503 TEMPORARILY_UNAVAILABLE (retryable), NOT a success, no Telegram, and the address is in no log line', async () => {
  const origSet = mem.set; mem.set = async () => { throw Object.assign(new Error('connect ECONNREFUSED for secret.person@example.com'), { name: 'UpstashError' }); };
  try {
    const { out: r, lines } = await captureLogs(() => call({ email: 'secret.person@example.com', lang: 'en' }));
    assert.equal(r.code, 503); assert.deepEqual(r.body, { code: 'TEMPORARILY_UNAVAILABLE', retryable: true });
    assert.notEqual(r.body.success, true); assert.equal(sent.length, 0);
    const log = lines.join('\n');
    assert.ok(!log.includes('secret.person') && !log.includes('example.com'), `log leaked the address: ${log}`);
    assert.match(log, /Waitlist persist failed \(class=UpstashError\)/);
  } finally { mem.set = origSet; }
  assert.equal((await call({ email: 'secret.person@example.com' })).code, 200, 'a retry after recovery succeeds');
});

test('Redis write that hangs is cut off by the timeout and answers 503', async () => {
  const origSet = mem.set; mem.set = () => new Promise(() => {});
  const realSetTimeout = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, ms >= 4000 ? 5 : ms, ...a);
  try { const r = await call({ email: 'slow@x.com' }); assert.equal(r.code, 503); assert.equal(r.body.retryable, true); }
  finally { mem.set = origSet; globalThis.setTimeout = realSetTimeout; }
});

// ── parse helper ────────────────────────────────────────────────────────────
test('parseWaitlistValue: legacy number / numeric string, v1 JSON string or object, anything else unreadable', () => {
  assert.deepEqual(W.parseWaitlistValue(1760000000000), { kind: 'legacy', value: 1760000000000 });
  assert.deepEqual(W.parseWaitlistValue('1760000000000'), { kind: 'legacy', value: 1760000000000 });
  const rec = W.buildRecord({ email: 'a@b.com', lang: 'en' });
  assert.equal(W.parseWaitlistValue(JSON.stringify(rec)).kind, 'v1'); assert.equal(W.parseWaitlistValue(rec).kind, 'v1');
  for (const bad of [null, undefined, '', 'hello', '{"x":1}', true]) assert.equal(W.parseWaitlistValue(bad).kind, 'unreadable');
});

test.after?.(() => { globalThis.fetch = realFetch; });
