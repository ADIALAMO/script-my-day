/**
 * Scenario D — ACTIVE CREATORS (stats:creators:<day>:in|guest, HyperLogLog of one-way keyed hashes). Distinct people per UTC day, successful creations only,
 * admin API KEY excluded, nothing identifying stored, and counting can never delay / fail / change a response.
 * (The fake Redis emulates a HyperLogLog EXACTLY, so these tests check the logic, not the ~1% estimation error of the real structure.)
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '44-active-creators', nodeEnv: 'production', env: { OBJECT_KEY_SECRET: 'test-object-key-secret-0123456789' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake, adminKeyHeader, advance, fresh } = ctx;
const script = await ctx.route('generate-script');
const poster = await ctx.route('generate-poster');
const storyboard = await ctx.route('generate-storyboard');
const upload = await ctx.route('upload-character');
const adminStats = await ctx.route('admin/stats');
const { creatorsKey, readActiveCreators, creatorClass } = await import('../../lib/creator-stats.js');
const { creatorSegment, ownerSegment, reporterSegment } = await import('../../lib/upload-image.js');
const { RETENTION } = await import('../../config/limits.js');

const DAY0 = '2026-10-15';
const JOURNAL = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama', gender: 'neutral' };
const SCRIPT_TEXT = 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.';
let seq = 0;
const mkScript = (u, ip = '198.51.100.10', headers = {}) => invoke(script, { body: JOURNAL, cookies: u?.cookies ?? {}, ip, headers });
const mkPoster = (u, ip = '198.51.100.11', headers = {}) => invoke(poster, { body: { prompt: 'A lone figure walks into a neon-lit rainy street' }, cookies: u?.cookies ?? {}, ip, headers });
const mkComic = (u, ip = '198.51.100.12', headers = {}) => invoke(storyboard, { body: { script: SCRIPT_TEXT, lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: `${Date.now()}${++seq}${Math.floor(Math.random() * 1e6)}` }, cookies: u?.cookies ?? {}, ip, headers });
const mkChar = (u, ip = '198.51.100.13', headers = {}) => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u?.cookies ?? {}, ip, headers });
const inCount = (day = DAY0) => fake.hll(creatorsKey('in', day));
const guestCount = (day = DAY0) => fake.hll(creatorsKey('guest', day));
const hllKeys = () => fake.keys('stats:creators:');

scenario('D1', 'one person creating a script, a poster, a comic and a character counts ONCE; a second person makes it 2; guests are counted apart',
  'in 1 → 2; guest 0 → 1 → 2 (same IP once, other IP again)', async () => {
    fresh();
    const a = await makeUser('d1-a', 'free');
    assert.equal((await mkScript(a)).status, 200); assert.equal((await mkPoster(a)).status, 200);
    assert.equal((await mkComic(a)).status, 200); assert.equal((await mkChar(a)).status, 200);
    assert.equal(inCount(), 1, 'four kinds of creation by one person = one creator'); assert.equal(guestCount(), 0);
    const b = await makeUser('d1-b', 'free'); assert.equal((await mkScript(b, '198.51.100.20')).status, 200);
    assert.equal(inCount(), 2);
    assert.equal((await mkScript(null, '198.51.100.30')).status, 200); assert.equal((await mkScript(null, '198.51.100.30')).status, 200);
    assert.equal(guestCount(), 1, 'the same guest twice = once');
    assert.equal((await mkScript(null, '198.51.100.31')).status, 200); assert.equal(guestCount(), 2);
    assert.equal(inCount(), 2, 'guests never touch the signed-in counter');
    return { actual: `in ${inCount()}, guest ${guestCount()}` };
  });

scenario('D2', 'what is stored: only the two HyperLogLog keys; no raw user id, e-mail or IP anywhere (keys or members); the hash is its own label (not the owner / reporter segment)',
  'no identifier in any key/member; creatorSegment differs from owner/reporter', async () => {
    fresh();
    const u = await makeUser('d2', 'free'); await mkScript(u, '198.51.100.40'); await mkScript(null, '198.51.100.41');
    assert.deepEqual(hllKeys().sort(), [creatorsKey('guest', DAY0), creatorsKey('in', DAY0)].sort());
    const all = [...hllKeys(), ...hllKeys().flatMap((k) => fake.hllMembers(k))];
    for (const s of all) assert.ok(!s.includes(u.id) && !s.includes(u.email) && !/198\.51\.100/.test(s) && !/u:d2/.test(s), `identifier in ${s}`);
    for (const k of hllKeys()) for (const m of fake.hllMembers(k)) assert.match(m, /^[0-9a-f]{32}$/);
    assert.notEqual(creatorSegment(u.identifier), ownerSegment(u.identifier)); assert.notEqual(creatorSegment(u.identifier), reporterSegment(u.identifier));
    assert.equal(creatorSegment(u.identifier), creatorSegment(u.identifier), 'stable, so multi-day unions work');
    assert.deepEqual(fake.keys('usage:creators'), []);
    return { actual: 'clean' };
  });

scenario('D3', 'NOT counted: the admin API KEY (all four routes), refused / quota-blocked requests, and creations that failed (all providers down)',
  'no creators in any of these cases', async () => {
    fresh();
    for (const f of [mkScript, mkPoster, mkComic, mkChar]) await f(null, '198.51.100.50', adminKeyHeader);
    assert.deepEqual(hllKeys(), [], 'the admin key is not a creator');
    const anon = await makeUser('d3-free', 'free');
    for (const p of ['gemini', 'openrouter-text', 'cohere', 'openrouter-free']) providers.mode[p] = 500;
    const failed = await mkScript(anon, '198.51.100.51'); assert.equal(failed.status, 500);
    providers.reset();
    assert.equal(await (async () => (await mkComic(null, '198.51.100.52')).status)(), 403);      // a guest is refused a comic
    assert.deepEqual(hllKeys(), [], 'failed and refused requests are not creators');
    // an admin-tier ACCOUNT counts like anyone else
    const adm = await makeUser('d3-adm', 'admin'); assert.equal((await mkScript(adm, '198.51.100.53')).status, 200);
    assert.equal(inCount(), 1);
    return { actual: 'only the admin-tier account counted' };
  });

scenario('D4', 'retention: both keys expire ~60 days after their day ends (RETENTION.creatorStatsDays)',
  'ttl ≈ 60 d + the rest of the day', async () => {
    fresh();
    assert.equal(RETENTION.creatorStatsDays, 60);
    await mkScript(await makeUser('d4', 'free'), '198.51.100.60'); await mkScript(null, '198.51.100.61');
    for (const cls of ['in', 'guest']) {
      const ttl = fake.ttl(creatorsKey(cls, DAY0));
      assert.ok(ttl > 60 * 86400 && ttl <= 61 * 86400, `${cls} ttl ${ttl}`);
    }
    return { actual: `ttl ${fake.ttl(creatorsKey('in', DAY0))} s` };
  });

scenario('D5', '7- and 30-day distinct counts, daily list, and RETURNING creators (today vs the previous 6 days) — exact numbers over a simulated month',
  'd7/d30/returning as computed by hand', async () => {
    fresh();
    const A = await makeUser('d5-a', 'free'), B = await makeUser('d5-b', 'free'), C = await makeUser('d5-c', 'free');
    const day = (n) => new Date(Date.parse(`${DAY0}T12:00:00.000Z`) + n * 86400000).toISOString().slice(0, 10);
    // day 0: A, B + guest g1      day 3: A + guest g1 + guest g2      day 20: C       day 22 (today): A, C, new guest g3
    await mkScript(A); await mkScript(B, '198.51.100.71'); await mkScript(null, '198.51.100.90');
    advance(3 * 86400000); await mkScript(A); await mkScript(null, '198.51.100.90'); await mkScript(null, '198.51.100.91');
    advance(17 * 86400000); await mkScript(C, '198.51.100.72');
    advance(2 * 86400000); await mkScript(A); await mkScript(C, '198.51.100.72'); await mkScript(null, '198.51.100.92');
    assert.equal(day(22), new Date().toISOString().slice(0, 10));
    const r = await readActiveCreators();
    // returning = C only (created on day 20, inside the previous 6 days); A last created 19 days ago, so A is NOT returning in this sense
    assert.deepEqual(r.today, { in: 2, guest: 1, total: 3, returning: 1, fresh: 2 });
    assert.deepEqual(r.d7, { in: 2, guest: 1, total: 3 });                 // days 16..22: C, A (today) + g3
    assert.deepEqual(r.d30, { in: 3, guest: 3, total: 6 });                // A, B, C + g1, g2, g3
    assert.equal(r.daily.length, 14); assert.deepEqual(r.daily[0], { day: day(22), in: 2, guest: 1, total: 3 });
    assert.deepEqual(r.daily[2], { day: day(20), in: 1, guest: 0, total: 1 });
    assert.deepEqual(r.daily[1], { day: day(21), in: 0, guest: 0, total: 0 }, 'quiet days stay in the list as zeros');
    // the same numbers through the admin route
    const adm = await invoke(adminStats, { method: 'GET', headers: adminKeyHeader, ip: '198.51.100.99' });
    assert.equal(adm.status, 200); assert.deepEqual(adm.body.activeCreators, r);
    return { actual: JSON.stringify({ today: r.today, d7: r.d7, d30: r.d30 }) };
  });

scenario('D6', 'counting can never fail or change a response: PFADD failing — the script still answers 200 with the same body',
  '200 + same body; no throw', async () => {
    fresh();
    const u = await makeUser('d6', 'free');
    const ok = await mkScript(u, '198.51.100.80'); assert.equal(ok.status, 200);
    fake.control.failCommands.add('PFADD');
    const failing = await mkScript(u, '198.51.100.80'); assert.equal(failing.status, 200); assert.equal(typeof failing.body.script, 'string');
    fake.control.failCommands.clear();
    const again = await mkScript(u, '198.51.100.80'); assert.equal(again.status, 200);
    assert.equal(inCount(), 1);
    return { actual: 'unchanged responses' };
  });

scenario('D7', 'the admin route degrades quietly: activeCreators is null when PFCOUNT fails, the rest of the stats still answer',
  '200, activeCreators null', async () => {
    fresh();
    fake.control.failCommands.add('PFCOUNT');
    const adm = await invoke(adminStats, { method: 'GET', headers: adminKeyHeader, ip: '198.51.100.98' });
    assert.equal(adm.status, 200); assert.equal(adm.body.activeCreators, null); assert.ok(adm.body.users);
    fake.control.failCommands.clear();
    const empty = await invoke(adminStats, { method: 'GET', headers: adminKeyHeader, ip: '198.51.100.98' });
    assert.deepEqual(empty.body.activeCreators.today, { in: 0, guest: 0, total: 0, returning: 0, fresh: 0 });
    assert.equal(creatorClass('anonymous'), 'guest'); for (const t of ['free', 'pro', 'admin']) assert.equal(creatorClass(t), 'in');
    return { actual: 'null / zeros' };
  });
