import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ENGINE_DEADLINE_MS, ATTEMPT_CAP_MS, MIN_ATTEMPT_MS, HEDGE_DELAY_MS, ROUTE_HARD_MS, attemptTimeout, raceWithHedge, runUntilDeadline } = await import('../lib/storyboard-engines.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const task = (ms, result, log, name) => ({ delayMs: 0, run: async () => { log?.push(`start:${name}`); await sleep(ms); return result; } });

test('budget constants: engines end well before the 60 s function limit, an attempt is capped at 12 s, the hard line is under 55 s', () => {
  assert.ok(ENGINE_DEADLINE_MS >= 35000 && ENGINE_DEADLINE_MS <= 40000);
  assert.equal(ATTEMPT_CAP_MS, 12000);
  assert.ok(MIN_ATTEMPT_MS >= 2000);
  assert.equal(HEDGE_DELAY_MS, 4000);
  assert.ok(ROUTE_HARD_MS <= 55000);
});

test('attemptTimeout = min(12 s, time left); nothing starts with too little time left', () => {
  const now = 1_000_000;
  assert.equal(attemptTimeout(now + 38000, now), 12000);
  assert.equal(attemptTimeout(now + 9000, now), 9000);
  assert.equal(attemptTimeout(now + 3000, now), 3000);
  assert.equal(attemptTimeout(now + 2999, now), 0);
  assert.equal(attemptTimeout(now - 5, now), 0);
  assert.equal(attemptTimeout(now + 30000, now, { cap: 5000 }), 5000);
});

test('raceWithHedge: the leader wins when it answers first; the hedge never starts', async () => {
  const log = [];
  const r = await raceWithHedge([task(5, 'gemini', log, 'g'), { ...task(5, 'or', log, 'o'), delayMs: 200 }]);
  assert.equal(r, 'gemini');
  await sleep(250);
  assert.deepEqual(log, ['start:g']);
});

test('raceWithHedge: a FAILED leader brings the hedge in at once (does not wait for the hedge delay)', async () => {
  const log = [];
  const t0 = Date.now();
  const r = await raceWithHedge([task(5, null, log, 'g'), { ...task(5, 'or', log, 'o'), delayMs: 4000 }]);
  assert.equal(r, 'or');
  assert.ok(Date.now() - t0 < 500, `took ${Date.now() - t0} ms`);
  assert.deepEqual(log, ['start:g', 'start:o']);
});

test('raceWithHedge: a SLOW leader gets the hedge after the delay; the first non-null answer wins', async () => {
  const r = await raceWithHedge([task(400, 'slow-leader', null, 'g'), { ...task(10, 'hedge', null, 'o'), delayMs: 50 }]);
  assert.equal(r, 'hedge');
});

test('raceWithHedge: all failing -> null; a throwing task counts as a failure; no tasks -> null', async () => {
  assert.equal(await raceWithHedge([task(1, null), { ...task(1, null), delayMs: 10 }]), null);
  assert.equal(await raceWithHedge([{ delayMs: 0, run: async () => { throw new Error('boom'); } }, { delayMs: 10, run: async () => 'ok' }]), 'ok');
  assert.equal(await raceWithHedge([]), null);
});

test('raceWithHedge: a late answer from the loser is ignored; the winner is returned once', async () => {
  let calls = 0;
  const r = await raceWithHedge([task(30, 'a'), { ...task(5, 'b'), delayMs: 5 }].map((t) => ({ ...t, run: async () => { calls += 1; return t.run(); } })));
  assert.equal(r, 'b'); assert.equal(calls, 2);
});

test('runUntilDeadline: first success wins; each attempt gets min(cap, left); stops when time is up', async () => {
  const seen = [];
  const now = 1_000_000;
  const clock = { t: now };
  const attempts = [
    async (t) => { seen.push(t); clock.t += 15000; return null; },     // burns 15 s (fails)
    async (t) => { seen.push(t); clock.t += 15000; return null; },
    async (t) => { seen.push(t); clock.t += 15000; return null; },     // 3rd: 38 - 30 = 8 s left -> gets 8000
    async (t) => { seen.push(t); return 'never'; },
  ];
  const r = await runUntilDeadline(attempts, now + 38000, () => clock.t);
  assert.equal(r, null);
  assert.deepEqual(seen, [12000, 12000, 8000]);                         // 38 s deadline: 12 s, 12 s, then only 8 s are left; the 4th never starts
});

test('runUntilDeadline: returns the first non-null; a throwing attempt is a failure', async () => {
  const r = await runUntilDeadline([async () => { throw new Error('x'); }, async () => null, async () => 'win', async () => 'later'], Date.now() + 38000);
  assert.equal(r, 'win');
});

const { checkMaxCalls, checkBudgetUsd, globalCheckKey } = await import('../lib/budget.js');
const { PROVIDERS } = await import('../lib/circuit-breaker.js');

test('the paid first engine has its OWN budget (DAILY_STORYBOARD_BUDGET, default $1.00, 0 = off) and its OWN circuit key — not shared with any check', () => {
  const prev = { b: process.env.DAILY_STORYBOARD_BUDGET, c: process.env.STORYBOARD_COST_USD };
  delete process.env.DAILY_STORYBOARD_BUDGET; delete process.env.STORYBOARD_COST_USD;
  try {
    assert.equal(checkBudgetUsd('storyboard'), 1);
    assert.equal(checkMaxCalls('storyboard'), 833);                       // floor(1.00 / 0.0012)
    process.env.DAILY_STORYBOARD_BUDGET = '0';
    assert.equal(checkMaxCalls('storyboard'), 0);                         // 0 = the paid first engine is off
    process.env.DAILY_STORYBOARD_BUDGET = '0.0024';
    assert.equal(checkMaxCalls('storyboard'), 2);
    process.env.DAILY_STORYBOARD_BUDGET = 'garbage';
    assert.equal(checkBudgetUsd('storyboard'), 1);                        // unreadable -> the default, never "unlimited"
  } finally {
    for (const [k, v] of [['DAILY_STORYBOARD_BUDGET', prev.b], ['STORYBOARD_COST_USD', prev.c]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
  const keys = ['image', 'text', 'minor', 'imgsafety', 'storyboard'].map((p) => globalCheckKey(p));
  assert.equal(new Set(keys).size, 5, 'five independent counters');
  assert.match(globalCheckKey('storyboard'), /^usage:storyboard:paid:global:\d{4}-\d{2}-\d{2}$/);
  assert.ok(PROVIDERS.includes('storyboard_gemini'));
});

test('the route wires it: OpenRouter Gemini Flash-Lite leads (deny, schema, budget, circuit), gemma hedges, direct Google is LAST, deadline + clean failure with quota release, logs without prompts', () => {
  const src = readFileSync(path.join(ROOT, 'pages/api/generate-storyboard.js'), 'utf8');
  assert.match(src, /raceWithHedge\(race\)/);
  assert.match(src, /PRIMARY_MODEL = process\.env\.STORYBOARD_PRIMARY_MODEL\?\.trim\(\) \|\| 'google\/gemini-2\.5-flash-lite'/);
  assert.match(src, /PRIMARY_PROVIDER = \{ data_collection: 'deny' \}/);
  assert.match(src, /runPrimaryPaid\(instruction, cleanScript, openrouterKey, t\)/);
  assert.match(src, /reserveCheckBudget\('storyboard'\)/);
  assert.match(src, /releaseCheckBudget\('storyboard'\)/);
  assert.match(src, /PRIMARY_CIRCUIT = 'storyboard_gemini'/);
  // order inside runEngines: leader, hedge, gemma-12b/deepseek, free net, THEN the direct Google key
  const run = src.slice(src.indexOf('const runEngines'), src.indexOf('let { panelsOut: enrichedPanels'));
  const at = (re) => run.search(re);
  assert.ok(at(/runPrimaryPaid/) < at(/gemma-3-27b-it/));
  assert.ok(at(/gemma-3-27b-it/) < at(/gemma-3-12b-it/));
  assert.ok(at(/FREE_STORYBOARD_MODELS/) < at(/runGeminiModel\('gemini-2\.5-flash'/));
  assert.ok(at(/runGeminiModel\('gemini-2\.5-flash'/) < at(/runGeminiModel\('gemini-2\.5-flash-lite'/));
  assert.ok(!/raceWithHedge[^;]*runGeminiModel/.test(run), 'direct Gemini is not in the race');
  assert.match(src, /responseSchema: GEMINI_RESPONSE_SCHEMA/);       // the direct fallback keeps its JSON mode
  assert.match(src, /thinkingBudget: 0/);
  assert.match(src, /response_format: OPENROUTER_RESPONSE_FORMAT/);
  assert.match(src, /max_tokens: 2000/);
  assert.ok(!/max_tokens: 750/.test(src));
  assert.match(src, /startedAt \+ ENGINE_DEADLINE_MS/);
  assert.match(src, /ROUTE_HARD_MS/);
  const hard = src.slice(src.indexOf('Last line of defence'), src.indexOf('Last line of defence') + 700);
  assert.match(hard, /releaseComicQuota\(comicReservationKey\)/);
  // the per-attempt log carries finish reason, token counts and (paid) usedToday/maxToday/capUsd but never prompts, outputs or keys
  const log = src.slice(src.indexOf('function logAttempt'), src.indexOf('function logAttempt') + 300);
  assert.ok(!/instruction|script|apiKey|text\b/.test(log.replace(/info\)/g, '')));
  for (const field of ['finish:', 'promptTokens:', 'outputTokens:', 'usedToday', 'maxToday', 'capUsd']) assert.ok(src.includes(field), field);
});
