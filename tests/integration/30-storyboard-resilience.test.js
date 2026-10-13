/**
 * Scenario R: the storyboard engine cascade.
 *  leader   Gemini Flash-Lite THROUGH OpenRouter (data_collection deny, strict json_schema, own budget + circuit)
 *  hedge    OpenRouter gemma-3-27b (after 4 s, or at once when the leader fails / is skipped)
 *  fallback gemma-3-12b, deepseek, the free net, and LAST the direct Google key (free tier)
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '30-storyboard-resilience' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const storyboard = await ctx.route('generate-storyboard');
const SCRIPT = 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.';
let seq = 0;
const open = (u, ip) => invoke(storyboard, { body: { script: SCRIPT, lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: `${Date.now()}${++seq}${Math.floor(Math.random() * 1e6)}` }, cookies: u.cookies, ip });
const panelsJson = (n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ panel: i + 1, scene: 'EXT. BEACH - DAY', visual: `A calm family on the beach, medium shot, soft light ${i + 1}`, dialogue: 'Line', hero: false })));
const month = () => '2026-10';
const SPEND = 'usage:storyboard:paid:global:2026-10-15';   // DAILY_STORYBOARD_BUDGET counter (virtual clock day)
const CIRCUIT = 'circuit:img:storyboard_gemini';
const leaderBodies = () => providers.bodies.filter((b) => b.provider === 'storyboard-gemini').map((b) => b.body);

scenario('R1', 'the FIRST engine is Gemini Flash-Lite through OpenRouter: data_collection deny, strict json_schema, 2000 tokens; the direct Google key and gemma are not called; the call is counted',
  'storyboard-gemini 1; gemini 0; openrouter-text 0; usage:storyboard:paid:global = 1', async () => {
    const u = await makeUser('r1', 'free');
    const r = await open(u, '198.51.100.120');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 7);
    assert.equal(providers.counts['storyboard-gemini'], 1);
    assert.equal(providers.counts.gemini ?? 0, 0, 'direct Gemini is the last fallback only');
    assert.equal(providers.counts['openrouter-text'] ?? 0, 0);
    const b = leaderBodies()[0];
    assert.equal(b.model, 'google/gemini-2.5-flash-lite');
    assert.equal(b.provider.data_collection, 'deny'); assert.equal(b.provider.require_parameters, true);
    assert.equal(b.max_tokens, 2000);
    assert.equal(b.response_format.type, 'json_schema'); assert.equal(b.response_format.json_schema.name, 'storyboard'); assert.equal(b.response_format.json_schema.strict, true);
    assert.equal(b.response_format.json_schema.schema.type, 'object');
    assert.equal(fake.num(SPEND), 1, 'one paid call counted');
    return { actual: 'leader via OpenRouter, deny, schema, counted' };
  });

scenario('R2', 'leader failing (500) → the gemma-3-27b hedge starts AT ONCE (not after 4 s); the paid slot is given back (nothing billed) and the circuit notes the failure',
  '200 < 3 s; openrouter-text 1; usage:storyboard:paid:global back to 0; circuit key present', async () => {
    providers.mode['storyboard-gemini'] = 500;
    providers.sbRaw.queue.push(JSON.stringify({ panels: JSON.parse(panelsJson(6)) }));   // consumed by the hedge (the leader failed before reading it)
    const u = await makeUser('r2', 'free');
    const t0 = Date.now();
    const r = await open(u, '198.51.100.121');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 6, 'the {panels:[...]} wrapper answer is parsed');
    assert.ok(Date.now() - t0 < 3000, 'a failed leader never makes the hedge wait');
    const or = providers.bodies.find((b) => b.body?.model === 'google/gemma-3-27b-it').body;
    assert.equal(or.max_tokens, 2000); assert.equal(or.provider.require_parameters, true); assert.equal(or.response_format.json_schema.name, 'storyboard');
    assert.equal(fake.num(SPEND), 0, 'a failed call was not billed: slot released');
    assert.ok(fake.get(CIRCUIT), 'the failure was recorded on the storyboard_gemini circuit');
    return { actual: 'hedge at once, slot released, circuit noted' };
  });

scenario('R3', 'a TRUNCATED leader answer is salvaged (complete panels kept) — one paid call, no further model',
  '200 with 5 panels; storyboard-gemini 1; no other engine; the (billed) slot stays counted', async () => {
    const full = panelsJson(6);
    providers.sbRaw.queue.push(full.slice(0, full.lastIndexOf('{"panel":6') + 25));   // cut inside panel 6
    const u = await makeUser('r3', 'free');
    const r = await open(u, '198.51.100.122');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 5);
    assert.equal(providers.counts['storyboard-gemini'], 1); assert.equal(providers.counts['openrouter-text'] ?? 0, 0);
    assert.equal(fake.num(SPEND), 1);
    return { actual: '5 salvaged panels, one call' };
  });

scenario('R4', 'too few complete panels (< 4) is NOT accepted: the hedge answers; the unparseable (billed) call stays counted and does not trip the circuit',
  'storyboard-gemini 1 + openrouter-text 1; 200 with 7 panels; usage = 1; circuit not open', async () => {
    const full = panelsJson(6);
    providers.sbRaw.queue.push(full.slice(0, full.indexOf('{"panel":3') + 20));       // only 2 complete panels
    const u = await makeUser('r4', 'free');
    const r = await open(u, '198.51.100.123');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 7);
    assert.equal(providers.counts['storyboard-gemini'], 1); assert.equal(providers.counts['openrouter-text'], 1);
    assert.equal(fake.num(SPEND), 1, 'billed answers stay counted');
    assert.equal(fake.get(CIRCUIT), null, 'a bad answer is not an outage');
    return { actual: 'fell through to the hedge' };
  });

scenario('R5', 'OpenRouter without json_schema support (404) → the SAME leader model is asked once more without the schema (data_collection deny kept), inside one attempt',
  'two calls to flash-lite: with response_format, then without; both deny; 200', async () => {
    providers.mode.orNoSchema = true;
    const u = await makeUser('r5', 'free');
    const r = await open(u, '198.51.100.124');
    assert.equal(r.status, 200);
    const calls = leaderBodies();
    assert.deepEqual(calls.map((b) => !!b.response_format), [true, false]);
    assert.ok(calls.every((b) => b.provider.data_collection === 'deny'));
    assert.equal(fake.num(SPEND), 1, 'one reservation per attempt, not per HTTP call');
    return { actual: 'schema then plain, deny kept' };
  });

scenario('R6', 'every engine failing → a clean JSON failure (500 STORYBOARD_FAIL) fast; the comic quota AND every paid slot are released',
  '500 STORYBOARD_FAIL; usage:comic 0; usage:storyboard:paid:global 0; < 5 s', async () => {
    for (const k of ['storyboard-gemini', 'openrouter-text', 'openrouter-free', 'gemini']) providers.mode[k] = 500;
    const u = await makeUser('r6', 'free');
    const t0 = Date.now();
    const r = await open(u, '198.51.100.125');
    assert.equal(r.status, 500); assert.equal(r.body.code, 'STORYBOARD_FAIL');
    assert.ok(Date.now() - t0 < 5000);
    assert.equal(fake.num(`usage:comic:${u.identifier}:${month()}`), 0, 'comic quota given back');
    assert.equal(fake.num(SPEND), 0, 'paid slots given back');
    return { actual: 'clean failure, nothing left reserved' };
  });

scenario('R7', 'DAILY_STORYBOARD_BUDGET spent (here 0 = off): the paid first engine is SKIPPED with zero paid calls — the hedge serves at once, never a failure',
  'storyboard-gemini 0; openrouter-text 1; 200; counter 0', async () => {
    const prev = process.env.DAILY_STORYBOARD_BUDGET;
    process.env.DAILY_STORYBOARD_BUDGET = '0';
    try {
      const u = await makeUser('r7', 'free');
      const t0 = Date.now();
      const r = await open(u, '198.51.100.126');
      assert.equal(r.status, 200);
      assert.equal(providers.counts['storyboard-gemini'] ?? 0, 0, 'no paid call without budget');
      assert.equal(providers.counts['openrouter-text'], 1);
      assert.ok(Date.now() - t0 < 3000, 'the hedge does not wait for the 4 s delay');
      assert.equal(fake.num(SPEND), 0);
    } finally {
      if (prev === undefined) delete process.env.DAILY_STORYBOARD_BUDGET; else process.env.DAILY_STORYBOARD_BUDGET = prev;
    }
    return { actual: 'skipped, hedge served' };
  });

scenario('R8', 'the budget is a real ceiling: with room for exactly 2 calls (budget 0.0024 at 0.0012 each) the 3rd comic skips the paid engine',
  'storyboard-gemini 2 across three comics; usage 2; the third is served by the hedge', async () => {
    const prev = process.env.DAILY_STORYBOARD_BUDGET;
    process.env.DAILY_STORYBOARD_BUDGET = '0.0024';
    try {
      const u = await makeUser('r8', 'pro');
      for (let i = 0; i < 3; i++) { const r = await open(u, '198.51.100.127'); assert.equal(r.status, 200, `comic ${i + 1}`); }
      assert.equal(providers.counts['storyboard-gemini'], 2);
      assert.equal(providers.counts['openrouter-text'], 1, 'the third comic was served by the hedge');
      assert.equal(fake.num(SPEND), 2);
    } finally {
      if (prev === undefined) delete process.env.DAILY_STORYBOARD_BUDGET; else process.env.DAILY_STORYBOARD_BUDGET = prev;
    }
    return { actual: 'cap respected' };
  });

scenario('R9', 'own circuit: a 429 from the paid engine opens ONLY `storyboard_gemini`; the next comic skips the paid call (no wasted attempt) and the hedge serves',
  'comic 1: leader 429 then hedge; comic 2: storyboard-gemini still 1; circuit open; check_gemini untouched', async () => {
    providers.mode['storyboard-gemini'] = 429;
    const u = await makeUser('r9', 'pro');
    const a = await open(u, '198.51.100.128'); assert.equal(a.status, 200);
    assert.equal(providers.counts['storyboard-gemini'], 1);
    assert.ok(fake.get(CIRCUIT), 'circuit open for the paid first engine');
    assert.equal(fake.get('circuit:img:check_gemini'), null, 'the output-check circuits are independent');
    const b = await open(u, '198.51.100.128'); assert.equal(b.status, 200);
    assert.equal(providers.counts['storyboard-gemini'], 1, 'open circuit: no second attempt');
    assert.equal(fake.num(SPEND), 0, 'failed calls were never billed');
    return { actual: 'circuit independent and effective' };
  });

scenario('R10', 'the DIRECT Google key (free tier) is the LAST fallback: it is called only after every OpenRouter engine failed',
  'order of calls: storyboard-gemini, gemma-27b, gemma-12b, deepseek, then gemini; 200', async () => {
    for (const k of ['storyboard-gemini', 'openrouter-text', 'openrouter-free']) providers.mode[k] = 500;
    const u = await makeUser('r10', 'free');
    const r = await open(u, '198.51.100.129');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 7);
    const order = providers.bodies.map((b) => (b.provider === 'gemini' ? 'direct-gemini' : b.provider === 'storyboard-gemini' ? 'leader' : b.body?.model)).filter((x) => ['leader', 'google/gemma-3-27b-it', 'google/gemma-3-12b-it', 'deepseek/deepseek-chat', 'direct-gemini'].includes(x));
    assert.deepEqual(order.slice(0, 4), ['leader', 'google/gemma-3-27b-it', 'google/gemma-3-12b-it', 'deepseek/deepseek-chat']);
    assert.equal(order[4], 'direct-gemini');
    assert.equal(providers.counts.gemini, 1);
    return { actual: order.join(' > ') };
  });
