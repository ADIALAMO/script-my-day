import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem;
process.env.GUEST_SCRIPTS_PER_DAY = '3';

const { reserveGuestScriptBudget, releaseGuestScriptBudget, guestScriptBudgetKey } = await import('../lib/guest-budget.js');
const { _resetBudgetAlertMemory } = await import('../lib/budget-alerts.js');
const { CODES, getMsg } = await import('../lib/messages.js');

const logs = [];
const origWarn = console.warn;
beforeEach(() => { mem._store.clear(); _resetBudgetAlertMemory(); logs.length = 0; console.warn = (...a) => logs.push(a.join(' ')); });
test.afterEach(() => { console.warn = origWarn; });

test('3 guest scripts per day in total, the 4th is refused and rolled back', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await reserveGuestScriptBudget()).ok, true);
  const r = await reserveGuestScriptBudget();
  assert.equal(r.ok, false);
  assert.ok(r.resetsAt);
  assert.equal(mem._store.get(guestScriptBudgetKey()), '3');
});

test('release gives a slot back', async () => {
  for (let i = 0; i < 3; i++) await reserveGuestScriptBudget();
  await releaseGuestScriptBudget();
  assert.equal((await reserveGuestScriptBudget()).ok, true);
});

test('reached → exactly ONE log line per day however many guests are refused', async () => {
  for (let i = 0; i < 3; i++) await reserveGuestScriptBudget();
  for (let i = 0; i < 10; i++) await reserveGuestScriptBudget();
  const lines = logs.filter((l) => l.includes('BUDGET REACHED') && l.includes('DAILY_GUEST_SCRIPT_BUDGET'));
  assert.equal(lines.length, 1);
  assert.match(lines[0], /3\/3 calls/);
});

test('friendly sign-in message exists in he + en', () => {
  assert.ok(CODES.GUEST_CAPACITY_REACHED);
  assert.match(getMsg('GUEST_CAPACITY_REACHED', 'en'), /[Ss]ign in/);
  assert.match(getMsg('GUEST_CAPACITY_REACHED', 'he'), /התחבר/);
});
