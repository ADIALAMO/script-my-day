/** Scenario R — in-app report: distinct counting, owner-hides-at-once, quarantine (private bucket), proxy 410, hash reports, invalid input, rate limit, no PII. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

// production: Telegram alerts only fire there (lib/alert-throttle.js)
const ctx = await boot({ file: '24-report', nodeEnv: 'production', env: { R2_QUARANTINE_BUCKET_NAME: 'q-private-bucket' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const poster = await ctx.route('generate-poster');
const uploadPanel = await ctx.route('upload-panel');
const report = await ctx.route('report-content');
const proxy = await ctx.route('proxy-image');
const { imageHash } = await import('../../lib/image-check.js');
const { getMsg } = await import('../../lib/messages.js');

const PUB = process.env.R2_BUCKET_NAME;
const BASE = process.env.R2_PUBLIC_URL.replace(/\/$/, '');
const QB = 'q-private-bucket';
let ipN = 0;
const ip = () => `198.51.100.${60 + (++ipN % 150)}`;

/** generate an image as `u`, upload it like the browser does; returns { data, url, key, hash } */
async function makeImage(u, { upload = true, kind = 'panels' } = {}) {
  const g = await invoke(poster, { body: { prompt: 'A lone figure walks into the rain' }, cookies: u.cookies, ip: ip() });
  assert.equal(g.status, 200); assert.ok(!g.body.isPlaceholder, 'image generated');
  const data = g.body.imageUrl;
  const out = { data, hash: imageHash(data) };
  if (upload) {
    const r = await invoke(uploadPanel, { body: { imageData: data, key: `${kind}/s_00.png` }, cookies: u.cookies, ip: ip() });
    assert.equal(r.status, 200); out.url = r.body.url; out.key = r.body.url.slice(BASE.length + 1);
  }
  return out;
}
const rep = (u, refs, extra = {}, address = ip()) => invoke(report, { body: { kind: 'panel', reason: 'sexual', refs, ...extra }, cookies: u?.cookies ?? {}, ip: address });
const hiddenFlag = (key) => fake.get(`report:hidden:${key}`);
const inPublic = (key) => providers.s3objects.has(`${PUB}/${key}`);
const inQuarantine = (key) => providers.s3objects.has(`${QB}/${key}`);
const proxyGet = (url) => invoke(proxy, { method: 'GET', query: { url }, ip: ip() });
const tg = () => providers.telegram.filter((t) => t.includes('Content report'));

scenario('R1', 'owner report hides IMMEDIATELY: object moves to the private bucket (gone from the public one), proxy answers 410 no-store, the provider tag travelled to the object metadata, one Telegram alert with the key and no personal data',
  'hidden:true; q-bucket has it, public does not; proxy 410; metadata provider; alert has key', async () => {
    const u = await makeUser('r1', 'free');
    const img = await makeImage(u);
    assert.equal(providers.s3objects.get(`${PUB}/${img.key}`).metadata.provider, 'Cloudflare-Flux', 'provider tag on the R2 object');
    assert.equal(fake.get(`objkey:${img.hash}`), img.key, 'hash → key mapping written');
    const r = await rep(u, [{ url: img.url }]);
    assert.equal(r.status, 200); assert.equal(r.body.results[0].hidden, true);
    assert.equal(inPublic(img.key), false); assert.equal(inQuarantine(img.key), true);
    assert.ok(hiddenFlag(img.key));
    const p = await proxyGet(img.url);
    assert.equal(p.status, 410); assert.equal(p.headers['cache-control'], 'no-store');
    assert.equal(tg().length, 1);
    const t = tg()[0];
    assert.ok(t.includes(img.key) && t.includes('Quarantined') && t.includes('Cloudflare-Flux') && /Owner: yes/.test(t), t);
    assert.ok(!t.includes('data:image'), 'never the image');
    return { actual: 'owner → hidden, quarantined, proxy 410, alert with key only' };
  });

scenario('R2', 'a NON-owner needs 2 DISTINCT reporters: the same reporter twice counts once, the 2nd distinct reporter hides it',
  'B: hidden false (still public); B again: already; C: hidden true, moved', async () => {
    const owner = await makeUser('r2o', 'free'); const b = await makeUser('r2b', 'free'); const c = await makeUser('r2c', 'free');
    const img = await makeImage(owner);
    const r1 = await rep(b, [{ url: img.url }]);
    assert.equal(r1.body.results[0].hidden, false); assert.equal(inPublic(img.key), true);
    const r2 = await rep(b, [{ url: img.url }]);
    assert.equal(r2.body.results[0].already, true); assert.equal(fake.exec(['SCARD', `report:who:${img.key}`]), 1, 'same reporter counted once');
    assert.equal(inPublic(img.key), true);
    const r3 = await rep(c, [{ url: img.url }]);
    assert.equal(r3.body.results[0].hidden, true); assert.equal(inQuarantine(img.key), true); assert.equal(inPublic(img.key), false);
    assert.equal(fake.exec(['SCARD', `report:who:${img.key}`]), 2);
    assert.match(tg().at(-1), /Owner: no/);
    return { actual: '1 distinct → visible; same again → already; 2 distinct → hidden' };
  });

scenario('R3', 'hash-based report BEFORE the upload: hides the bytes (pending upload) and upload-panel then refuses them — nothing is stored',
  'hidden h:<hash>; upload → 422; no R2 put', async () => {
    const u = await makeUser('r3', 'free');
    const img = await makeImage(u, { upload: false });
    const r = await rep(u, [{ hash: img.hash }]);
    assert.equal(r.status, 200); assert.equal(r.body.results[0].hidden, true);
    assert.ok(hiddenFlag(`h:${img.hash}`)); assert.match(tg().at(-1), /Not uploaded yet/);
    const up = await invoke(uploadPanel, { body: { imageData: img.data, key: 'panels/s_00.png' }, cookies: u.cookies, ip: ip() });
    assert.equal(up.status, 422); assert.equal(up.body.code, 'CONTENT_REFUSED');
    assert.equal(providers.s3puts.length, 0);
    return { actual: 'reported bytes can never be uploaded' };
  });

scenario('R4', 'hash-based report AFTER the upload resolves through objkey:<hash> and quarantines the stored object',
  'object moved to the private bucket', async () => {
    const u = await makeUser('r4', 'free');
    const img = await makeImage(u);
    const r = await rep(u, [{ hash: img.hash }]);
    assert.equal(r.body.results[0].hidden, true);
    assert.equal(inQuarantine(img.key), true); assert.equal(inPublic(img.key), false);
    return { actual: 'hash → key → quarantined' };
  });

scenario('R5', 'invalid reports are rejected (400 REPORT_INVALID) and write NOTHING: foreign origin, characters/ keys, traversal, malformed hash, unknown hash, object that does not exist, bad reason/kind, empty, too many refs',
  'every case 400; no report:* / stats:report keys', async () => {
    const u = await makeUser('r5', 'free');
    const bad = [
      { refs: [{ url: 'https://evil.example/panels/x.png' }] },
      { refs: [{ url: `${BASE}/characters/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/11111111-1111-1111-1111-111111111111-sheet.jpg` }] },
      { refs: [{ url: `${BASE}/panels/../characters/x.png` }] },
      { refs: [{ url: `${BASE}/panels/%2e%2e/x.png` }] },
      { refs: [{ url: `${BASE}/panels/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/11111111-1111-1111-1111-111111111111.png` }] },   // well-formed but no such object
      { refs: [{ hash: 'xyz' }] },
      { refs: [{ hash: 'a'.repeat(64) }] },                                                                      // never generated here
      { refs: [] }, { refs: [{}] }, { refs: 'nope' },
      { refs: Array.from({ length: 9 }, (_, i) => ({ hash: i.toString(16).repeat(64).slice(0, 64) })) },
      { refs: [{ hash: 'b'.repeat(64) }], reason: 'spam' }, { refs: [{ hash: 'b'.repeat(64) }], kind: 'avatar' },
    ];
    for (const [i, b] of bad.entries()) {
      if (i > 0 && i % 8 === 0) ctx.advance(21 * 60 * 1000);   // stay under the 10-per-10-minutes limit (R6 covers the limit itself)
      const r = await rep(u, b.refs, { ...(b.reason ? { reason: b.reason } : {}), ...(b.kind ? { kind: b.kind } : {}) }, `198.51.100.${200 + i}`);
      assert.equal(r.status, 400, JSON.stringify(b).slice(0, 80)); assert.equal(r.body.code, 'REPORT_INVALID');
    }
    assert.equal(fake.keys('report:').length, 0, 'no report keys'); assert.equal(fake.keys('stats:report').length, 0);
    assert.equal(tg().length, 0); assert.equal(providers.s3copies.length, 0);
    assert.match(getMsg('REPORT_INVALID', 'en'), /can't be reported/); assert.match(getMsg('REPORT_INVALID', 'he'), /[א-ת]/);
    return { actual: `${bad.length} invalid inputs, all 400, nothing written` };
  });

scenario('R6', 'rate limit: 10 reports per 10 minutes per reporter, the 11th → 429 RATE_LIMITED (before any Redis state)',
  '10 × 400/200, then 429', async () => {
    const u = await makeUser('r6', 'free');
    let last;
    for (let i = 0; i < 11; i++) last = await rep(u, [{ hash: 'c'.repeat(64) }], {}, '198.51.100.222');
    assert.equal(last.status, 429); assert.equal(last.body.code, 'RATE_LIMITED');
    return { actual: '11th request limited' };
  });

scenario('R7', 'NO PERSONAL DATA is stored: after reports from a signed-in user and a guest, no Redis key or value, and no Telegram text, contains the IP, the user id or the e-mail; the stored reporter ids are HMACs',
  'scan finds nothing; who-set members are 32-hex', async () => {
    const owner = await makeUser('r7pii', 'free');
    const img = await makeImage(owner);
    const GUEST_IP = '203.0.113.77';
    await rep(null, [{ url: img.url }], {}, GUEST_IP);                  // guest, non-owner
    await rep(owner, [{ url: img.url }], { reason: 'violent' }, '203.0.113.78');
    const needles = [GUEST_IP, '203.0.113.78', owner.id, owner.email, 'r7pii'];
    const dump = [];
    // everything this feature writes (account/tier records of the test user are other features' state and are excluded)
    const MINE = ['report:', 'objkey:', 'imgok:', 'stats:report', 'rl:report-content', 'alert:report'];
    for (const k of fake.keys('').filter((x) => MINE.some((p) => x.startsWith(p)))) {
      dump.push(k);
      const type = fake.get(k);
      if (type !== null) dump.push(String(type));
      try { const m = fake.exec(['SMEMBERS', k]); if (Array.isArray(m)) dump.push(...m); } catch { /* not a set */ }
    }
    dump.push(...providers.telegram);
    const blob = dump.join('\n');
    for (const n of needles) assert.ok(!blob.includes(n), `leaked ${n}`);
    for (const k of fake.keys('report:who:')) for (const m of fake.exec(['SMEMBERS', k])) assert.match(m, /^[0-9a-f]{32}$/);
    return { actual: 'no IP / id / e-mail anywhere; reporters are 32-hex HMACs' };
  });

scenario('R8', 'quarantine bucket NOT configured → nothing is deleted or copied; the item is still hidden (Redis, proxy 410) and the alert says the object is STILL PUBLIC',
  'public object untouched; flag set; alert warns', async () => {
    const keep = process.env.R2_QUARANTINE_BUCKET_NAME; delete process.env.R2_QUARANTINE_BUCKET_NAME;
    try {
      const u = await makeUser('r8', 'free');
      const img = await makeImage(u);
      const r = await rep(u, [{ url: img.url }]);
      assert.equal(r.body.results[0].hidden, true);
      assert.equal(inPublic(img.key), true, 'nothing deleted'); assert.equal(providers.s3copies.length, 0); assert.equal(providers.s3deletes.length, 0);
      assert.ok(hiddenFlag(img.key)); assert.equal((await proxyGet(img.url)).status, 410);
      assert.match(tg().at(-1), /STILL PUBLIC/);
    } finally { process.env.R2_QUARANTINE_BUCKET_NAME = keep; }
    return { actual: 'hidden in the app, object kept, owner told to take it down' };
  });

scenario('R9', 'a FAILED quarantine copy never deletes the original; the item is still hidden and the alert says it failed',
  'public object kept; alert FAILED', async () => {
    const u = await makeUser('r9', 'free');
    const img = await makeImage(u);
    providers.mode.s3copy = 500;
    const r = await rep(u, [{ url: img.url }]);
    assert.equal(r.body.results[0].hidden, true);
    assert.equal(inPublic(img.key), true); assert.equal(inQuarantine(img.key), false); assert.equal(providers.s3deletes.length, 0);
    assert.match(tg().at(-1), /Quarantine FAILED/);
    return { actual: 'copy failed → original untouched' };
  });

scenario('R10', 'a reel report lists its frames: each is counted separately, duplicates inside one request count once, valid and invalid refs can mix',
  '3 valid + 1 duplicate + 1 invalid → per-ref results, 3 hidden', async () => {
    const u = await makeUser('r10', 'paid');
    const a = await makeImage(u); const b = await makeImage(u); const c = await makeImage(u);
    const r = await rep(u, [{ url: a.url }, { url: b.url }, { url: c.url }, { url: a.url }, { url: 'https://evil.example/x.png' }], { kind: 'reel' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.results.map((x) => !!x.ok), [true, true, true, true, false]);
    assert.equal(r.body.results[3].already, true);
    for (const x of [a, b, c]) assert.equal(inQuarantine(x.key), true);
    assert.match(tg()[0], /Kind: reel/);
    return { actual: 'frames handled one by one' };
  });

scenario('R11', 'provider tag: only a server-written marker reaches the object metadata — a direct upload (no marker) carries none, and a hostile tag is never produced',
  'marker upload has provider; checked direct upload has none', async () => {
    const u = await makeUser('r11', 'free');
    const withMark = await makeImage(u);
    assert.equal(providers.s3objects.get(`${PUB}/${withMark.key}`).metadata.provider, 'Cloudflare-Flux');
    const direct = await invoke(uploadPanel, { body: { imageData: `data:image/png;base64,${Buffer.concat([Buffer.from(PNG_DATA_URI.split(',')[1], 'base64'), Buffer.from([7])]).toString('base64')}`, key: 'panels/x_00.png' }, cookies: u.cookies, ip: ip() });
    assert.equal(direct.status, 200);
    assert.equal(providers.s3objects.get(`${PUB}/${direct.body.url.slice(BASE.length + 1)}`).metadata?.provider, undefined);
    return { actual: 'metadata comes from the server marker only' };
  });

scenario('R12', 'reporting a hidden item again is idempotent (no second move, no second alert); an owner who reports twice does not double count',
  'second report: already, alerts stay 1', async () => {
    const u = await makeUser('r12', 'free');
    const img = await makeImage(u);
    await rep(u, [{ url: img.url }]);
    const copies = providers.s3copies.length; const alerts = tg().length;
    const r = await rep(u, [{ url: img.url }]);
    assert.equal(r.body.results[0].already, true); assert.equal(r.body.results[0].hidden, true);
    assert.equal(providers.s3copies.length, copies); assert.equal(tg().length, alerts);
    return { actual: 'idempotent' };
  });
