/**
 * Scenario P: the storyboard's privacy routes (DAILY_SCRIPT_BUDGET > 0, the default): every storyboard call carries provider.data_collection "deny", and the free
 * OpenRouter net and the direct (free-tier) Google key are never asked — even when every OpenRouter engine fails.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '38-storyboard-privacy', env: { DAILY_SCRIPT_BUDGET: '10' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser } = ctx;
const storyboard = await ctx.route('generate-storyboard');
const SCRIPT = 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.';
let seq = 0;
const open = (u, ip) => invoke(storyboard, { body: { script: SCRIPT, lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: `${Date.now()}${++seq}${Math.floor(Math.random() * 1e6)}` }, cookies: u.cookies, ip });

scenario('P1', 'every OpenRouter storyboard call carries deny, even after the leader fails (hedge + gemma-12b + deepseek)', 'all bodies deny; gemini 0; openrouter-free 0', async () => {
  providers.mode['storyboard-gemini'] = 500;
  const u = await makeUser('p1', 'free');
  await open(u, '198.51.100.140');
  const or = providers.bodies.filter((b) => b.body?.model);
  assert.ok(or.length >= 1);
  for (const b of or) assert.equal(b.body.provider?.data_collection, 'deny', b.body.model);
  assert.equal(providers.counts.gemini ?? 0, 0); assert.equal(providers.counts['openrouter-free'] ?? 0, 0);
  return { actual: 'deny everywhere, no free routes' };
});

scenario('P2', 'ALL OpenRouter engines failing → a clean failure and the direct Google key / free net are STILL not asked', '500 STORYBOARD_FAIL; gemini 0; openrouter-free 0', async () => {
  providers.mode['storyboard-gemini'] = 500;
  providers.mode['openrouter-text'] = 500;
  const u = await makeUser('p2', 'free');
  const r = await open(u, '198.51.100.141');
  assert.equal(r.status, 500);
  assert.equal(providers.counts.gemini ?? 0, 0); assert.equal(providers.counts['openrouter-free'] ?? 0, 0);
  return { actual: 'failed cleanly without a free route' };
});
