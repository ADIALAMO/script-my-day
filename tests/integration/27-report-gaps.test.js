/** Scenario G2 — report gaps: legacy keys, inline quarantine retries, the upload race, the flood alert, the daily sweep cron. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '27-report-gaps', nodeEnv: 'production', env: { R2_QUARANTINE_BUCKET_NAME: 'q-private-bucket', CRON_SECRET: 'cron-test-secret' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const poster = await ctx.route('generate-poster');
const uploadPanel = await ctx.route('upload-panel');
const report = await ctx.route('report-content');
const sweep = await (async () => (await import('../../pages/api/cron/sweep-hidden.js')).default)();
const { imageHash } = await import('../../lib/image-check.js');

const PUB = process.env.R2_BUCKET_NAME; const BASE = process.env.R2_PUBLIC_URL.replace(/\/$/, ''); const QB = 'q-private-bucket';
let ipN = 0; const ip = () => `198.51.100.${40 + (++ipN % 190)}`;
const put = (key, bucket = PUB) => providers.s3objects.set(`${bucket}/${key}`, { bytes: 5, metadata: {} });
const inPublic = (key) => providers.s3objects.has(`${PUB}/${key}`);
const inQ = (key) => providers.s3objects.has(`${QB}/${key}`);
const rep = (u, refs, address = ip()) => invoke(report, { body: { kind: 'panel', reason: 'sexual', refs }, cookies: u?.cookies ?? {}, ip: address });
const tg = (needle) => providers.telegram.filter((t) => t.includes(needle));
const SEG = 'a'.repeat(32); const newKey = (n) => `panels/${SEG}/0000000${n}-1111-1111-1111-111111111111.png`;
const cron = (headers = { authorization: 'Bearer cron-test-secret' }, method = 'GET') => invoke(sweep, { method, headers });
async function makeImage(u) {
  const g = await invoke(poster, { body: { prompt: 'A lone figure walks into the rain' }, cookies: u.cookies, ip: ip() });
  assert.ok(!g.body.isPlaceholder); return { data: g.body.imageUrl, hash: imageHash(g.body.imageUrl) };
}

scenario('G1', 'a LEGACY key (no owner segment) is hidden by a single report — a lone owner could never reach 2 reporters on an old image',
  'one report → hidden:true and moved to the private bucket; the alert says "legacy key"', async () => {
    const key = 'panels/1699999999999_abc123_00.png'; put(key);
    const u = await makeUser('g1', 'free');
    const r = await rep(u, [{ url: `${BASE}/${key}` }]);
    assert.equal(r.status, 200); assert.equal(r.body.results[0].hidden, true);
    assert.equal(inPublic(key), false); assert.equal(inQ(key), true);
    assert.match(tg('Content report').at(-1), /legacy key \(counted as owner\)/);
    // a NEW-format key owned by somebody else still needs two reporters
    const other = newKey(1); put(other);
    const r2 = await rep(u, [{ url: `${BASE}/${other}` }]);
    assert.equal(r2.body.results[0].hidden, false); assert.equal(inPublic(other), true);
    return { actual: 'legacy → immediate; foreign new-format → still 2 reporters' };
  });

scenario('G2', 'the quarantine copy is retried inline (3 tries): two transient failures still end in "moved"; three failures leave the original PUBLIC and untouched, flagged for the sweep',
  'copyFailures=2 → moved; copyFailures=3 → failed, public kept, alert mentions the retry + sweep', async () => {
    const a = 'panels/1699999999999_abc111_00.png'; put(a);
    const u = await makeUser('g2', 'free');
    providers.mode.s3copyFailures = 2;
    const r1 = await rep(u, [{ url: `${BASE}/${a}` }]);
    assert.equal(r1.body.results[0].hidden, true); assert.equal(inQ(a), true); assert.equal(inPublic(a), false); assert.equal(providers.s3copies.length, 1);
    const b = 'panels/1699999999999_abc999_00.png'; put(b);
    providers.mode.s3copyFailures = 3;
    const r2 = await rep(u, [{ url: `${BASE}/${b}` }]);
    assert.equal(r2.body.results[0].hidden, true); assert.equal(inPublic(b), true, 'the original is never deleted without a successful copy'); assert.equal(inQ(b), false);
    assert.equal(providers.s3deletes.filter((d) => d.key === b).length, 0);
    assert.match(tg('Content report').at(-1), /Quarantine FAILED after 3 tries.*daily sweep/);
    return { actual: '2 failures absorbed; 3 failures → kept public + flagged' };
  });

scenario('G3', 'the upload RACE: a hash report that lands while the upload is in flight (after the early check, before the object is mapped) still ends with the object quarantined and the upload answered 422',
  'afterPut hook reports the bytes; upload → 422; object in the private bucket; hidden flag set', async () => {
    const u = await makeUser('g3', 'free');
    const img = await makeImage(u);
    providers.hooks.afterPut = async () => { providers.hooks.afterPut = null; const r = await rep(u, [{ hash: img.hash }]); assert.equal(r.body.results[0].hidden, true); };
    const up = await invoke(uploadPanel, { body: { imageData: img.data, key: 'panels/s_00.png' }, cookies: u.cookies, ip: ip() });
    assert.equal(up.status, 422); assert.equal(up.body.code, 'CONTENT_REFUSED');
    const stored = providers.s3puts.at(-1).key;
    assert.equal(inPublic(stored), false); assert.equal(inQ(stored), true);
    assert.ok(fake.get(`report:hidden:${stored}`));
    assert.ok(tg('Content report').length >= 1);
    return { actual: 'race closed: stored object taken down by the upload itself' };
  });

scenario('G4', 'flood visibility: the first report over the hourly alert cap sends ONE count alert and suppresses the individual ones; reports are still processed',
  '31st report: no individual alert, one "Report volume high" alert; 32nd: nothing more', async () => {
    const hour = new Date().toISOString().slice(0, 13);
    fake.set(`report:alerts:${hour}`, 30);
    const u = await makeUser('g4', 'free');
    const k1 = 'panels/1699999999999_flood1_00.png'; const k2 = 'panels/1699999999999_flood2_00.png'; put(k1); put(k2);
    const before = providers.telegram.length;
    const r1 = await rep(u, [{ url: `${BASE}/${k1}` }]);
    assert.equal(r1.body.results[0].hidden, true); assert.equal(inQ(k1), true, 'still processed');
    assert.equal(providers.telegram.length, before + 1); assert.match(providers.telegram.at(-1), /Report volume high/);
    assert.equal(tg('Content report').length, 0, 'the individual alert was suppressed');
    const r2 = await rep(u, [{ url: `${BASE}/${k2}` }]);
    assert.equal(r2.body.results[0].hidden, true); assert.equal(providers.telegram.length, before + 1, 'no second count alert in the same hour');
    return { actual: 'one count alert, then silence, nothing lost' };
  });

// ── the daily sweep ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const hide = (key) => fake.set(`report:hidden:${key}`, JSON.stringify({ at: 1, via: 'owner', n: 1 }));

scenario('G5', 'sweep cron auth: only GET with the exact CRON_SECRET bearer works — no secret configured, wrong header, no header or another method → no action',
  '401 / 405 and nothing moved', async () => {
    const key = newKey(3); put(key); hide(key);
    for (const h of [{}, { authorization: 'Bearer nope' }, { authorization: 'cron-test-secret' }, { authorization: 'Bearer cron-test-secret ' }]) {
      const r = await cron(h); assert.equal(r.status, 401, JSON.stringify(h)); assert.equal(inPublic(key), true);
    }
    assert.equal((await cron({ authorization: 'Bearer cron-test-secret' }, 'POST')).status, 405);
    const keep = process.env.CRON_SECRET; delete process.env.CRON_SECRET;
    try { assert.equal((await cron({ authorization: 'Bearer undefined' })).status, 401); assert.equal((await cron({ authorization: 'Bearer ' })).status, 401); }
    finally { process.env.CRON_SECRET = keep; }
    assert.equal(inPublic(key), true); assert.equal(providers.s3copies.length, 0);
    return { actual: 'fail-closed' };
  });

scenario('G6', 'sweep cron: moves ONLY hidden objects that are still public (never deletes anything else), skips hash-only marks and already-quarantined items, returns counts without keys, sends one digest',
  'stuck hidden → moved; visible untouched; counts only', async () => {
    const stuck = newKey(4); const fine = newKey(5); const visible = newKey(6); const already = newKey(7);
    put(stuck); put(fine); put(visible); put(already, QB);
    hide(stuck); hide(already); fake.set(`report:hidden:h:${'a'.repeat(64)}`, '{}');
    put(fine, QB); providers.s3objects.delete(`${PUB}/${fine}`); hide(fine);
    const r = await cron();
    assert.equal(r.status, 200); assert.deepEqual({ ...r.body }, { success: true, examined: 3, stillPublic: 1, moved: 1, failed: 0, notConfigured: false, timedOut: false, finished: true });
    assert.equal(inPublic(stuck), false); assert.equal(inQ(stuck), true);
    assert.equal(inPublic(visible), true, 'a non-hidden object is never touched');
    assert.ok(!JSON.stringify(r.body).includes('panels/'), 'no keys in the response');
    assert.equal(providers.s3deletes.length, 1);
    const digest = tg('Report sweep');
    assert.equal(digest.length, 1); assert.match(digest[0], /moved to quarantine now: 1/); assert.ok(!digest[0].includes(stuck), 'the digest carries no object key for a successful move');
    return { actual: '1 moved, others untouched' };
  });

scenario('G7', 'sweep cron without the private bucket configured: nothing is moved or deleted, the digest says the objects are still public; with a failing copy: counted as failed, original kept',
  'notConfigured:true; failed:1', async () => {
    const key = newKey(8); put(key); hide(key);
    const keep = process.env.R2_QUARANTINE_BUCKET_NAME; delete process.env.R2_QUARANTINE_BUCKET_NAME;
    try {
      const r = await cron();
      assert.equal(r.body.notConfigured, true); assert.equal(r.body.moved, 0); assert.equal(inPublic(key), true); assert.equal(providers.s3copies.length, 0); assert.equal(providers.s3deletes.length, 0);
      assert.match(tg('Report sweep').at(-1), /R2_QUARANTINE_BUCKET_NAME is NOT set/);
    } finally { process.env.R2_QUARANTINE_BUCKET_NAME = keep; }
    ctx.advance(24 * 3600 * 1000);   // next day: a fresh digest window
    providers.mode.s3copy = 500;
    const r2 = await cron();
    assert.equal(r2.body.failed, 1); assert.equal(r2.body.moved, 0); assert.equal(inPublic(key), true); assert.equal(providers.s3deletes.length, 0);
    return { actual: 'never deletes; reports what it could not do' };
  });

scenario('G8', 'sweep cron: nothing to do → 200 with zero counts and NO Telegram message (no daily noise)',
  'examined 0, no alert', async () => {
    const r = await cron();
    assert.equal(r.status, 200); assert.equal(r.body.examined, 0); assert.equal(tg('Report sweep').length, 0);
    return { actual: 'quiet when idle' };
  });

scenario('G9', 'sweep cron safety: it NEVER touches LEGACY characters/ keys or any other out-of-scope key even if a hidden mark exists for it (a current-format characters/ object IS swept); it does not run from a Preview deployment; the cursor key is cleared after a full pass',
  'characters/ object stays public & untouched; preview → skipped; cursor deleted', async () => {
    const sel = 'characters/u:123-sheet-1700000000000.jpg';   // legacy key (embeds a user id): manual handling only
    const cur = `characters/${SEG}/11111111-1111-1111-1111-111111111111-sheet.jpg`;
    const odd = 'something-else/x.png';
    put(sel); put(odd); put(cur); hide(sel); hide(odd); hide(cur);
    const good = newKey(9); put(good); hide(good);
    const r = await cron();
    assert.equal(r.body.moved, 2); assert.equal(inQ(cur), true); assert.equal(inPublic(cur), false); assert.equal(inPublic(sel), true); assert.equal(inPublic(odd), true); assert.equal(inQ(good), true);
    assert.equal(providers.s3deletes.filter((d) => d.key === sel || d.key === odd).length, 0);
    assert.equal(fake.get('report:sweep:cursor'), null);
    // never from a Preview deployment (it may share the production variables)
    put(newKey(1)); hide(newKey(1));
    process.env.VERCEL_ENV = 'preview';
    try {
      const p = await cron();
      assert.equal(p.status, 200); assert.equal(p.body.skipped, 'not-production'); assert.equal(inPublic(newKey(1)), true);
      assert.equal((await cron({})).status, 401, 'still needs the secret first');
    } finally { delete process.env.VERCEL_ENV; }
    process.env.VERCEL_ENV = 'production';
    try { assert.equal((await cron()).body.moved, 1); } finally { delete process.env.VERCEL_ENV; }
    return { actual: 'scope-limited, production-only' };
  });
