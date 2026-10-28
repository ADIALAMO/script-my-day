/**
 * Scenario E — the active-creators count needs OBJECT_KEY_SECRET. In PRODUCTION without it the count would stay 0 in silence, so: one log line per instance and ONE deduped Telegram
 * per day (production deployment only), the request itself unchanged, nothing written.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '46-creator-secret', nodeEnv: 'production', env: { VERCEL_ENV: 'production' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake, advance, fresh } = ctx;
const script = await ctx.route('generate-script');
const { _resetCreatorWarn } = await import('../../lib/creator-stats.js');
const JOURNAL = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama', gender: 'neutral' };
const call = (u, ip) => invoke(script, { body: JOURNAL, cookies: u.cookies, ip });
const alerts = () => providers.telegram.filter((t) => /active-creators count is \*OFF\*/.test(t));
const withEnv = async (vars, fn) => { const prev = {}; for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } } };
const capture = async (fn) => { const lines = []; const o = console.warn; console.warn = (...a) => { lines.push(a.join(' ')); }; try { return { result: await fn(), lines }; } finally { console.warn = o; } };

scenario('E1', 'production without OBJECT_KEY_SECRET: scripts still answer 200, ONE log line per instance, ONE Telegram per day, nothing counted, fixed text',
  '200 x3; 1 log; 1 alert; no creators keys', async () => {
    fresh(); _resetCreatorWarn();
    const u = await makeUser('e1', 'free');
    const { result, lines } = await capture(() => withEnv({ OBJECT_KEY_SECRET: undefined }, async () => [await call(u, '198.51.100.180'), await call(u, '198.51.100.181'), await call(u, '198.51.100.182')]));
    for (const r of result) assert.equal(r.status, 200);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(lines.filter((l) => /Active-creators count is OFF/.test(l)).length, 1, 'one line per instance');
    assert.equal(alerts().length, 1, JSON.stringify(providers.telegram));
    assert.ok(!/@test\.example|198\.51\.100|e1-free|fake-/.test(alerts()[0]), 'fixed text');
    assert.deepEqual(fake.keys('stats:creators:'), []);
    return { actual: '1 line, 1 alert' };
  });

scenario('E2', 'a second instance the same day (log flag reset) logs again but the Telegram stays at one; the next day it may alert once more',
  'same day: 1 alert; next day: 2', async () => {
    _resetCreatorWarn();
    const u = await makeUser('e2', 'free');
    await withEnv({ OBJECT_KEY_SECRET: undefined }, async () => { await call(u, '198.51.100.183'); await new Promise((r) => setTimeout(r, 50)); });
    assert.equal(alerts().length, 1, 'still the one from today');
    advance(25 * 3600 * 1000); _resetCreatorWarn();
    await withEnv({ OBJECT_KEY_SECRET: undefined }, async () => { await call(u, '198.51.100.184'); await new Promise((r) => setTimeout(r, 50)); });
    assert.equal(alerts().length, 2);
    return { actual: '1 → 2' };
  });

scenario('E3', 'with the secret set, and on a Preview deployment without it: no log line, no alert (and the secret present counts normally)',
  '0 alerts, creator counted', async () => {
    fresh(); _resetCreatorWarn();
    const u = await makeUser('e3', 'free');
    const a = await capture(() => call(u, '198.51.100.185'));
    assert.equal(a.lines.filter((l) => /Active-creators/.test(l)).length, 0); assert.equal(alerts().length, 0);
    assert.equal(fake.keys('stats:creators:').length, 1);
    fresh(); _resetCreatorWarn();
    const v = await makeUser('e3b', 'free');
    await withEnv({ OBJECT_KEY_SECRET: undefined, VERCEL_ENV: 'preview', NODE_ENV: 'test' }, async () => { await call(v, '198.51.100.186'); await new Promise((r) => setTimeout(r, 50)); });
    assert.equal(alerts().length, 0, 'a Preview build never alerts');
    return { actual: 'silent' };
  });
