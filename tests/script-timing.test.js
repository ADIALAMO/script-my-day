import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = async (env) => {
  const keys = ['SCRIPT_STAGE1_RESERVE_MS', 'SCRIPT_GEMINI_HEDGE_MS', 'SCRIPT_GEMINI_QUALITY_BUDGET_MS', 'SCRIPT_GEMINI_MIN_START_MS', 'SCRIPT_TOTAL_BUDGET_MS', 'SCRIPT_GEMINI_MODE'];
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, env);
  return (await import(`../config/limits.js?${Math.random()}`)).SCRIPT_GEMINI;
};

test('defaults fit inside the 60 s route limit with margin, and the rescue model gets a real window', async () => {
  const c = await load({});
  const maxDuration = Number(JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url))).functions['pages/api/generate-script.js'].maxDuration) * 1000;
  assert.equal(maxDuration, 60000);
  assert.ok(c.totalBudgetMs <= maxDuration - 5000, 'whole cascade ends ≥5 s before the function is killed');
  assert.ok(c.qualityBudgetMs < c.totalBudgetMs);
  assert.ok(c.qualityHedgeMs >= 27000, 'above the benchmarked 21–26 s so it fires for outliers only');
  assert.ok(c.qualityBudgetMs - c.qualityHedgeMs >= c.minStartBudgetMs, 'the rescue model is started with at least minStart left');
});

test('a configured hedge delay that would leave no room is clamped to fit', async () => {
  const c = await load({ SCRIPT_GEMINI_HEDGE_MS: '45000' });
  assert.equal(c.qualityHedgeMs, c.qualityBudgetMs - c.minStartBudgetMs);
});

test('env overrides are honoured when they fit', async () => {
  // total 44 s − 8 s Stage-1 reserve = 36 s quality budget → a 20 s hedge fits (36 − 15 = 21 s of room)
  const c = await load({ SCRIPT_GEMINI_HEDGE_MS: '20000', SCRIPT_TOTAL_BUDGET_MS: '44000' });
  assert.equal(c.qualityHedgeMs, 20000);
  assert.equal(c.totalBudgetMs, 44000);
});

test('the Stage-1 reserve for Stages 2–5 is the largest that keeps the hedge ≥ 27 s: 8 s works, 10 s would not', async () => {
  const d = await load({});
  assert.equal(d.stage1ReserveMs, 8000);
  assert.equal(d.totalBudgetMs, 50000);
  assert.ok(d.qualityHedgeMs >= 27000, 'default reserve keeps the hedge outside the 21–26 s normal latency band');
  assert.ok(d.qualityBudgetMs <= d.totalBudgetMs - d.stage1ReserveMs, 'Gemini never runs into the reserve');
  const big = await load({ SCRIPT_STAGE1_RESERVE_MS: '10000' });
  assert.ok(big.qualityHedgeMs < 27000, 'documents why 10 s is too much: hedge would move to 25 s');
});

test('a reserve can never exceed a quarter of the total budget (tiny test budgets stay valid)', async () => {
  const c = await load({ SCRIPT_TOTAL_BUDGET_MS: '1500', SCRIPT_GEMINI_QUALITY_BUDGET_MS: '1400' });
  assert.equal(c.stage1ReserveMs, 375);
  assert.equal(c.qualityBudgetMs, 1125);
});
