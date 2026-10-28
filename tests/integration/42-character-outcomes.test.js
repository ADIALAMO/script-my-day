/**
 * Scenario C — Star Yourself outcome counters (stats:character:<day>:<name>), the client-failure endpoint, the admin card data, and "no account id in the logs".
 * Every upload-character request adds ONE `started` and exactly ONE outcome (derived from the final response); the browser-side failures arrive only through
 * POST /api/character-event (two fixed words). Numbers only: no identifier, no image data.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '42-character-outcomes', nodeEnv: 'production' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake, adminKeyHeader } = ctx;
const upload = await ctx.route('upload-character');
const event = await ctx.route('character-event');
const adminStats = await ctx.route('admin/stats');
const { ALL_COUNTERS, RETENTION_DAYS } = await import('../../lib/character-stats.js');

const DAY = '2026-10-15';
const up = (u, body = { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, ip = '198.51.100.130', headers = {}) => invoke(upload, { body, cookies: u?.cookies ?? {}, ip, headers });
const counts = () => Object.fromEntries(ALL_COUNTERS.map((n) => [n, fake.num(`stats:character:${DAY}:${n}`)]));
/** started = 1 and exactly ONE outcome = 1, everything else 0 */
const expectOne = (outcome) => { const c = counts(); const want = Object.fromEntries(ALL_COUNTERS.map((n) => [n, n === 'started' || n === outcome ? 1 : 0])); assert.deepEqual(c, want, `expected only started + ${outcome}: ${JSON.stringify(c)}`); };
const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').toString('base64')}`;
let ipSeq = 0;   // the limiter remembers a blocked caller in memory across scenarios: every request that is not about the limit itself gets its own address
const freshIp = () => `203.0.113.${(ipSeq++ % 250) + 1}`;
const ev = (body, ip = freshIp(), method = 'POST', cookies = {}) => invoke(event, { method, body, ip, cookies });

scenario('C1', 'each outcome moves exactly its own counter once (and `started`): succeeded, unsafe, minor_rejected, unavailable, sheet_failed, unsupported_format, blocked, error',
  'started 1 + one outcome 1, every time', async () => {
    const run = async (name, setup, send, want, status) => {
      ctx.fresh(); await setup?.();
      const u = await makeUser(`c1-${name}`, 'free'); const r = await send(u);
      if (status) assert.equal(r.status, status, name);
      expectOne(want);
    };
    await run('ok', null, (u) => up(u), 'succeeded', 200);
    await run('unsafe', () => { providers.moderationVerdict.value = 'unsafe'; }, (u) => up(u), 'unsafe', 422);
    await run('minor', () => { providers.ageVerdict.value = 'minor'; }, (u) => up(u), 'minor_rejected', 422);
    await run('unavail', () => { providers.mode['gemini-check-age'] = '500'; }, (u) => up(u), 'unavailable', 503);
    await run('sheet', () => { providers.mode['gemini-image'] = '500'; }, (u) => up(u), 'sheet_failed', 503);
    await run('svg', null, (u) => up(u, { selfieBase64: SVG, consent: true, adult: true }), 'unsupported_format', 400);
    await run('consent', null, (u) => up(u, { selfieBase64: PNG_DATA_URI, consent: false }), 'blocked', 400);
    ctx.fresh(); const anon = await up(null); assert.equal(anon.status, 403); expectOne('blocked');                  // anonymous: NEEDS_PRO
    ctx.fresh(); const noAdult = await makeUser('c1-noadult', 'free', { adult: false }); const na = await up(noAdult); assert.equal(na.body.code, 'ADULT_CONFIRMATION_REQUIRED'); expectOne('blocked');
    // server misconfiguration (storage not configured) = a server problem, not a refusal
    ctx.fresh(); const prev = process.env.R2_ACCESS_KEY_ID; delete process.env.R2_ACCESS_KEY_ID;
    try { const r = await up(await makeUser('c1-err', 'free')); assert.equal(r.body.code, 'SERVER_ERROR'); expectOne('error'); } finally { process.env.R2_ACCESS_KEY_ID = prev; }
    return { actual: 'all 10 paths: one outcome each' };
  });

scenario('C2', 'started = the sum of the outcomes over a mixed series; a rate-limited request counts as blocked',
  'sum(outcomes) == started', async () => {
    const u = await makeUser('c2', 'free');
    await up(u); await up(u, { selfieBase64: SVG, consent: true, adult: true }, '198.51.100.131'); await up(u, { selfieBase64: PNG_DATA_URI, consent: false }, '198.51.100.131');
    const r4 = await up(u, { selfieBase64: PNG_DATA_URI, consent: false }, '198.51.100.131');   // 4th in the window
    const r5 = await up(u, { selfieBase64: PNG_DATA_URI, consent: false }, '198.51.100.131');   // 5th → RATE_LIMITED
    assert.equal(r4.status, 400); assert.equal(r5.status, 429); assert.equal(r5.body.code, 'RATE_LIMITED');
    const c = counts(); const sum = ['succeeded', 'unsafe', 'unavailable', 'minor_rejected', 'sheet_failed', 'unsupported_format', 'blocked', 'error'].reduce((a, n) => a + c[n], 0);
    assert.equal(c.started, 5); assert.equal(sum, 5); assert.equal(c.succeeded, 1); assert.equal(c.unsupported_format, 1); assert.equal(c.blocked, 3);
    return { actual: JSON.stringify(c) };
  });

scenario('C3', 'NOT counted: a wrong method, and requests carrying the admin API KEY (admin-tier user ACCOUNTS are counted); keys expire after 60 days',
  'no counters for GET / admin key; account counted; ttl ~60 d', async () => {
    const g = await invoke(upload, { method: 'GET', body: undefined, ip: '198.51.100.132' }); assert.equal(g.status, 405);
    const a = await up(null, { selfieBase64: PNG_DATA_URI, consent: true }, '198.51.100.133', adminKeyHeader); assert.equal(a.status, 200);
    assert.deepEqual(fake.keys('stats:character:'), [], 'nothing counted for GET or for the admin key');
    const acct = await makeUser('c3-admin', 'admin'); const r = await up(acct, undefined, '198.51.100.134'); assert.equal(r.status, 200);
    expectOne('succeeded');
    const ttl = fake.ttl(`stats:character:${DAY}:started`); assert.ok(ttl > (RETENTION_DAYS - 1) * 86400 && ttl <= (RETENTION_DAYS + 1) * 86400, `ttl ${ttl}`);
    return { actual: `ttl ${ttl} s` };
  });

scenario('C4', 'POST /api/character-event: only the two fixed words are counted (204); anything else is a 400 and counts nothing; wrong method 405',
  'decode_failed 1, heic_detected 1; nothing else moves', async () => {
    assert.equal((await ev({ event: 'decode_failed' })).status, 204);
    assert.equal((await ev({ event: 'heic_detected' })).status, 204);
    const bad = ['started', 'succeeded', 'blocked', 'error', 'unsafe', '', 'DECODE_FAILED', 'decode_failed ', 'heic', '__proto__', 'constructor', 5, null, true, ['decode_failed'], { event: 'decode_failed' }, 'a'.repeat(4000)];
    for (const e of bad) assert.equal((await ev({ event: e })).status, 400, JSON.stringify(e)?.slice(0, 40));
    for (const body of [undefined, null, {}, [], 'decode_failed', { events: ['decode_failed'] }, { Event: 'decode_failed' }]) assert.equal((await ev(body)).status, 400, JSON.stringify(body));
    assert.equal((await ev({ event: 'decode_failed' }, freshIp(), 'GET')).status, 405);
    const c = counts(); assert.equal(c.decode_failed, 1); assert.equal(c.heic_detected, 1);
    for (const n of ALL_COUNTERS.filter((x) => x !== 'decode_failed' && x !== 'heic_detected')) assert.equal(c[n], 0, n);
    assert.deepEqual(fake.keys('stats:character:').sort(), [`stats:character:${DAY}:decode_failed`, `stats:character:${DAY}:heic_detected`]);
    return { actual: 'enum enforced' };
  });

scenario('C5', 'POST /api/character-event is rate-limited (20 per 10 min per person) and its limiter key holds no raw IP or user id',
  '21st → 429, counter 20; rl key without IP / id', async () => {
    const u = await makeUser('c5', 'free');
    let last; for (let i = 0; i < 20; i++) last = await ev({ event: 'decode_failed' }, '198.51.100.150', 'POST', u.cookies);
    assert.equal(last.status, 204);
    const over = await ev({ event: 'decode_failed' }, '198.51.100.150', 'POST', u.cookies);
    assert.equal(over.status, 429);
    assert.equal(fake.num(`stats:character:${DAY}:decode_failed`), 20, 'the limited request counted nothing');
    const rl = fake.keys('rl:character-event');
    assert.ok(rl.length >= 1);
    for (const k of [...fake.keys('rl:character-event'), ...fake.keys('stats:character:')]) assert.ok(!/198\.51\.100|c5-free|c5@test|u:/.test(k), `a key made by this endpoint holds an identifier: ${k}`);
    return { actual: `limiter keys ${rl.length}` };
  });

scenario('C6', 'the admin stats route returns characterOutcomes (today first, counts only)',
  'characterOutcomes[0] = today with the counts', async () => {
    await up(await makeUser('c6', 'free'), undefined, freshIp()); await ev({ event: 'heic_detected' });
    const r = await invoke(adminStats, { method: 'GET', headers: adminKeyHeader, ip: '198.51.100.160' });
    assert.equal(r.status, 200); assert.ok(Array.isArray(r.body.characterOutcomes));
    const today = r.body.characterOutcomes[0];
    assert.equal(today.day, DAY); assert.equal(today.counts.started, 1); assert.equal(today.counts.succeeded, 1); assert.equal(today.counts.heic_detected, 1);
    assert.deepEqual(Object.keys(today).sort(), ['counts', 'day']);
    return { actual: JSON.stringify(today.counts) };
  });

scenario('C7', 'logs: a successful upload prints "Character ready" with NO account id, and no console line of the whole request contains the user id, the identifier or the e-mail',
  'no id / e-mail in any log line', async () => {
    const lines = []; const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
    for (const k of Object.keys(orig)) console[k] = (...a) => { lines.push(a.map(String).join(' ')); };
    let u; let r;
    try { u = await makeUser('c7', 'free'); r = await up(u); } finally { Object.assign(console, orig); }
    assert.equal(r.status, 200);
    const all = lines.join('\n');
    assert.match(all, /🎭 Character ready/);
    assert.ok(!all.includes(u.id) && !all.includes(u.identifier) && !all.includes(u.email) && !/u:c7/.test(all), `an id leaked into the logs:\n${all.slice(0, 400)}`);
    return { actual: 'clean' };
  });
