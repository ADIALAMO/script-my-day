/**
 * Script privacy routes (lib/story-service.js Stage 0): paid Gemini 2.5 Flash through OpenRouter with provider.data_collection "deny", then ONLY
 * deny-capable OpenRouter fallbacks. The free Google key, Cohere and the free models are never contacted while DAILY_SCRIPT_BUDGET > 0.
 * Mock fetch, dummy keys, in-memory Redis, no network.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

Object.assign(process.env, { GOOGLE_GEMINI_API_KEY: 'dummy-g', OPENROUTER_API_KEY: 'dummy-or', OPENROUTER_FREE_KEY: 'dummy-free', COHERE_API_KEY: 'dummy-co' });
delete process.env.DAILY_SCRIPT_BUDGET;
const redis = createMemoryRedis();
global._redisClient = redis;
const { generateScript } = await import('../lib/story-service.js');
const { _resetScriptCircuitForTests } = await import('../lib/script-circuit.js');
const { globalCheckKey, checkMaxCalls } = await import('../lib/budget.js');

const GOOD = '**סצנה 1 - פנים - חדר - יום**\n' + 'היא יושבת ליד השולחן ומביטה בחלון. '.repeat(40) + '\n**סוף**\n[image: cinematic poster]';
const ENTRY = 'היום הלכתי לטייל עם הכלב בפארק ופגשתי חבר ותיק';
const realFetch = globalThis.fetch;
let behaviour, calls;

function installFetch() {
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    const body = opts.body ? JSON.parse(opts.body) : {};
    const key = u.includes('generativelanguage') ? 'google-direct' : u.includes('cohere') ? 'cohere' : (body.model === 'google/gemma-4-31b-it:free' ? 'free' : body.model);
    calls.push({ key, deny: body.provider?.data_collection === 'deny', auth: opts.headers?.Authorization });
    const b = behaviour[key] ?? { status: 500 };
    if (b.status === 200) return new Response(JSON.stringify({ choices: [{ message: { content: b.empty ? '' : GOOD }, finish_reason: b.finish || 'stop' }], usage: { prompt_tokens: 3100, completion_tokens: 1400 } }), { status: 200 });
    return new Response(JSON.stringify({ error: { message: 'x' } }), { status: b.status });
  };
}
beforeEach(() => {
  behaviour = {}; calls = [];
  redis._store.clear(); redis._expiries.clear();
  _resetScriptCircuitForTests();
  delete process.env.DAILY_SCRIPT_BUDGET;
  installFetch();
  console.warn = () => {}; console.log = () => {};
});
after(() => { globalThis.fetch = realFetch; });
const hosts = () => calls.map((c) => c.key);
const FORBIDDEN = ['google-direct', 'cohere', 'free'];

test('paid Gemini Flash serves first, with deny; nothing else is contacted; the trace carries tokens', async () => {
  behaviour['google/gemini-2.5-flash'] = { status: 200 };
  const r = await generateScript(ENTRY, 'comedy');
  assert.equal(r.success, true); assert.equal(r.stage, 'paid-gemini'); assert.equal(r.trace.paid, 'served');
  assert.deepEqual(r.trace.tokens, { in: 3100, out: 1400 });
  assert.deepEqual(hosts(), ['google/gemini-2.5-flash']); assert.ok(calls[0].deny);
  assert.equal(parseInt(await redis.get(globalCheckKey('script')), 10), 1);
});

test('a technical failure gives the budget slot back and falls to deny-only OpenRouter models (never the free key, Cohere, or the free models)', async () => {
  behaviour['google/gemini-2.5-flash'] = { status: 503 };
  behaviour['google/gemma-3-27b-it'] = { status: 200 };
  const r = await generateScript(ENTRY, 'comedy');
  assert.equal(r.success, true); assert.equal(r.stage, 'gemma'); assert.match(r.trace.paid, /failed:503/);
  assert.deepEqual(hosts(), ['google/gemini-2.5-flash', 'google/gemma-3-27b-it']);
  assert.ok(calls.every((c) => c.deny), 'every call carries deny');
  assert.equal(parseInt(await redis.get(globalCheckKey('script')), 10), 0, 'slot released');
});

test('budget spent: the paid call is skipped (not an error) and the fallbacks serve', async () => {
  await redis.set(globalCheckKey('script'), String(checkMaxCalls('script')));
  behaviour['google/gemma-3-27b-it'] = { status: 200 };
  const r = await generateScript(ENTRY, 'comedy');
  assert.equal(r.success, true); assert.equal(r.trace.paid, 'skipped:budget'); assert.equal(r.stage, 'gemma');
  assert.ok(!hosts().includes('google/gemini-2.5-flash'));
});

test('the paid circuit opens after a 429 and the next request skips the paid call', async () => {
  behaviour['google/gemini-2.5-flash'] = { status: 429 };
  behaviour['google/gemma-3-27b-it'] = { status: 200 };
  await generateScript(ENTRY, 'comedy');
  calls.length = 0;
  const r = await generateScript(ENTRY, 'comedy');
  assert.equal(r.trace.paid, 'skipped:circuit'); assert.ok(!hosts().includes('google/gemini-2.5-flash'));
});

test('everything fails: a clean failure, and still no contact with the free Google key, Cohere or the free models', async () => {
  const r = await generateScript(ENTRY, 'comedy');
  assert.equal(r.success, false);
  for (const f of FORBIDDEN) assert.ok(!hosts().includes(f), f);
  assert.ok(calls.every((c) => c.deny));
});

test('a content refusal from the paid engine ends the request without trying other providers', async () => {
  behaviour['google/gemini-2.5-flash'] = { status: 200, empty: true, finish: 'content_filter' };
  const r = await generateScript(ENTRY, 'comedy');
  assert.equal(r.success, false); assert.equal(r.refused, true);
  assert.deepEqual(hosts(), ['google/gemini-2.5-flash']);
});

test('DAILY_SCRIPT_BUDGET=0 restores the old cascade (free Google key first, no deny)', async () => {
  process.env.DAILY_SCRIPT_BUDGET = '0';
  behaviour['gemini-2.5-flash'] = { status: 200 };
  globalThis.fetch = async (url, opts) => {
    calls.push({ key: String(url).includes('generativelanguage') ? 'google-direct' : 'other' });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: GOOD }] } }] }), { status: 200 });
  };
  const r = await generateScript(ENTRY, 'comedy');
  assert.equal(r.success, true); assert.equal(r.trace.paid, 'off'); assert.match(r.stage, /^gemini-/);
  assert.equal(calls[0].key, 'google-direct');
});

test('stage stats: one hash per day with the stage, the paid outcome and token totals — counts only', async () => {
  const { recordScriptStage, readScriptStages, stageOf, STAGE_KEY_PREFIX } = await import('../lib/script-stats.js');
  const h = new Map();
  const client = {
    pipeline() { const ops = []; return { hincrby: (k, f, n) => { ops.push(() => { const m = h.get(k) ?? new Map(); m.set(f, (Number(m.get(f)) || 0) + n); h.set(k, m); }); }, expire: () => {}, exec: async () => ops.forEach((o) => o()) }; },
    async hgetall(k) { return h.has(k) ? Object.fromEntries(h.get(k)) : null; },
  };
  await recordScriptStage({ success: true, stage: 'paid-gemini', trace: { paid: 'served', tokens: { in: 3000, out: 1000 } } }, client);
  await recordScriptStage({ success: true, stage: 'gemma', trace: { paid: 'skipped:budget', tokens: null } }, client);
  await recordScriptStage({ success: false, trace: { paid: 'failed:503' } }, client);
  await recordScriptStage({ success: false, refused: true, trace: { paid: 'refused' } }, client);
  const [today] = await readScriptStages(1, client);
  assert.deepEqual(today.counts, { 'paid-gemini': 1, 'paid:served': 1, paid_in: 3000, paid_out: 1000, gemma: 1, 'paid:skipped:budget': 1, failed: 1, 'paid:failed:503': 1, refused: 1, 'paid:refused': 1 });
  assert.equal(stageOf({ success: true }), 'unknown');
  assert.ok(STAGE_KEY_PREFIX.startsWith('stats:script:stage:'));
  const broken = { pipeline() { throw new Error('down'); } };
  await assert.doesNotReject(recordScriptStage({ success: true, stage: 'x' }, broken));
});
