/** Scenario B — script quotas (Free, Pro daily cap 20, reset next UTC day, 12/min rate limit). */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '02-scripts' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const script = await ctx.route('generate-script');
const BODY = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama', gender: 'neutral' };
const call = (u, ip) => invoke(script, { body: BODY, cookies: u.cookies, ip });
const geminiCalls = () => providers.counts.gemini || 0;

/** make `n` successful scripts for `u`, stepping the clock 2 min after every 10 so the 12/min limiter never interferes */
async function make(u, n, ip = '198.51.100.20') {
  const out = [];
  for (let i = 0; i < n; i++) { out.push(await call(u, ip)); if ((i + 1) % 10 === 0) ctx.advance(120_000); }
  return out;
}

scenario('B1', 'Free: 5 scripts per day, the 6th → QUOTA_SCRIPT with zero provider calls',
  '5×200, 6th 429 QUOTA_SCRIPT, gemini calls unchanged by the 6th', async () => {
    const u = await makeUser('b1', 'free');
    const ok = await make(u, 5);
    assert.ok(ok.every((r) => r.status === 200));
    const g = geminiCalls();
    const r = await call(u, '198.51.100.20');
    assert.equal(r.status, 429); assert.equal(r.body.code, 'QUOTA_SCRIPT');
    assert.equal(geminiCalls(), g, '6th request must not reach a provider');
    assert.equal(fake.num(`usage:script:${u.identifier}:2026-10-15`), 5, 'counter stays at the limit (refused request rolled back)');
    return { actual: `200×5, then 429 QUOTA_SCRIPT; gemini calls after 5 scripts = ${g} (${g / 5} per script)`, evidence: 'usage:script counter = 5' };
  });

scenario('B2', 'Pro: 20 scripts per day, 21st → dedicated QUOTA_SCRIPT_PRO, zero provider calls',
  '20×200, 21st 429 QUOTA_SCRIPT_PRO (not QUOTA_SCRIPT), 0 new provider calls', async () => {
    for (const kind of ['paid', 'adminGranted']) {
      const u = await makeUser(`b2-${kind}`, kind);
      const ok = await make(u, 20, `198.51.100.${kind === 'paid' ? 21 : 22}`);
      assert.equal(ok.filter((r) => r.status === 200).length, 20, kind);
      const g = geminiCalls();
      const r = await call(u, `198.51.100.${kind === 'paid' ? 21 : 22}`);
      assert.equal(r.status, 429, kind); assert.equal(r.body.code, 'QUOTA_SCRIPT_PRO', kind);
      assert.equal(geminiCalls(), g, `${kind}: the 21st call must make zero provider calls`);
    }
    return { actual: 'Pro (paid) and Pro (admin-granted): 20 allowed, 21st → 429 QUOTA_SCRIPT_PRO, no provider call', evidence: `gemini calls total ${geminiCalls()} for 40 scripts` };
  });

scenario('B3', 'Pro cap resets on the next UTC day (and not before)',
  'still blocked at 23:59:59, allowed at 00:00:01 next day', async () => {
    const u = await makeUser('b3', 'paid');
    await make(u, 20, '198.51.100.23');
    ctx.setNow('2026-10-15T23:59:59Z');
    assert.equal((await call(u, '198.51.100.23')).status, 429);
    ctx.setNow('2026-10-16T00:00:01Z');
    const r = await call(u, '198.51.100.23');
    assert.equal(r.status, 200);
    return { actual: '429 at 23:59:59Z, 200 at 00:00:01Z (new day key)' };
  });

scenario('B4', 'Pro: the per-minute rate limit of 12 applies (13th within a minute → RATE_LIMITED, 0 provider calls) and recovers',
  '12×200, 13th 429 RATE_LIMITED with Retry-After, no provider call; allowed again after the window', async () => {
    const u = await makeUser('b4', 'paid');
    const ip = '198.51.100.24';
    const res = [];
    for (let i = 0; i < 12; i++) res.push(await call(u, ip));
    assert.ok(res.every((r) => r.status === 200));
    const g = geminiCalls();
    const r13 = await call(u, ip);
    assert.equal(r13.status, 429); assert.equal(r13.body.code, 'RATE_LIMITED');
    assert.ok(r13.headers['retry-after'], 'Retry-After header present');
    assert.equal(geminiCalls(), g);
    ctx.advance(125_000);
    assert.equal((await call(u, ip)).status, 200);
    return { actual: `12 ok, 13th 429 RATE_LIMITED (Retry-After ${r13.headers['retry-after']}s), then ok after 125s` };
  });

scenario('B5', 'invalid input is rejected BEFORE the quota is touched or a provider is called',
  '400 INPUT_TOO_SHORT, counter unchanged, 0 provider calls', async () => {
    const u = await makeUser('b5', 'free');
    const r = await invoke(script, { body: { journalEntry: 'hi', genre: 'drama' }, cookies: u.cookies, ip: '198.51.100.25' });
    assert.equal(r.status, 400);
    assert.deepEqual(providers.counts, {});
    assert.equal(fake.num(`usage:script:${u.identifier}:2026-10-15`), 0);
    return { actual: `${r.status} ${r.body.code}; usage counter 0` };
  });

scenario('B6', 'all providers down → 500 SCRIPT_FAIL and the reserved quota slot is given back',
  'counter returns to 0 so a failed generation costs the user nothing', async () => {
    const u = await makeUser('b6', 'free');
    for (const p of ['gemini', 'openrouter-text', 'cohere', 'openrouter-free']) providers.mode[p] = 500;
    const r = await call(u, '198.51.100.26');
    assert.equal(r.status, 500); assert.equal(r.body.code, 'SCRIPT_FAIL');
    assert.equal(fake.num(`usage:script:${u.identifier}:2026-10-15`), 0);
    return { actual: `${r.status} ${r.body.code}; counter 0 (released)`, evidence: `provider attempts while failing: ${JSON.stringify(providers.counts)}` };
  });

scenario('B7', 'admin tier (stored) and x-admin-key are not counted against any script quota',
  '30 scripts, counters untouched', async () => {
    const admin = await makeUser('b7', 'admin');
    for (let i = 0; i < 11; i++) assert.equal((await call(admin, '198.51.100.27')).status, 200);
    assert.equal(fake.num(`usage:script:${admin.identifier}:2026-10-15`), 0);
    return { actual: '11 scripts for admin, usage counter 0' };
  });

scenario('B8', 'Pro monthly cap: 150 scripts per UTC month on top of 20/day — the 151st is refused with the MONTHLY message even though the day still has room; zero provider calls; resets on the 1st',
  '150 allowed over 8 days, 151st 429 QUOTA_SCRIPT_PRO_MONTH (daily counter rolled back), next month allowed', async () => {
    for (const kind of ['paid', 'adminGranted']) {
      fake.flush(); providers.reset(); ctx.setNow('2026-10-01T00:05:00Z');
      const u = await makeUser(`b8-${kind}`, kind);
      const ip = kind === 'paid' ? '198.51.100.28' : '198.51.100.29';
      let allowed = 0;
      for (let day = 1; day <= 8 && allowed < 150; day++) {
        ctx.setNow(`2026-10-0${day}T00:05:00Z`);
        for (let i = 0; i < 20 && allowed < 150; i++) { const r = await call(u, ip); assert.equal(r.status, 200, `${kind} day ${day} #${i + 1}`); allowed++; if ((i + 1) % 10 === 0) ctx.advance(130_000); }
      }
      assert.equal(allowed, 150);
      assert.equal(fake.num(`usage:script-month:${u.identifier}:2026-10`), 150);
      const g = geminiCalls();
      const day8 = fake.num(`usage:script:${u.identifier}:2026-10-08`);
      const r = await call(u, ip);
      assert.equal(r.status, 429, kind); assert.equal(r.body.code, 'QUOTA_SCRIPT_PRO_MONTH'); assert.equal(r.body.limit, 150);
      assert.equal(r.body.resetsAt, '2026-11-01T00:00:00.000Z');
      assert.equal(geminiCalls(), g, `${kind}: the refused script made zero provider calls`);
      assert.equal(fake.num(`usage:script-month:${u.identifier}:2026-10`), 150, 'monthly counter rolled back');
      assert.equal(fake.num(`usage:script:${u.identifier}:2026-10-08`), day8, 'the daily slot was returned too');
      assert.ok(fake.ttl(`usage:script-month:${u.identifier}:2026-10`) > 0);
      ctx.setNow('2026-10-31T23:59:59Z'); assert.equal((await call(u, ip)).status, 429, `${kind}: still blocked on the last second of October`);
      ctx.setNow('2026-11-01T00:00:05Z'); assert.equal((await call(u, ip)).status, 200, `${kind}: new month`);
      assert.equal(fake.num(`usage:script-month:${u.identifier}:2026-11`), 1);
    }
    const { getMsg } = await import('../../lib/messages.js');
    return { actual: '150 allowed; 151st → 429 QUOTA_SCRIPT_PRO_MONTH limit 150, resets 2026-11-01; blocked until the last second of October', evidence: `EN: ${getMsg('QUOTA_SCRIPT_PRO_MONTH', 'en')}  HE: ${getMsg('QUOTA_SCRIPT_PRO_MONTH', 'he')}` };
  });

scenario('B9', 'Free users have NO monthly script cap (5/day only), and the monthly counter is not created for them',
  'no usage:script-month key for Free', async () => {
    const u = await makeUser('b9', 'free');
    assert.equal((await call(u, '198.51.100.30')).status, 200);
    assert.equal(fake.keys('usage:script-month').length, 0);
    return { actual: 'Free: daily counter only' };
  });
