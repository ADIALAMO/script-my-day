/**
 * Script cost: Gemini is HEDGED (second model only for a slow/failed first one) and the loser is aborted.
 * Hedge window shortened to 800 ms for the test (config SCRIPT_GEMINI_HEDGE_MS); fast tier 200 ms.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '13-script-hedge', env: { SCRIPT_GEMINI_HEDGE_MS: '800', SCRIPT_GEMINI_FAST_HEDGE_MS: '200' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser } = ctx;
const script = await ctx.route('generate-script');
const BODY = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama' };
const run = async (label) => { const u = await makeUser(label, 'free'); const t0 = performance.now(); const r = await invoke(script, { body: BODY, cookies: u.cookies, ip: '198.51.100.90' }); return { r, ms: performance.now() - t0 }; };
const models = () => providers.log.filter((l) => l.provider === 'gemini').map((l) => l.model);

scenario('S1', 'normal case: the first quality model answers → exactly ONE Gemini call per script, the second model is never started',
  'gemini=1 (gemini-2.5-flash only), aborted=0', async () => {
    const { r, ms } = await run('s1');
    assert.equal(r.status, 200); assert.equal(providers.counts.gemini, 1); assert.deepEqual(models(), ['gemini-2.5-flash']);
    assert.ok(!providers.counts['gemini-aborted']);
    assert.match(r.body.model, /gemini-2\.5-flash/);
    return { actual: `1 call (${models()}), ${Math.round(ms)} ms` };
  });

scenario('S2', 'slow first model (2 s, hedge after 0.8 s): the second model is started, answers first and WINS; the loser is aborted (AbortController)',
  'gemini=2, gemini-aborted=1, winner gemini-3-flash-preview', async () => {
    providers.latency.gemini = { 'gemini-2.5-flash': 2000, 'gemini-3-flash-preview': 100 };
    const { r, ms } = await run('s2');
    assert.equal(r.status, 200); assert.equal(providers.counts.gemini, 2); assert.equal(providers.counts['gemini-aborted'], 1);
    assert.match(r.body.model, /gemini-3-flash-preview/);
    assert.ok(ms < 1800, `answered in ${Math.round(ms)} ms (did not wait for the slow model)`);
    return { actual: `2 calls, 1 aborted loser, winner ${r.body.model}, ${Math.round(ms)} ms` };
  });

scenario('S3', 'first model FAILS (HTTP 500): the second starts IMMEDIATELY (no waiting for the hedge window)',
  'gemini=2 and the script comes back well before the 800 ms window', async () => {
    providers.mode['gemini:gemini-2.5-flash'] = 500;
    const { r, ms } = await run('s3');
    assert.equal(r.status, 200); assert.equal(providers.counts.gemini, 2);
    assert.match(r.body.model, /gemini-3-flash-preview/);
    assert.ok(ms < 500, `took ${Math.round(ms)} ms — it waited for the hedge timer`);
    return { actual: `2 calls, no waiting (${Math.round(ms)} ms)` };
  });

scenario('S4', 'both quality models fail → the fast tier is ALSO hedged: only ONE fast call is made when it answers',
  'gemini=3 (2 failed quality + 1 fast), not 5', async () => {
    providers.mode['gemini:gemini-2.5-flash'] = 500; providers.mode['gemini:gemini-3-flash-preview'] = 500;
    const { r } = await run('s4');
    assert.equal(r.status, 200); assert.equal(providers.counts.gemini, 3);
    assert.equal(models()[2], 'gemini-3.1-flash-lite-preview');
    return { actual: `3 calls: ${models().join(' → ')}` };
  });

scenario('S5', 'cost per script, hedged vs the old race: 1 call instead of 2 in the normal case',
  'a month of Pro scripts (620) = 620 calls instead of 1240', async () => {
    const u = await makeUser('s5', 'paid');
    for (let day = 1; day <= 2; day++) {
      ctx.setNow(`2026-10-0${day}T00:05:00Z`);
      for (let i = 0; i < 10; i++) { assert.equal((await invoke(script, { body: BODY, cookies: u.cookies, ip: '198.51.100.91' })).status, 200); }
      ctx.advance(130_000);
    }
    assert.equal(providers.counts.gemini, 20);
    return { actual: '20 scripts = 20 Gemini calls (race: 40)' };
  });
