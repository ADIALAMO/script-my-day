/**
 * Script cascade resilience (lib/story-service.js + lib/script-circuit.js + lib/script-alerts.js).
 * Mock fetch + virtual clock (tests/helpers/virtual-clock.js): production timeouts, no scaling, no real waiting,
 * NO network, dummy keys, in-memory Redis.
 */
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';
import { installVirtualClock } from './helpers/virtual-clock.js';

const SECRET_GEMINI = 'dummy-gemini-key-AAA111';
const SECRET_OR = 'dummy-openrouter-key-BBB222';
const SECRET_FREE = 'dummy-free-key-CCC333';
const SECRET_COHERE = 'dummy-cohere-key-DDD444';
const SECRET_TG = 'dummy-telegram-token-EEE555';
Object.assign(process.env, { DAILY_SCRIPT_BUDGET: '0', GOOGLE_GEMINI_API_KEY: SECRET_GEMINI, OPENROUTER_API_KEY: SECRET_OR, COHERE_API_KEY: SECRET_COHERE, TELEGRAM_BOT_TOKEN: SECRET_TG, TELEGRAM_CHAT_ID: '1' });
delete process.env.OPENROUTER_FREE_KEY; // first test checks the "unset key" log; later tests set it

const redis = createMemoryRedis();
global._redisClient = redis;
const { generateScript } = await import('../lib/story-service.js');
const { loadScriptCircuit, _resetScriptCircuitForTests, classify429, msUntilPacificMidnight } = await import('../lib/script-circuit.js');
const { SCRIPT_GEMINI, SCRIPT_CASCADE } = await import('../config/limits.js');

const ENTRY = 'היום הלכתי לעבודה והרגשתי שונה מכל יום אחר ואני רוצה לספר על זה';
const GOOD = 'סצנה 1 - פנים. חדר - יום\n' + 'הוא יושב ליד השולחן ומביט בחלון. '.repeat(40) + '\nסוף\n[image: cinematic poster]';
const G = ['gemini-2.5-flash', 'gemini-3-flash-preview', 'gemini-3.1-flash-lite-preview', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
const ALL = [...G, 'google/gemma-3-27b-it', 'google/gemma-3-12b-it', 'cohere', 'deepseek/deepseek-chat', 'google/gemma-4-31b-it:free'];
const R429 = { status: 429, ms: 150 };
const HANG = { status: 'hang' };
const OK = (ms) => ({ status: 200, ms });
const allWith = (spec, over = {}) => ({ ...Object.fromEntries(ALL.map((k) => [k, spec])), ...over });

let clock, behaviour, calls, telegram, warns;
const realFetch = globalThis.fetch;
const realWarn = console.warn, realLog = console.log;

function installFetch() {
  globalThis.fetch = (url, opts = {}) => new Promise((resolve, reject) => {
    if (String(url).includes('api.telegram.org')) { telegram.push(JSON.parse(opts.body).text); return resolve(new Response('{}', { status: 200 })); }
    const body = opts.body ? JSON.parse(opts.body) : {};
    const gm = /models\/([^:]+):generateContent/.exec(url);
    const key = gm ? gm[1] : String(url).includes('cohere') ? 'cohere' : body.model;
    const b = behaviour[key] ?? { status: 500, ms: 100 };
    calls.push({ key, at: clock.now() });
    const sig = opts.signal;
    const abortErr = () => Object.assign(new Error('aborted'), { name: 'AbortError' });
    if (sig?.aborted) return reject(abortErr());
    let t;
    sig?.addEventListener('abort', () => { if (t) t.dead = true; reject(abortErr()); }, { once: true });
    if (b.status === 'hang') return;
    t = setTimeout(() => {
      const okBody = gm ? { candidates: [{ content: { parts: [{ text: GOOD }] } }] } : key === 'cohere' ? { text: GOOD } : { choices: [{ message: { content: GOOD } }] };
      resolve(new Response(b.status === 200 ? JSON.stringify(okBody) : (b.body ?? JSON.stringify({ error: { message: 'x' }, message: 'x' })), { status: b.status }));
    }, b.ms);
  });
}

beforeEach(() => {
  clock?.restore();
  clock = installVirtualClock();
  behaviour = {}; calls = []; telegram = []; warns = [];
  redis._store.clear(); redis._expiries.clear();
  _resetScriptCircuitForTests();
  process.env.OPENROUTER_FREE_KEY = SECRET_FREE;
  process.env.NODE_ENV = 'test';
  installFetch();
  console.warn = (...a) => { warns.push(a.join(' ')); };
  console.log = () => {};
});
after(() => { clock?.restore(); globalThis.fetch = realFetch; console.warn = realWarn; console.log = realLog; });

// The in-memory Redis records expiries but does not enforce them; real Redis deletes the key when its TTL ends.
const advance = (ms) => { clock.advance(ms); const nowSec = Math.floor(Date.now() / 1000); for (const [k, at] of redis._expiries) if (at <= nowSec) { redis._store.delete(k); redis._expiries.delete(k); } };
const ttlOf = (key) => redis._expiries.get(key) - Math.floor(Date.now() / 1000);
const run = () => clock.run(generateScript(ENTRY, 'drama', 'neutral'));
const callsTo = (k) => calls.filter((c) => c.key === k).length;

// ─── (g) unset optional keys: names only ─────────────────────────────────────────────
test('(g) unset optional keys are logged once, by NAME only, never by value', async () => {
  delete process.env.OPENROUTER_FREE_KEY;
  behaviour = allWith(OK(100));
  await run();
  const line = warns.find((w) => w.includes('not set'));
  assert.ok(line, 'a warning names the unset key');
  assert.match(line, /OPENROUTER_FREE_KEY not set → Stage 5/);
  for (const v of [SECRET_GEMINI, SECRET_OR, SECRET_COHERE, SECRET_FREE]) assert.ok(!warns.join('\n').includes(v), 'no key value is ever logged');
  warns.length = 0;
  await run();
  assert.ok(!warns.some((w) => w.includes('not set')), 'logged only once per instance');
});

// ─── (c) circuit breaker ─────────────────────────────────────────────────────────────
test('(c) after a 429 the next request does NOT call the paused model; it is tried again after the pause and a success clears it', async () => {
  behaviour = allWith(OK(500), { 'gemini-2.5-flash': R429 });
  await run();
  assert.equal(callsTo('gemini-2.5-flash'), 1);
  assert.ok(redis._store.has('circuit:script:gemini-2.5-flash'), 'Redis key circuit:script:<model>');
  assert.ok(ttlOf('circuit:script:gemini-2.5-flash') >= 55 && ttlOf('circuit:script:gemini-2.5-flash') <= 60, 'per-minute pause = 60 s TTL');

  calls.length = 0; advance(10_000);
  const r2 = await run();
  assert.equal(callsTo('gemini-2.5-flash'), 0, 'paused model is skipped');
  assert.ok(r2.success);

  calls.length = 0; advance(61_000);
  behaviour['gemini-2.5-flash'] = OK(500);
  await run();
  assert.equal(callsTo('gemini-2.5-flash'), 1, 'tried again once the pause is over');
  assert.ok(!redis._store.has('circuit:script:strikes:gemini-2.5-flash'));
});

test('(c) a 429 on the first call after the pause (no success between) escalates to the long pause', async () => {
  behaviour = allWith(OK(500), { 'gemini-2.5-flash': R429 });
  await run();                       // 1st 429 → 60 s
  advance(61_000);
  await run();                       // trial after the pause: 429 again → 15 min
  assert.ok(ttlOf('circuit:script:gemini-2.5-flash') >= 895 && ttlOf('circuit:script:gemini-2.5-flash') <= 900, 'escalated pause = 15 min');
  calls.length = 0; advance(300_000);
  await run();
  assert.equal(callsTo('gemini-2.5-flash'), 0, 'still paused 5 minutes later');
});

test('(c) concurrent requests that all saw the same 429 count ONE strike, not several (SET NX)', async () => {
  const a = await loadScriptCircuit(ALL), b = await loadScriptCircuit(ALL), c = await loadScriptCircuit(ALL);
  // each handle stands for a different serverless instance (own memory); the Redis SET NX decides who writes/counts
  for (const h of [a, b, c]) { h.recordFailure('gemini-2.5-flash', { status: 429, escalate: true }); _resetScriptCircuitForTests(); }
  for (const h of [a, b, c]) await h.flush();
  assert.equal(redis._store.get('circuit:script:strikes:gemini-2.5-flash'), '1');
});

test('(c) only HTTP 429 opens the circuit: 500, timeout and empty answers do not', async () => {
  behaviour = allWith(OK(500), { 'gemini-2.5-flash': { status: 500, ms: 100 }, 'gemini-3-flash-preview': HANG });
  await run();
  const keys = [...redis._store.keys()].filter((k) => k.startsWith('circuit:script:'));
  assert.deepEqual(keys, []);
  calls.length = 0; await run();
  assert.equal(callsTo('gemini-2.5-flash'), 1, 'asked again');
});

test('(c) OpenRouter/Cohere 429s get the flat short pause and never escalate', async () => {
  behaviour = allWith(R429, { 'google/gemma-4-31b-it:free': OK(500) });
  await run(); advance(61_000); await run();
  assert.equal(redis._store.has('circuit:script:strikes:google/gemma-3-27b-it'), false);
  assert.ok(ttlOf('circuit:script:google/gemma-3-27b-it') >= 55 && ttlOf('circuit:script:google/gemma-3-27b-it') <= 60);
});

test('(c) 429 classification is conservative: day only when the body clearly says PerDay (and not PerMinute)', () => {
  assert.equal(classify429('You exceeded your current quota, please check your plan and billing details.'), 'unknown');
  assert.equal(classify429(''), 'unknown');
  assert.equal(classify429(undefined), 'unknown');
  assert.equal(classify429('{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}'), 'minute');
  assert.equal(classify429('{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}'), 'day');
  assert.equal(classify429('PerDay ... PerMinute'), 'minute');
});

test('(c) a day-quota 429 pauses until the next Pacific midnight (≤ 24 h), not UTC midnight', async () => {
  const body = JSON.stringify({ error: { message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
  behaviour = allWith(OK(500), { 'gemini-2.5-flash': { status: 429, ms: 150, body } });
  await run();
  const ttl = ttlOf('circuit:script:gemini-2.5-flash');
  const expected = Math.ceil(msUntilPacificMidnight(Date.parse('2026-10-11T12:00:00Z')) / 1000);
  assert.ok(ttl <= expected && ttl >= expected - 5, `ttl ${ttl}s ≈ ${expected}s to Pacific midnight`);
  assert.ok(ttl > 60 && ttl <= 86_400);
  assert.equal(msUntilPacificMidnight(Date.parse('2026-10-11T07:00:00Z')), 86_400_000, 'exactly Pacific midnight (PDT) → capped at 24 h');
  assert.equal(msUntilPacificMidnight(Date.parse('2026-10-11T06:59:30Z')), 60_000 > 30_000 ? 60_000 : 30_000, 'never less than one minute');
  assert.equal(redis._store.has('circuit:script:strikes:gemini-2.5-flash'), false, 'a day pause is not a strike');
});

test('(c) Redis down: cascade unaffected, per-instance memory still skips the paused model; Redis slower than 500 ms is cut off', async () => {
  const orig = { mget: redis.mget, set: redis.set };
  try {
    redis.mget = async () => { throw new Error('Redis unavailable'); };
    redis.set = async () => { throw new Error('Redis unavailable'); };
    behaviour = allWith(OK(500), { 'gemini-2.5-flash': R429 });
    const r1 = await run();
    assert.ok(r1.success);
    calls.length = 0;
    await run();
    assert.equal(callsTo('gemini-2.5-flash'), 0, 'in-process fallback');

    _resetScriptCircuitForTests();
    redis.mget = () => new Promise((res) => setTimeout(() => res([]), 5000)); // hangs far beyond the cap
    const t0 = clock.now();
    const handle = await clock.run(loadScriptCircuit(ALL));
    assert.equal(clock.now() - t0, 500, 'the read is capped at 500 ms');
    assert.equal(handle.isOpen('gemini-2.5-flash'), false, 'fail-open');
  } finally { Object.assign(redis, orig); }
});

// ─── (a)(b) deadline, reserve, caps ──────────────────────────────────────────────────
test('(a) defaults: 50 s total, 8 s Stage-1 reserve, hedge still fires at ≥27 s', () => {
  assert.equal(SCRIPT_GEMINI.totalBudgetMs, 50000);
  assert.equal(SCRIPT_GEMINI.stage1ReserveMs, 8000);
  assert.equal(SCRIPT_GEMINI.qualityBudgetMs, 42000);
  assert.equal(SCRIPT_GEMINI.qualityHedgeMs, 27000);
  assert.ok(SCRIPT_GEMINI.qualityBudgetMs - SCRIPT_GEMINI.qualityHedgeMs >= SCRIPT_GEMINI.minStartBudgetMs);
});

test('(a) everything hangs: the whole cascade ends at ≤ 50 s with SCRIPT_FAIL-style result, never past the budget', async () => {
  behaviour = allWith(HANG);
  const r = await run();
  assert.equal(r.success, false);
  assert.ok(clock.now() <= 50_000 + 500, `ended at ${clock.now()} ms`);
});

test('(a) Gemini HANGS: Stage 1 stops 8 s early, and the cheap free model (Stage 5) still gets its turn and wins', async () => {
  behaviour = allWith(HANG, { 'google/gemma-4-31b-it:free': OK(1000) });
  const r = await run();
  assert.equal(r.success, true);
  assert.match(r.model, /gemma-4-31b/);
  assert.ok(clock.now() <= 50_000, `served at ${clock.now()} ms`);
  const lastGemini = Math.max(...calls.filter((c) => c.key.startsWith('gemini')).map((c) => c.at));
  assert.ok(lastGemini < 50_000 - SCRIPT_GEMINI.stage1ReserveMs, 'no Gemini call starts inside the reserve');
});

test('(b) Gemma-27b answering in 16.5 s is no longer discarded', async () => {
  behaviour = allWith(R429, { 'google/gemma-3-27b-it': OK(16_500) });
  const r = await run();
  assert.equal(r.success, true);
  assert.equal(r.model, 'google/gemma-3-27b-it');
  assert.ok(clock.now() >= 16_500 && clock.now() < 20_000);
});

test('(b) Stages 2–4 hang: the last-resort reserve keeps time for Stage 5, order unchanged', async () => {
  behaviour = allWith(R429, { 'google/gemma-3-27b-it': HANG, 'google/gemma-3-12b-it': HANG, cohere: HANG, 'deepseek/deepseek-chat': HANG, 'google/gemma-4-31b-it:free': OK(1000) });
  const r = await run();
  assert.equal(r.success, true);
  assert.match(r.model, /gemma-4-31b/);
  const order = []; for (const c of calls) if (order[order.length - 1] !== c.key) order.push(c.key);
  const idx = (k) => order.indexOf(k);
  assert.ok(idx('google/gemma-3-27b-it') < idx('google/gemma-3-12b-it') && idx('google/gemma-3-12b-it') < idx('cohere') && idx('cohere') < idx('google/gemma-4-31b-it:free'), order.join(' → '));
  // Consequence of the larger caps: when 27b, 12b and Cohere all hang to their caps, DeepSeek has no time left that is not
  // reserved for Stage 5 — it is skipped (it used to run, because the old caps were 10/10/8 s).
  assert.equal(idx('deepseek/deepseek-chat'), -1, 'DeepSeek is skipped, Stage 5 is not starved');
  assert.ok(clock.now() <= 50_000);
});

test('(b) per-call caps: configured defaults', () => {
  assert.deepEqual({ ...SCRIPT_CASCADE }, { gemma27bMs: 20000, gemma12bMs: 12000, cohereMs: 10000, deepseekMs: 12000, freeMs: 12000, lastResortReserveMs: 6000 });
});

// ─── (f) no dead sleep ───────────────────────────────────────────────────────────────
test('(f) a 429 in Stage 2 moves on immediately (no fixed 1.5 s sleep)', async () => {
  behaviour = allWith(R429, { 'google/gemma-3-12b-it': OK(300) });
  const r = await run();
  assert.equal(r.model, 'google/gemma-3-12b-it');
  const at = (k) => calls.find((c) => c.key === k).at;
  assert.equal(at('google/gemma-3-12b-it') - at('google/gemma-3-27b-it'), 150, '12b starts right after 27b answered 429');
});

// ─── order of stages / models unchanged ──────────────────────────────────────────────
test('stage and model order is unchanged (first request, everything failing fast)', async () => {
  behaviour = allWith({ status: 500, ms: 100 });
  const r = await run();
  assert.equal(r.success, false);
  const order = []; for (const c of calls) if (!order.includes(c.key)) order.push(c.key);
  assert.deepEqual(order, ALL);
});

// ─── (d) alerts ──────────────────────────────────────────────────────────────────────
test('(d) Gemini 429 → one deduped Telegram alert (production only), fixed text, no secrets', async () => {
  process.env.NODE_ENV = 'production';
  behaviour = allWith(OK(500), { 'gemini-2.5-flash': R429, 'gemini-3-flash-preview': R429 });
  await run();
  assert.equal(telegram.length, 1, `two models 429 in one request → ONE alert (got ${telegram.length})`);
  assert.match(telegram[0], /Gemini .*HTTP 429 \(classification: unknown\)/, 'plain-message 429 → unknown (still the per-minute pause)');
  _resetScriptCircuitForTests(); advance(120_000);
  await run();
  assert.equal(telegram.length, 1, 'still deduped inside the 30-minute window (Redis SET NX)');
  for (const v of [SECRET_GEMINI, SECRET_OR, SECRET_COHERE, SECRET_FREE, SECRET_TG]) assert.ok(!telegram.join('\n').includes(v));
});

test('(d) alerts are not sent outside production', async () => {
  behaviour = allWith(R429);
  await run();
  assert.equal(telegram.length, 0);
});

test('(d) whole cascade failing → one deduped SCRIPT_FAIL alert', async () => {
  process.env.NODE_ENV = 'production';
  behaviour = allWith({ status: 500, ms: 100 });
  await run(); await run();
  assert.equal(telegram.filter((t) => /ALL stages/.test(t)).length, 1);
});

// ─── (e) client ──────────────────────────────────────────────────────────────────────
test('(e) the client surfaces the server CODE so SCRIPT_FAIL reaches getMsg, which has he+en copy and is retryable', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8');
  assert.match(src, /throw new Error\(data\.code \|\| data\.message/);
  const { getMsg, CODES, isRetryableError } = await import('../lib/messages.js');
  assert.match(getMsg(CODES.SCRIPT_FAIL, 'he'), /[א-ת]/);
  assert.match(getMsg(CODES.SCRIPT_FAIL, 'en'), /snag/);
  assert.equal(isRetryableError(CODES.SCRIPT_FAIL), true);
});

// ─── Stage 5 list ────────────────────────────────────────────────────────────────────
test('Stage 5 contains only the free model that exists (gemma-4-31b:free); the dead llama/qwen ":free" slugs are gone', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../lib/story-service.js', import.meta.url), 'utf8');
  const list = /const FREE_MODELS = \[([\s\S]*?)\];/.exec(src)[1];
  assert.deepEqual([...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]), ['google/gemma-4-31b-it:free']);
  behaviour = allWith({ status: 404, ms: 100 });
  await run();
  assert.equal(callsTo('google/gemma-4-31b-it:free'), 1);
  assert.equal(callsTo('meta-llama/llama-3.3-70b-instruct:free') + callsTo('qwen/qwen3-next-80b-a3b-instruct:free'), 0, 'no call to the removed slugs');
});

test('Stage 5 timing: a 12 s cap, cut to what is left; a hanging free model ends the cascade at the 50 s budget', async () => {
  behaviour = allWith(HANG);
  const r = await run();
  assert.equal(r.success, false);
  const free = calls.find((c) => c.key === 'google/gemma-4-31b-it:free');
  assert.ok(free && free.at >= 40_000 && free.at <= 44_000, `Stage 5 starts at ${free?.at} ms`);
  assert.ok(clock.now() <= 50_000 + 500, `ended at ${clock.now()} ms`);
});

test('(d) alert text carries only the fixed classification label (minute | day | unknown), nothing request-specific', async () => {
  process.env.NODE_ENV = 'production';
  const body = JSON.stringify({ error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } });
  behaviour = allWith(OK(500), { 'gemini-2.5-flash': { status: 429, ms: 150, body } });
  await run();
  assert.equal(telegram.length, 1);
  assert.match(telegram[0], /daily.*classification: day/);
  _resetScriptCircuitForTests(); redis._store.clear();
  const minuteBody = JSON.stringify({ error: { details: [{ violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }] } });
  behaviour = allWith(OK(500), { 'gemini-2.5-flash': { status: 429, ms: 150, body: minuteBody } });
  await run();
  assert.match(telegram[1], /classification: minute\)/);
  for (const t of telegram) assert.ok(!t.includes(ENTRY) && !/dummy-/.test(t));
});
