/**
 * Scenario U — user-supplied media (Google Play UGC hardening): selfie type/size checks on the BYTES, the checked bytes are the stored bytes, one-day (not immutable)
 * cache, owner-only "remove my character", characters/ objects are reportable + quarantinable + sweepable (alert included), the image proxy serves panels/ and posters/ only.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI, PNG_BYTES } from './lib/providers.mjs';

// production: Telegram alerts only fire there (lib/alert-throttle.js)
const ctx = await boot({ file: '31-ugc-media', nodeEnv: 'production', env: { R2_QUARANTINE_BUCKET_NAME: 'q-private-bucket', CRON_SECRET: 'cron-test-secret' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const upload = await ctx.route('upload-character');
const characterRoute = await ctx.route('character');
const report = await ctx.route('report-content');
const proxy = await ctx.route('proxy-image');
const poster = await ctx.route('generate-poster');
const panelUp = await ctx.route('upload-panel');
const sweep = (await import('../../pages/api/cron/sweep-hidden.js')).default;
const { imageHash } = await import('../../lib/image-check.js');
const { ownerSegment } = await import('../../lib/upload-image.js');

const PUB = process.env.R2_BUCKET_NAME; const BASE = process.env.R2_PUBLIC_URL.replace(/\/$/, ''); const QB = 'q-private-bucket';
let ipN = 0; const ip = () => `198.51.100.${10 + (++ipN % 200)}`;
const up = (u, selfieBase64 = PNG_DATA_URI) => invoke(upload, { body: { selfieBase64, consent: true, adult: true }, cookies: u.cookies, ip: ip() });
const keyOf = (url) => url.slice(BASE.length + 1);
const inPublic = (key) => providers.s3objects.has(`${PUB}/${key}`);
const inQ = (key) => providers.s3objects.has(`${QB}/${key}`);
const b64uri = (mime, buf) => `data:${mime};base64,${Buffer.from(buf).toString('base64')}`;
const SQ = (u) => `usage:sheet:${u.identifier}:2026-10`;
const rep = (u, key, kind = 'character') => invoke(report, { body: { kind, reason: 'sexual', refs: [{ url: `${BASE}/${key}` }] }, cookies: u?.cookies ?? {}, ip: ip() });

scenario('U1', 'selfie type is decided by its BYTES: SVG (script), GIF, BMP, plain text and an empty/short payload are refused with IMAGE_UNSUPPORTED before ANY reservation, check, storage or paid call',
  'every one → 400 IMAGE_UNSUPPORTED; zero provider calls; zero R2 writes; sheet counter 0', async () => {
    const u = await makeUser('u1', 'free');
    const bad = {
      svg: b64uri('image/svg+xml', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      gif: b64uri('image/gif', Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40)])),
      bmp: b64uri('image/bmp', Buffer.concat([Buffer.from('BM'), Buffer.alloc(40)])),
      'text claiming jpeg': b64uri('image/jpeg', 'this is not a picture at all, just text'),
      'html claiming png': b64uri('image/png', '<html><script>alert(1)</script></html>'),
      'png header too short': b64uri('image/png', PNG_BYTES.subarray(0, 8)),
    };
    for (const [name, uri] of Object.entries(bad)) {
      const r = await up(await makeUser(`u1-${name.replace(/\W+/g, '')}`, 'free'), uri);   // one user per case: the endpoint is rate limited (4 per 5 minutes)
      assert.equal(r.status, 400, name); assert.equal(r.body.code, 'IMAGE_UNSUPPORTED', name);
    }
    assert.deepEqual(providers.counts, {}); assert.equal(providers.s3puts.length, 0); assert.equal(fake.num(SQ(u)), 0);
    const huge = await up(await makeUser('u1-huge', 'free'), `data:image/png;base64,${'A'.repeat(8_000_001)}`);
    assert.equal(huge.status, 400); assert.equal(huge.body.code, 'INPUT_TOO_SHORT');
    return { actual: `${Object.keys(bad).length} refused by bytes + 1 oversized; nothing spent` };
  });

scenario('U2', 'a PNG labelled image/jpeg is accepted for what it IS: the safety check sees the exact stored bytes under the SNIFFED type (data:image/png), the key extension and Content-Type come from the bytes, the full two-opinion check runs on the selfie AND on the sheet',
  '200; moderation body image_url starts data:image/png; raw key .png + contentType image/png; imgsafety called twice', async () => {
    const u = await makeUser('u2', 'free');
    const r = await up(u, b64uri('image/jpeg', PNG_BYTES));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const first = providers.bodies.find((b) => b.provider === 'moderation').body;
    assert.ok(first.messages[0].content[0].image_url.url.startsWith(`data:image/png;base64,${PNG_BYTES.toString('base64')}`.slice(0, 40)));
    const raw = providers.s3puts.find((p) => /-raw\./.test(p.key));
    assert.match(raw.key, /-raw\.png$/); assert.equal(raw.contentType, 'image/png');
    assert.equal(providers.counts['gemini-imgsafety'], 2, 'second opinion for the selfie and for the generated sheet');
    return { actual: 'checked == stored; type from bytes; two second opinions' };
  });

scenario('U3', 'stored images are cached for ONE DAY, never "immutable": character objects and panels uploaded via upload-panel',
  'CacheControl public, max-age=86400 on raw, sheet and panel puts', async () => {
    const u = await makeUser('u3', 'free');
    assert.equal((await up(u)).status, 200);
    fake.set(`imgok:${imageHash(PNG_DATA_URI)}`, '1');
    const g = await invoke(panelUp, { body: { key: 'panels/x.png', imageData: PNG_DATA_URI }, cookies: u.cookies, ip: ip() });
    assert.equal(g.status, 200); assert.ok(g.body.url);
    const cc = providers.s3puts.slice(-3).map((p) => p.cacheControl);
    assert.deepEqual(cc, ['public, max-age=86400', 'public, max-age=86400', 'public, max-age=86400']);
    assert.ok(cc.every((c) => !/immutable/.test(c)));
    return { actual: 'one-day cache everywhere' };
  });

scenario('U4', 'OWNER-ONLY "remove my character": DELETE /api/character removes every object in the caller\'s own folder plus the pointer; another user\'s objects survive; a failing delete keeps the pointer (retryable 500)',
  'A\'s sheet + leftover raw gone, pointer gone, GET → null; B untouched; failure → 500 and pointer kept', async () => {
    const a = await makeUser('u4a', 'free'); const b = await makeUser('u4b', 'free');
    const ra = await up(a); const rb = await up(b);
    const aSheet = keyOf(ra.body.characterImageUrl); const bSheet = keyOf(rb.body.characterImageUrl);
    const aLeft = `characters/${ownerSegment(a.identifier)}/22222222-2222-2222-2222-222222222222-raw.jpg`;
    providers.s3objects.set(`${PUB}/${aLeft}`, { bytes: 5, metadata: {} });
    // a failing storage delete: nothing is claimed removed, the pointer stays so the user can retry
    providers.mode.s3delete = 500;
    const failed = await invoke(characterRoute, { method: 'DELETE', cookies: a.cookies, ip: ip() });
    assert.equal(failed.status, 500); assert.equal(failed.body.code, 'SERVER_ERROR'); assert.ok(fake.get(`character:${a.identifier}`), 'pointer kept for a retry');
    delete providers.mode.s3delete;
    const ok = await invoke(characterRoute, { method: 'DELETE', cookies: a.cookies, ip: ip() });
    assert.equal(ok.status, 200); assert.equal(ok.body.success, true);
    assert.equal(inPublic(aSheet), false); assert.equal(inPublic(aLeft), false); assert.equal(fake.get(`character:${a.identifier}`), null);
    assert.equal(inPublic(bSheet), true, 'B\'s character untouched'); assert.ok(fake.get(`character:${b.identifier}`));
    const g = await invoke(characterRoute, { method: 'GET', cookies: a.cookies, ip: ip() });
    assert.equal(g.body.characterImageUrl, null);
    // A cannot touch B's objects even if B's URL were in A's pointer
    fake.set(`character:${a.identifier}`, JSON.stringify({ url: rb.body.characterImageUrl, styledUrl: rb.body.characterImageUrl }));
    assert.equal((await invoke(characterRoute, { method: 'DELETE', cookies: a.cookies, ip: ip() })).status, 200);
    assert.equal(inPublic(bSheet), true, 'a pointer naming someone else\'s object deletes nothing of theirs');
    return { actual: 'own objects + pointer removed; others untouched; failure keeps the pointer' };
  });

scenario('U5', 'a characters/ object is REPORTABLE: the owner\'s report hides it at once (moved to the private bucket, pointer dropped, restore returns nothing), the Telegram alert fires, and a hidden reference is never used for generation',
  'hidden:true; QB has it, public does not; alert Kind: character + key; GET null; poster with the hidden URL makes no identity call', async () => {
    const a = await makeUser('u5a', 'free');
    const key = keyOf((await up(a)).body.characterImageUrl);
    const url = `${BASE}/${key}`;
    const r = await rep(a, key);
    assert.equal(r.status, 200); assert.equal(r.body.results[0].hidden, true);
    assert.equal(inPublic(key), false); assert.equal(inQ(key), true);
    assert.equal(fake.get(`character:${a.identifier}`), null, 'owner\'s pointer dropped');
    const alert = providers.telegram.filter((t) => t.includes('Content report')).at(-1);
    assert.ok(alert.includes(key) && /Kind: character/.test(alert) && /Quarantined/.test(alert), alert);
    assert.equal((await invoke(characterRoute, { method: 'GET', cookies: a.cookies, ip: ip() })).body.characterImageUrl, null);
    // a stale pointer (e.g. written by an older client) still cannot be used
    fake.set(`character:${a.identifier}`, JSON.stringify({ url, styledUrl: url }));
    const before = { grok: providers.counts.grok || 0, gem: providers.counts['gemini-image'] || 0 };
    const p = await invoke(poster, { body: { prompt: 'A lone figure walks into the rain', characterImageUrl: url }, cookies: a.cookies, ip: ip() });
    assert.equal(p.status, 200);
    assert.equal(providers.counts.grok || 0, before.grok); assert.equal(providers.counts['gemini-image'] || 0, before.gem);
    assert.equal(fake.num(`usage:identity:${a.identifier}:2026-10`), 0, 'no identity credit spent on a hidden reference');
    const g = await invoke(characterRoute, { method: 'GET', cookies: a.cookies, ip: ip() });
    assert.equal(g.body.characterImageUrl, null); assert.equal(fake.get(`character:${a.identifier}`), null, 'stale pointer forgotten');
    return { actual: 'owner report → quarantined + alert; hidden reference never used' };
  });

scenario('U6', 'a NON-owner needs two distinct reporters for a characters/ object (same rule as panels); the raw leftover kind is reportable too; legacy character keys and traversal are not',
  '1st report hidden:false, 2nd hidden:true; legacy key → 400', async () => {
    const a = await makeUser('u6a', 'free'); const x = await makeUser('u6x', 'free'); const y = await makeUser('u6y', 'free');
    const key = keyOf((await up(a)).body.characterImageUrl);
    const r1 = await rep(x, key); assert.equal(r1.body.results[0].hidden, false); assert.equal(inPublic(key), true);
    const r2 = await rep(y, key); assert.equal(r2.body.results[0].hidden, true); assert.equal(inQ(key), true);
    const raw = `characters/${ownerSegment(a.identifier)}/33333333-3333-3333-3333-333333333333-raw.jpg`;
    providers.s3objects.set(`${PUB}/${raw}`, { bytes: 5, metadata: {} });
    const rr = await rep(a, raw); assert.equal(rr.body.results[0].hidden, true); assert.equal(inQ(raw), true);
    for (const bad of ['characters/u:123-sheet-1700000000000.jpg', 'characters/user_old-raw-1700000000000.jpg', `characters/${ownerSegment(a.identifier)}/../x.jpg`]) {
      const b = await rep(a, bad); assert.equal(b.status, 400, bad); assert.equal(b.body.code, 'REPORT_INVALID');
    }
    return { actual: 'two reporters for non-owners; raw reportable; legacy/traversal refused' };
  });

scenario('U7', 'a raw selfie whose delete keeps failing is alerted (key in the private Telegram alert only) and marked hidden; the DAILY SWEEP then moves it to the private bucket — a current-format characters/ object is sweepable',
  'alert "Raw selfie not deleted"; after the sweep the raw is in QB and gone from public', async () => {
    const u = await makeUser('u7', 'free'); providers.mode.s3delete = 500;
    const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
    let r; try { r = await up(u); } finally { console.error = orig; }
    assert.equal(r.status, 200);
    const raw = providers.s3puts.find((p) => /-raw\./.test(p.key) && p.key.includes(ownerSegment(u.identifier))).key;
    const alert = providers.telegram.filter((t) => t.includes('Raw selfie not deleted')).at(-1);
    assert.ok(alert && alert.includes(raw), alert);
    assert.ok(!errs.join('\n').includes(raw), 'logs carry no key');
    assert.ok(fake.get(`report:hidden:${raw}`));
    delete providers.mode.s3delete;
    const s = await invoke(sweep, { method: 'GET', headers: { authorization: 'Bearer cron-test-secret' } });
    assert.equal(s.status, 200);
    assert.equal(inPublic(raw), false); assert.equal(inQ(raw), true);
    return { actual: 'alert + hidden mark; sweep moved the raw to the private bucket' };
  });

scenario('U8', '/api/proxy-image serves panels/ and posters/ ONLY: a characters/ URL (also encoded, also a raw selfie) is refused 403 with NO upstream fetch; panels still work',
  'characters/ → 403, r2-public fetches 0; panels/ → 200', async () => {
    const seg = ownerSegment('u:someone');
    const bad = [`${BASE}/characters/${seg}/44444444-4444-4444-4444-444444444444-sheet.jpg`, `${BASE}/characters/${seg}/44444444-4444-4444-4444-444444444444-raw.jpg`,
      `${BASE}/%63haracters/${seg}/44444444-4444-4444-4444-444444444444-sheet.jpg`, `${BASE}/characters/u:12-sheet-1700000000000.jpg`, `${BASE}/other/x.png`];
    const image = () => new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(PNG_BYTES.length) } });
    providers.handlers.r2 = () => image();
    for (const url of bad) assert.equal((await invoke(proxy, { method: 'GET', query: { url }, ip: ip() })).status, 403, url);
    assert.equal(providers.counts['r2-public'] || 0, 0, 'nothing was fetched upstream');
    assert.equal((await invoke(proxy, { method: 'GET', query: { url: `${BASE}/panels/${seg}/55555555-5555-5555-5555-555555555555.png` }, ip: ip() })).status, 200);
    return { actual: `${bad.length} refused without a fetch; panels/ served` };
  });
