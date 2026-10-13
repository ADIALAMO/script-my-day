/** "Remove my character" for LEGACY keys characters/<id>-(raw|sheet)-<stamp>.jpg: exact id match only, honest partial / nothing-found results. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '32-remove-character-legacy' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const characterRoute = await ctx.route('character');
const { ownerSegment } = await import('../../lib/upload-image.js');

const PUB = process.env.R2_BUCKET_NAME; const BASE = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
let ipN = 0; const ip = () => `198.51.100.${30 + (++ipN % 200)}`;
const put = (key) => providers.s3objects.set(`${PUB}/${key}`, { bytes: 5, metadata: {} });
const has = (key) => providers.s3objects.has(`${PUB}/${key}`);
const del = (u) => invoke(characterRoute, { method: 'DELETE', cookies: u.cookies, ip: ip() });
const legacy = (id, kind, stamp) => `characters/${id}-${kind}-${stamp}.jpg`;
const seedPointer = (u, rawKey, sheetKey) => fake.set(`character:${u.identifier}`, JSON.stringify({ url: `${BASE}/${rawKey}`, styledUrl: `${BASE}/${sheetKey}`, status: 'ready' }));

scenario('V1', 'legacy keys: ONLY objects whose embedded id EQUALS the caller\'s identifier are deleted — no prefix match ("<id>x", "<id>-more"), no suffix confusion ("x<id>"), nobody else\'s keys, no other prefixes',
  'A\'s own legacy raw + sheet (and an older pair) gone; every look-alike and B\'s objects survive', async () => {
    const a = await makeUser('v1a', 'free'); const b = await makeUser('v1b', 'free');
    const A = a.identifier; const B = b.identifier;
    const mine = [legacy(A, 'raw', 1700000001), legacy(A, 'sheet', 1700000001), legacy(A, 'raw', 1600000000)];
    const lookalikes = [legacy(`${A}x`, 'sheet', 1700000001), legacy(`${A}-more`, 'sheet', 1700000001), legacy(`x${A}`, 'raw', 1700000001), `characters/${A}-thumb-1.jpg`, `characters/${A}-sheet-1.png`,
      legacy(B, 'raw', 1700000001), legacy(B, 'sheet', 1700000001), `panels/${A}-sheet-1700000001.jpg`, `characters/${ownerSegment(B)}/33333333-3333-3333-3333-333333333333-sheet.jpg`];
    for (const k of [...mine, ...lookalikes]) put(k);
    seedPointer(a, mine[0], mine[1]);
    const r = await del(a);
    assert.equal(r.status, 200); assert.deepEqual([r.body.status, r.body.partial, r.body.matched, r.body.deleted, r.body.failed], ['removed', false, 3, 3, 0]);
    for (const k of mine) assert.equal(has(k), false, `own ${k.replace(A, '<me>')} deleted`);
    for (const k of lookalikes) assert.equal(has(k), true, `${k.replace(A, '<me>').replace(B, '<other>')} untouched`);
    assert.equal(fake.get(`character:${a.identifier}`), null);
    assert.ok(providers.s3deletes.every((d) => mine.includes(d.key)), 'nothing but the three own keys was ever sent to DeleteObject');
    return { actual: '3 own legacy objects deleted; 9 look-alikes / foreign keys untouched' };
  });

scenario('V2', 'a pointer that names SOMEONE ELSE\'s legacy key (or a traversal) deletes nothing of theirs: ownership is the embedded id, not the pointer',
  'B\'s legacy sheet survives; result nothing-found', async () => {
    const a = await makeUser('v2a', 'free'); const b = await makeUser('v2b', 'free');
    const bRaw = legacy(b.identifier, 'raw', 1700000001); const bSheet = legacy(b.identifier, 'sheet', 1700000001);
    put(bRaw); put(bSheet); put('characters/../panels/secret.jpg');
    seedPointer(a, bRaw, bSheet);
    const r = await del(a);
    assert.deepEqual([r.body.status, r.body.partial, r.body.matched], ['nothing-found', true, 0]);
    assert.equal(has(bRaw), true); assert.equal(has(bSheet), true); assert.equal(providers.s3deletes.length, 0);
    assert.equal(fake.get(`character:${a.identifier}`), null, 'A\'s own (wrong) pointer is still cleared');
    return { actual: 'foreign keys named by the pointer are ignored' };
  });

scenario('V3', 'PARTIAL: one legacy object cannot be deleted → success:true but partial:true with the failed count; the pointer is gone, the stuck object is marked hidden (the app never uses it), a repeat call finishes the job',
  'status partial (failed 1) → retry removed', async () => {
    const a = await makeUser('v3a', 'free');
    const raw = legacy(a.identifier, 'raw', 1700000001); const sheet = legacy(a.identifier, 'sheet', 1700000001);
    put(raw); put(sheet); seedPointer(a, raw, sheet);
    providers.mode.s3deleteMatch = '-raw-';
    const r = await del(a);
    assert.deepEqual([r.body.status, r.body.partial, r.body.matched, r.body.deleted, r.body.failed], ['partial', true, 2, 1, 1]);
    assert.equal(has(sheet), false); assert.equal(has(raw), true); assert.equal(fake.get(`character:${a.identifier}`), null);
    assert.ok(fake.get(`report:hidden:${raw}`), 'marked hidden');
    delete providers.mode.s3deleteMatch;
    const again = await del(a);
    assert.deepEqual([again.body.status, again.body.partial, again.body.deleted], ['removed', false, 1]); assert.equal(has(raw), false);
    return { actual: 'partial reported honestly; second call completes' };
  });

scenario('V4', 'NOTHING FOUND is never reported as a full removal: a pointer with no stored objects, and a user with neither, both answer nothing-found (partial:true), and the pointer is cleared',
  'nothing-found twice; nothing sent to DeleteObject', async () => {
    const a = await makeUser('v4a', 'free'); const c = await makeUser('v4c', 'free');
    seedPointer(a, legacy(a.identifier, 'raw', 1), legacy(a.identifier, 'sheet', 1));   // objects were already removed
    const r = await del(a);
    assert.deepEqual([r.status, r.body.status, r.body.partial, r.body.matched, r.body.deleted], [200, 'nothing-found', true, 0, 0]);
    assert.equal(fake.get(`character:${a.identifier}`), null);
    const r2 = await del(c);
    assert.deepEqual([r2.body.status, r2.body.partial], ['nothing-found', true]);
    assert.equal(providers.s3deletes.length, 0);
    return { actual: 'honest nothing-found' };
  });

scenario('V5', 'current-format and legacy objects of the same user are removed together; the restore endpoint then returns no character',
  'both formats gone; GET -> null', async () => {
    const a = await makeUser('v5a', 'free');
    const cur = `characters/${ownerSegment(a.identifier)}/44444444-4444-4444-4444-444444444444-sheet.jpg`;
    const raw = legacy(a.identifier, 'raw', 1700000001); const sheet = legacy(a.identifier, 'sheet', 1700000001);
    put(cur); put(raw); put(sheet); seedPointer(a, raw, sheet);
    const r = await del(a);
    assert.deepEqual([r.body.status, r.body.deleted], ['removed', 3]);
    for (const k of [cur, raw, sheet]) assert.equal(has(k), false);
    assert.equal((await invoke(characterRoute, { method: 'GET', cookies: a.cookies, ip: ip() })).body.characterImageUrl, null);
    return { actual: 'both key formats removed' };
  });
