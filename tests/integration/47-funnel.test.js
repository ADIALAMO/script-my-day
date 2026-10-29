/**
 * Scenario F — FUNNEL counters (stats:funnel:<day>:<step>:<web|app>:<in|guest>, HyperLogLog of one-way keyed hashes). Distinct people per step, admin API KEY
 * excluded, nothing identifying stored, web vs app from the native flag (browser steps) or a User-Agent check that excludes in-app browsers (server steps).
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '47-funnel', nodeEnv: 'production', env: { OBJECT_KEY_SECRET: 'test-object-key-secret-0123456789' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake, adminKeyHeader, fresh } = ctx;
const script = await ctx.route('generate-script');
const poster = await ctx.route('generate-poster');
const storyboard = await ctx.route('generate-storyboard');
const upload = await ctx.route('upload-character');
const eventRoute = await ctx.route('funnel-event');
const me = await ctx.route('me');
const adminFunnel = await ctx.route('admin/funnel');
const { funnelKey, readFunnel, FUNNEL_STEPS } = await import('../../lib/funnel-stats.js');
const { RETENTION } = await import('../../config/limits.js');

const DAY0 = '2026-10-15';
const APP_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.231205.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36';
const FB_UA = `${APP_UA} [FB_IAB/FB4A;FBAV/440.0.0.30.113;]`;
const JOURNAL = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama', gender: 'neutral' };
const SCRIPT_TEXT = 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.';
let seq = 0; let ipSeq = 0;
const freshIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;
const mkScript = (u, ip = freshIp(), headers = {}) => invoke(script, { body: JOURNAL, cookies: u?.cookies ?? {}, ip, headers });
const mkPoster = (u, ip = freshIp(), headers = {}) => invoke(poster, { body: { prompt: 'A lone figure walks into a neon-lit rainy street' }, cookies: u?.cookies ?? {}, ip, headers });
const mkComic = (u, ip = freshIp(), headers = {}) => invoke(storyboard, { body: { script: SCRIPT_TEXT, lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: `${Date.now()}${++seq}${Math.floor(Math.random() * 1e6)}` }, cookies: u?.cookies ?? {}, ip, headers });
const mkChar = (u, ip = freshIp(), headers = {}) => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u?.cookies ?? {}, ip, headers });
const ev = (body, ip = freshIp(), cookies = {}, headers = {}, method = 'POST') => invoke(eventRoute, { method, body, ip, cookies, headers });
const n = (step, p, c) => fake.hll(funnelKey(step, p, c, DAY0));
const all = () => fake.keys('stats:funnel:');

scenario('F1', 'server steps: a signed-in person making script → poster → comic → character is counted once per step, in `in`, on `web`',
  'script_req/ok, poster_req/ok, comic_start, star_start = 1 each', async () => {
    fresh();
    const u = await makeUser('f1', 'free');
    assert.equal((await mkScript(u)).status, 200); assert.equal((await mkScript(u)).status, 200);
    assert.equal((await mkPoster(u)).status, 200); assert.equal((await mkComic(u)).status, 200); assert.equal((await mkChar(u)).status, 200);
    for (const s of ['script_req', 'script_ok', 'poster_req', 'poster_ok', 'comic_start', 'star_start']) assert.equal(n(s, 'web', 'in'), 1, s);
    for (const s of ['landing', 'typed', 'share', 'signup']) assert.equal(n(s, 'web', 'in'), 0, s);
    assert.equal(n('script_ok', 'app', 'in'), 0); assert.equal(n('script_ok', 'web', 'guest'), 0);
    return { actual: all().length + ' keys' };
  });

scenario('F2', 'requested but failed: script_req counts, script_ok does not (all providers down); refused requests (quota / gate) count nothing',
  'script_req 1, script_ok 0', async () => {
    fresh();
    const u = await makeUser('f2', 'free');
    for (const p of ['gemini', 'openrouter-text', 'cohere', 'openrouter-free']) providers.mode[p] = 500;
    assert.equal((await mkScript(u)).status, 500); providers.reset();
    assert.equal(n('script_req', 'web', 'in'), 1); assert.equal(n('script_ok', 'web', 'in'), 0);
    fresh();
    assert.equal((await mkComic(null)).status, 403);                 // a guest is refused a comic before any counter
    assert.deepEqual(all(), []);
    return { actual: 'ok' };
  });

scenario('F3', 'guests land in `guest`; the same guest twice is one person; another address is another',
  'guest 1 → 1 → 2', async () => {
    fresh();
    await mkScript(null, '198.51.100.30'); await mkScript(null, '198.51.100.30');
    assert.equal(n('script_ok', 'web', 'guest'), 1);
    await mkScript(null, '198.51.100.31'); assert.equal(n('script_ok', 'web', 'guest'), 2);
    assert.equal(n('script_ok', 'web', 'in'), 0);
    return { actual: 'ok' };
  });

scenario('F4', 'server platform: the Capacitor WebView UA is `app`; a Facebook in-app WebView and plain browsers are `web`',
  'app 1, web 2', async () => {
    fresh();
    await mkScript(null, freshIp(), { 'user-agent': APP_UA });
    await mkScript(null, freshIp(), { 'user-agent': FB_UA });
    await mkScript(null, freshIp());
    assert.equal(n('script_ok', 'app', 'guest'), 1); assert.equal(n('script_ok', 'web', 'guest'), 2);
    return { actual: 'ok' };
  });

scenario('F5', 'NOT counted: the admin API KEY on every server route and on the browser endpoint',
  'no funnel keys', async () => {
    fresh();
    for (const f of [mkScript, mkPoster, mkComic, mkChar]) await f(null, freshIp(), adminKeyHeader);
    assert.equal((await ev({ event: 'landing' }, freshIp(), {}, adminKeyHeader)).status, 204);
    assert.deepEqual(all(), []);
    return { actual: 'clean' };
  });

scenario('F6', 'POST /api/funnel-event: only landing / typed / share are counted (204); anything else is a 400 and counts nothing; wrong method 405; `native` picks app',
  'enum enforced', async () => {
    fresh();
    assert.equal((await ev({ event: 'landing' })).status, 204);
    assert.equal((await ev({ event: 'typed', native: true })).status, 204);
    assert.equal((await ev({ event: 'share', native: 'yes' })).status, 204);         // only a real `true` is app
    assert.equal(n('landing', 'web', 'guest'), 1); assert.equal(n('typed', 'app', 'guest'), 1); assert.equal(n('share', 'web', 'guest'), 1);
    const before = all().length;
    for (const e of ['script_ok', 'signup', 'poster_ok', 'star_start', '', 'LANDING', 'landing ', '__proto__', 5, null, true, ['landing'], { event: 'landing' }, 'a'.repeat(4000)]) assert.equal((await ev({ event: e })).status, 400, JSON.stringify(e)?.slice(0, 40));
    for (const b of [undefined, null, {}, [], 'landing']) assert.equal((await ev(b)).status, 400);
    assert.equal((await ev({ event: 'landing' }, freshIp(), {}, {}, 'GET')).status, 405);
    assert.equal(all().length, before);
    return { actual: 'ok' };
  });

scenario('F7', 'a signed-in browser event lands in `in`; the same person sending twice is one',
  'in 1', async () => {
    fresh();
    const u = await makeUser('f7', 'free');
    await ev({ event: 'landing' }, '198.51.100.140', u.cookies); await ev({ event: 'landing' }, '198.51.100.141', u.cookies);
    assert.equal(n('landing', 'web', 'in'), 1); assert.equal(n('landing', 'web', 'guest'), 0);
    return { actual: 'ok' };
  });

scenario('F8', 'the browser endpoint is rate-limited (20 per 10 min per person) and its keys hold no raw IP or user id',
  '21st → 429; keys clean', async () => {
    fresh();
    const u = await makeUser('f8', 'free');
    let last; for (let i = 0; i < 20; i++) last = await ev({ event: 'typed' }, '198.51.100.150', u.cookies);
    assert.equal(last.status, 204);
    assert.equal((await ev({ event: 'typed' }, '198.51.100.150', u.cookies)).status, 429);
    for (const k of [...fake.keys('rl:funnel-event'), ...all()]) assert.ok(!/198\.51\.100|f8-free|f8@test|u:/.test(k), `identifier in ${k}`);
    return { actual: 'ok' };
  });

scenario('F9', 'what is stored: only HyperLogLog keys named by step/platform/class; members are 32-hex hashes; the hash is the creator hash; ttl ≈ 60 d + the rest of the day',
  'no identifier; ttl ok', async () => {
    fresh();
    const u = await makeUser('f9', 'free'); await mkScript(u, '198.51.100.40'); await mkScript(null, '198.51.100.41');
    for (const k of all()) {
      assert.match(k, /^stats:funnel:\d{4}-\d{2}-\d{2}:[a-z_]+:(web|app):(in|guest)$/);
      for (const m of fake.hllMembers(k)) { assert.match(m, /^[0-9a-f]{32}$/); }
      assert.ok(!k.includes(u.id) && !/198\.51\.100/.test(k));
      const ttl = fake.ttl(k); assert.ok(ttl > RETENTION.creatorStatsDays * 86400 && ttl <= (RETENTION.creatorStatsDays + 1) * 86400, `${k} ttl ${ttl}`);
    }
    return { actual: `${all().length} keys` };
  });

scenario('F10', 'signup: counted once from /api/me when the account is new (the flag is read-then-deleted); a second /api/me counts nothing',
  'signup in = 1', async () => {
    fresh();
    const u = await makeUser('f10', 'free');
    fake.set(`signup:fresh:${u.id}`, 'google', 600);
    const r1 = await invoke(me, { method: 'GET', cookies: u.cookies, headers: { 'user-agent': FB_UA } });
    assert.equal(r1.body.justSignedUp, true);
    assert.equal(n('signup', 'web', 'in'), 1);
    await invoke(me, { method: 'GET', cookies: u.cookies });
    assert.equal(n('signup', 'web', 'in'), 1);
    return { actual: 'ok' };
  });

scenario('F11', 'a Redis-free outcome: counting never changes a response (script still 200 when OBJECT_KEY_SECRET is missing)',
  '200, no funnel keys', async () => {
    fresh();
    const prev = process.env.OBJECT_KEY_SECRET; delete process.env.OBJECT_KEY_SECRET;
    try { const u = await makeUser('f11', 'free'); assert.equal((await mkScript(u)).status, 200); } finally { process.env.OBJECT_KEY_SECRET = prev; }
    assert.deepEqual(all(), []);
    return { actual: 'ok' };
  });

scenario('F12', 'admin read: /api/admin/funnel needs the admin gate and returns per-step counts (50 commands); 7-day union counts a returning person once',
  'union ok; 401/403 without admin', async () => {
    fresh();
    const a = await makeUser('f12-a', 'free'); const b = await makeUser('f12-b', 'free');
    await mkScript(a); await mkScript(b);
    ctx.advance(86400000); await mkScript(a);                         // a returns the next day
    const denied = await invoke(adminFunnel, { method: 'GET' });
    assert.ok([401, 403].includes(denied.status), String(denied.status));
    const ok = await invoke(adminFunnel, { method: 'GET', headers: adminKeyHeader });
    assert.equal(ok.status, 200); assert.equal(ok.headers['cache-control'], 'no-store');
    const row = ok.body.funnel.find((r) => r.step === 'script_ok');
    assert.equal(row.total, 2); assert.equal(row.web.in, 2);
    assert.equal(ok.body.funnel.length, FUNNEL_STEPS.length);
    assert.equal((await invoke(adminFunnel, { method: 'POST', headers: adminKeyHeader })).status, 405);
    return { actual: JSON.stringify(row) };
  });
