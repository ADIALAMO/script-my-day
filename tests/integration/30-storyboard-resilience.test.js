/** Scenario R: the storyboard engine cascade — Gemini leads, OpenRouter hedges, structured output, truncation salvage, clean failure. */
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

scenario('R1', 'Gemini leads the storyboard cascade with JSON mode + responseSchema + thinking off; OpenRouter is not called when Gemini answers',
  'gemini 1; openrouter-text 0; generationConfig carries responseSchema (ARRAY of 5 fields), thinkingBudget 0, 2000 tokens', async () => {
    const u = await makeUser('r1', 'free');
    const r = await open(u, '198.51.100.120');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 7);
    assert.equal(providers.counts.gemini, 1); assert.equal(providers.counts['openrouter-text'] ?? 0, 0);
    const cfg = providers.bodies.find((b) => b.provider === 'gemini').body.generationConfig;
    assert.equal(cfg.responseMimeType, 'application/json'); assert.equal(cfg.thinkingConfig.thinkingBudget, 0); assert.equal(cfg.maxOutputTokens, 2000);
    assert.equal(cfg.responseSchema.type, 'ARRAY'); assert.deepEqual(cfg.responseSchema.items.required, ['panel', 'scene', 'visual', 'dialogue', 'hero']);
    return { actual: 'gemini only, structured' };
  });

scenario('R2', 'Gemini failing → the OpenRouter hedge starts AT ONCE (not after 4 s) with a strict json_schema {panels:[...]} wrapper, require_parameters and 2000 tokens; the wrapper answer is parsed',
  '200; openrouter-text 1; response_format.json_schema.name storyboard; provider.require_parameters; max_tokens 2000', async () => {
    providers.mode.gemini = 500;
    providers.sbRaw.queue.push(JSON.stringify({ panels: JSON.parse(panelsJson(6)) }));
    const u = await makeUser('r2', 'free');
    const t0 = Date.now();
    const r = await open(u, '198.51.100.121');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 6);
    assert.ok(Date.now() - t0 < 3000, 'a failed leader never makes the hedge wait');
    const or = providers.bodies.find((b) => b.body?.model === 'google/gemma-3-27b-it').body;
    assert.equal(or.max_tokens, 2000); assert.equal(or.provider.require_parameters, true);
    assert.equal(or.response_format.type, 'json_schema'); assert.equal(or.response_format.json_schema.name, 'storyboard'); assert.equal(or.response_format.json_schema.strict, true);
    assert.equal(or.response_format.json_schema.schema.type, 'object');
    return { actual: 'hedge with schema, wrapper parsed' };
  });

scenario('R3', 'a TRUNCATED Gemini answer is salvaged (complete panels kept) instead of costing another model call',
  '200 with the complete panels; no OpenRouter call', async () => {
    const full = panelsJson(6);
    providers.sbRaw.queue.push(full.slice(0, full.lastIndexOf('{"panel":6') + 25));   // cut inside panel 6
    const u = await makeUser('r3', 'free');
    const r = await open(u, '198.51.100.122');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 5);
    assert.equal(providers.counts.gemini, 1); assert.equal(providers.counts['openrouter-text'] ?? 0, 0);
    return { actual: '5 salvaged panels, one call' };
  });

scenario('R4', 'too few complete panels (< 4) is NOT accepted: the next engine is tried',
  '2 gemini calls (flash, then flash-lite) or an OpenRouter call; final 200', async () => {
    const full = panelsJson(6);
    providers.sbRaw.queue.push(full.slice(0, full.indexOf('{"panel":3') + 20));       // only 2 complete panels
    const u = await makeUser('r4', 'free');
    const r = await open(u, '198.51.100.123');
    assert.equal(r.status, 200); assert.equal(r.body.panels.length, 7);
    assert.ok(providers.counts.gemini + (providers.counts['openrouter-text'] ?? 0) >= 2, 'a second engine answered');
    return { actual: 'fell through to the next engine' };
  });

scenario('R5', 'OpenRouter without json_schema support (404) → the SAME model is asked once more without the schema, inside one attempt',
  'two calls to gemma-3-27b: the first with response_format, the second without; 200', async () => {
    providers.mode.gemini = 500; providers.mode.orNoSchema = true;
    const u = await makeUser('r5', 'free');
    const r = await open(u, '198.51.100.124');
    assert.equal(r.status, 200);
    const calls = providers.bodies.filter((b) => b.body?.model === 'google/gemma-3-27b-it').map((b) => !!b.body.response_format);
    assert.deepEqual(calls, [true, false]);
    return { actual: 'schema then plain' };
  });

scenario('R6', 'every engine failing → a clean JSON failure (500 STORYBOARD_FAIL) fast, and the comic quota is RELEASED',
  '500 STORYBOARD_FAIL; usage:comic back to 0; answered in < 5 s', async () => {
    providers.mode.gemini = 500; providers.mode['openrouter-text'] = 500; providers.mode['openrouter-free'] = 500;
    const u = await makeUser('r6', 'free');
    const t0 = Date.now();
    const r = await open(u, '198.51.100.125');
    assert.equal(r.status, 500); assert.equal(r.body.code, 'STORYBOARD_FAIL');
    assert.ok(Date.now() - t0 < 5000);
    assert.equal(fake.num(`usage:comic:${u.identifier}:${month()}`), 0, 'quota given back');
    return { actual: 'clean failure, quota released' };
  });
