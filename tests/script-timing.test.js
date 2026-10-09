import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = async (env) => {
  const keys = ['SCRIPT_GEMINI_HEDGE_MS', 'SCRIPT_GEMINI_QUALITY_BUDGET_MS', 'SCRIPT_GEMINI_MIN_START_MS', 'SCRIPT_TOTAL_BUDGET_MS', 'SCRIPT_GEMINI_MODE'];
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
  const c = await load({ SCRIPT_GEMINI_HEDGE_MS: '20000', SCRIPT_TOTAL_BUDGET_MS: '40000' });
  assert.equal(c.qualityHedgeMs, 20000);
  assert.equal(c.totalBudgetMs, 40000);
});
