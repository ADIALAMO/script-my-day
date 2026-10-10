/** The whole script cascade is bounded by SCRIPT_TOTAL_BUDGET_MS so the 60 s route is never killed with a slot held. Budget shrunk to 1.5 s for the test. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '17-script-budget', env: { SCRIPT_TOTAL_BUDGET_MS: '1500', SCRIPT_GEMINI_QUALITY_BUDGET_MS: '1400', SCRIPT_GEMINI_MIN_START_MS: '100', SCRIPT_GEMINI_HEDGE_MS: '300' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const script = await ctx.route('generate-script');

scenario('T1', 'every call is cut to the remaining budget: all Gemini models hang → the route answers SCRIPT_FAIL right after the budget, later stages are skipped (not started), the quota slot is returned',
  'returns 500 SCRIPT_FAIL in ≈1.5 s (not the sum of all stage timeouts), no OpenRouter/Cohere call, counter 0', async () => {
    const u = await makeUser('t1', 'free');
    providers.latency.gemini = { 'gemini-2.5-flash': 60000, 'gemini-3-flash-preview': 60000, 'gemini-3.1-flash-lite-preview': 60000, 'gemini-2.5-flash-lite': 60000, 'gemini-flash-latest': 60000 };
    const t0 = Date.now();
    const r = await invoke(script, { body: { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama' }, cookies: u.cookies, ip: '198.51.100.150' });
    const took = Date.now() - t0;
    providers.reset();
    assert.equal(r.status, 500); assert.equal(r.body.code, 'SCRIPT_FAIL');
    assert.ok(took < 4000, `took ${took}ms`);
    assert.equal(providers.counts['openrouter-text'] || 0, 0, 'Gemma stage not started without time to finish');
    assert.equal(fake.num(`usage:script:${u.identifier}:2026-10-15`), 0);
    return { actual: `SCRIPT_FAIL after ${took}ms (budget 1500 ms); later stages skipped; slot returned`, evidence: 'lib/story-service.js timeLeft()/hasTime()/capTimeout()' };
  });
