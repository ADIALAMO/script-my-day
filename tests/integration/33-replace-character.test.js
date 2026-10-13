/** Re-upload: the previous character objects are deleted ONLY after the new sheet is stored and the new pointer written; own scope only; a failed cleanup never fails the upload. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '33-replace-character' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const upload = await ctx.route('upload-character');
const { ownerSegment } = await import('../../lib/upload-image.js');

const PUB = process.env.R2_BUCKET_NAME; const BASE = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
let ipN = 0; const ip = () => `198.51.100.${60 + (++ipN % 150)}`;
const put = (key) => providers.s3objects.set(`${PUB}/${key}`, { bytes: 5, metadata: {} });
const has = (key) => providers.s3objects.has(`${PUB}/${key}`);
const up = (u) => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: ip() });
const ptr = (u) => JSON.parse(fake.get(`character:${u.identifier}`));
const mine = (u, n, kind) => `characters/${ownerSegment(u.identifier)}/${String(n).repeat(8)}-${n}${n}${n}${n}-${n}${n}${n}${n}-${n}${n}${n}${n}-${String(n).repeat(12)}-${kind}.jpg`;
const seed = (u, rawKey, sheetKey) => fake.set(`character:${u.identifier}`, JSON.stringify({ url: `${BASE}/${sheetKey}`, styledUrl: `${BASE}/${sheetKey}`, status: 'ready', ...(rawKey ? { url: `${BASE}/${rawKey}` } : {}) }));

scenario('R1', 'successful replace: the OLD raw + sheet named by the previous pointer are deleted, the NEW sheet is stored, pointed to and NOT deleted',
  '200; old pair gone; new sheet present; pointer = new sheet; deletes = old pair + new raw only', async () => {
    const u = await makeUser('r1', 'paid');
    const oldRaw = mine(u, 1, 'raw'); const oldSheet = mine(u, 1, 'sheet'); put(oldRaw); put(oldSheet); seed(u, oldRaw, oldSheet);
    const r = await up(u);
    assert.equal(r.status, 200);
    const newSheet = providers.s3puts.map((p) => p.key).find((k) => /-sheet\./.test(k));
    assert.notEqual(newSheet, oldSheet);
    assert.equal(has(oldRaw), false); assert.equal(has(oldSheet), false); assert.equal(has(newSheet), true);
    assert.equal(ptr(u).styledUrl, `${BASE}/${newSheet}`);
    const newRaw = providers.s3puts.map((p) => p.key).find((k) => /-raw\./.test(k));
    assert.deepEqual(providers.s3deletes.map((d) => d.key).sort(), [newRaw, oldRaw, oldSheet].sort());
    return { actual: 'old pair deleted; new sheet kept' };
  });

scenario('R2', 'the new upload FAILS (sheet provider down): the old character, its objects and its pointer are untouched',
  '503; old objects present; pointer unchanged; no delete of an old key', async () => {
    const u = await makeUser('r2', 'paid'); providers.mode['gemini-image'] = 500; providers.mode.grok = 500;
    const oldRaw = mine(u, 2, 'raw'); const oldSheet = mine(u, 2, 'sheet'); put(oldRaw); put(oldSheet); seed(u, oldRaw, oldSheet);
    const before = fake.get(`character:${u.identifier}`);
    const r = await up(u);
    assert.equal(r.status, 503);
    assert.equal(has(oldRaw), true); assert.equal(has(oldSheet), true); assert.equal(fake.get(`character:${u.identifier}`), before);
    assert.ok(providers.s3deletes.every((d) => d.key !== oldRaw && d.key !== oldSheet));
    return { actual: 'old character kept' };
  });

scenario('R3', 'the new sheet cannot be STORED: the old character is kept as well',
  '503; old objects present; pointer unchanged', async () => {
    const u = await makeUser('r3', 'paid'); providers.mode.s3putSheet = 1;
    const oldSheet = mine(u, 3, 'sheet'); put(oldSheet); seed(u, null, oldSheet);
    const before = fake.get(`character:${u.identifier}`);
    const r = await up(u);
    assert.equal(r.status, 503); assert.equal(has(oldSheet), true); assert.equal(fake.get(`character:${u.identifier}`), before);
    return { actual: 'old sheet kept' };
  });

scenario('R4', 'deleting the OLD objects fails: the upload still returns 200 with the new sheet, the old objects stay, the log names no key',
  '200; new sheet pointer; old sheet still present; only a class/http line logged', async () => {
    const u = await makeUser('r4', 'paid');
    const oldRaw = mine(u, 4, 'raw'); const oldSheet = mine(u, 4, 'sheet'); put(oldRaw); put(oldSheet); seed(u, oldRaw, oldSheet);
    providers.mode.s3deleteMatch = '44444444';
    const warns = []; const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    let r; try { r = await up(u); } finally { console.warn = orig; }
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, true);
    assert.equal(has(oldSheet), true); assert.equal(has(oldRaw), true);
    const newSheet = providers.s3puts.map((p) => p.key).find((k) => /-sheet\./.test(k));
    assert.equal(ptr(u).styledUrl, `${BASE}/${newSheet}`); assert.equal(has(newSheet), true);
    const line = warns.find((w) => w.includes('previous character object could not be deleted'));
    assert.ok(line && /class=\w+/.test(line) && !line.includes('44444444') && !line.includes(ownerSegment(u.identifier)));
    return { actual: '200 despite the failed cleanup' };
  });

scenario('R5', 'another user\'s keys are never touched: a pointer naming B\'s current-format and legacy objects (and a traversal / foreign URL) deletes none of them',
  '200; B\'s objects survive; no delete of a foreign key', async () => {
    const a = await makeUser('r5a', 'paid'); const b = await makeUser('r5b', 'paid');
    const bSheet = mine(b, 5, 'sheet'); const bLegacy = `characters/${b.identifier}-sheet-1700000001.jpg`; const aLegacyLook = `characters/${a.identifier}x-sheet-1700000001.jpg`;
    for (const k of [bSheet, bLegacy, aLegacyLook, 'panels/secret.jpg']) put(k);
    fake.set(`character:${a.identifier}`, JSON.stringify({ url: `${BASE}/${bSheet}`, styledUrl: `${BASE}/${bLegacy}`, status: 'ready' }));
    const r = await up(a);
    assert.equal(r.status, 200);
    for (const k of [bSheet, bLegacy, aLegacyLook, 'panels/secret.jpg']) assert.equal(has(k), true, `${k} untouched`);
    // foreign / traversal pointer values
    const c = await makeUser('r5c', 'paid');
    fake.set(`character:${c.identifier}`, JSON.stringify({ url: `${BASE}/characters/../panels/secret.jpg`, styledUrl: 'https://evil.example/characters/x-sheet-1.jpg' }));
    assert.equal((await up(c)).status, 200); assert.equal(has('panels/secret.jpg'), true);
    const sent = providers.s3deletes.map((d) => d.key);
    assert.ok(!sent.includes(bSheet) && !sent.includes(bLegacy) && !sent.includes(aLegacyLook) && !sent.includes('panels/secret.jpg'));
    return { actual: 'foreign keys never sent to DeleteObject' };
  });

scenario('R6', 'a LEGACY previous character (exact id) is replaced: its raw + sheet are deleted',
  '200; legacy pair gone', async () => {
    const u = await makeUser('r6', 'paid');
    const raw = `characters/${u.identifier}-raw-1700000001.jpg`; const sheet = `characters/${u.identifier}-sheet-1700000001.jpg`; put(raw); put(sheet);
    fake.set(`character:${u.identifier}`, JSON.stringify({ url: `${BASE}/${raw}`, styledUrl: `${BASE}/${sheet}`, status: 'ready' }));
    assert.equal((await up(u)).status, 200);
    assert.equal(has(raw), false); assert.equal(has(sheet), false);
    return { actual: 'legacy pair deleted' };
  });

scenario('R7', 'first upload (no previous pointer) works and deletes only its own raw selfie',
  '200; one delete = the new raw', async () => {
    const u = await makeUser('r7', 'paid');
    const r = await up(u);
    assert.equal(r.status, 200);
    const newRaw = providers.s3puts.map((p) => p.key).find((k) => /-raw\./.test(k));
    assert.deepEqual(providers.s3deletes.map((d) => d.key), [newRaw]);
    return { actual: 'first upload unchanged' };
  });
