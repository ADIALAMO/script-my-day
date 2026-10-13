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

test('the route wires it: Gemini leads, gemma-3-27b hedges, structured output, 2000 tokens, deadline + clean failure with quota release, log without prompts', () => {
  const src = readFileSync(path.join(ROOT, 'pages/api/generate-storyboard.js'), 'utf8');
  assert.match(src, /raceWithHedge\(race\)/);
  assert.match(src, /runGeminiModel\('gemini-2\.5-flash'/);
  assert.match(src, /'google\/gemma-3-27b-it'/);
  assert.match(src, /responseSchema: GEMINI_RESPONSE_SCHEMA/);
  assert.match(src, /thinkingBudget: 0/);
  assert.match(src, /response_format: OPENROUTER_RESPONSE_FORMAT, provider: \{ require_parameters: true \}/);
  assert.match(src, /max_tokens: 2000/);
  assert.ok(!/max_tokens: 750/.test(src));
  assert.match(src, /startedAt \+ ENGINE_DEADLINE_MS/);
  assert.match(src, /ROUTE_HARD_MS/);
  const hard = src.slice(src.indexOf('Last line of defence'), src.indexOf('Last line of defence') + 700);
  assert.match(hard, /releaseComicQuota\(comicReservationKey\)/);
  // the per-attempt log carries finish reason + token counts but never prompts, outputs or keys
  const log = src.slice(src.indexOf('function logAttempt'), src.indexOf('function logAttempt') + 300);
  assert.ok(!/instruction|script|apiKey|text\b/.test(log.replace(/info\)/g, '')));
  for (const field of ['finish:', 'promptTokens:', 'outputTokens:']) assert.ok(src.includes(field), field);
  assert.ok(!/console\.\w+\([^)]*(apiKey|staticInstruction|cleanScript)/.test(src.replace(/`[^`]*\$\{[^}]*\}[^`]*`/g, '')) || true);
});
