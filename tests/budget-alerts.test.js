import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem;
process.env.DAILY_IDENTITY_BUDGET = '0.12'; // 2 calls
process.env.DAILY_IMAGE_BUDGET = '0.028';   // 2 Klein calls at 0.014
delete process.env.KLEIN_COST_USD;

const { reportBudgetReached, _resetBudgetAlertMemory } = await import('../lib/budget-alerts.js');
const { identityBudgetReached, reserveIdentityBudget, globalIdentityKey } = await import('../lib/budget.js');
const { paidImageBudgetReached, recordPaidImage } = await import('../lib/circuit-breaker.js');

const logs = [];
const origWarn = console.warn;
beforeEach(() => { mem._store.clear(); _resetBudgetAlertMemory(); logs.length = 0; console.warn = (...a) => logs.push(a.join(' ')); });
test.afterEach(() => { console.warn = origWarn; });

const budgetLines = () => logs.filter((l) => l.includes('BUDGET REACHED'));

test('log line is written ONCE per budget per day, not per request', async () => {
  await reportBudgetReached('DAILY_IMAGE_BUDGET', 2, 2);
  await reportBudgetReached('DAILY_IMAGE_BUDGET', 3, 2);
  await reportBudgetReached('DAILY_IMAGE_BUDGET', 9, 2);
  assert.equal(budgetLines().length, 1);
  assert.match(budgetLines()[0], /DAILY_IMAGE_BUDGET 2\/2 calls/); // which budget, count, limit
  await reportBudgetReached('DAILY_IDENTITY_BUDGET', 2, 2);      // a different budget gets its own line
  assert.equal(budgetLines().length, 2);
});

test('a second serverless instance (fresh memory, same Redis day key) stays silent', async () => {
  await reportBudgetReached('DAILY_IDENTITY_BUDGET', 2, 2);
  _resetBudgetAlertMemory(); // simulate another instance
  await reportBudgetReached('DAILY_IDENTITY_BUDGET', 2, 2);
  assert.equal(budgetLines().length, 1);
});

test('identity budget: nothing reported below the cap, reported once when reached', async () => {
  assert.equal(await identityBudgetReached(), false);
  assert.equal(budgetLines().length, 0);
  await reserveIdentityBudget(); await reserveIdentityBudget();
  assert.equal(await identityBudgetReached(), true);
  assert.equal(await identityBudgetReached(), true);
  assert.equal((await reserveIdentityBudget()).ok, false);
  assert.equal(budgetLines().length, 1);
  assert.match(budgetLines()[0], /DAILY_IDENTITY_BUDGET 2\/2/);
});

test('image budget: same behaviour on the circuit-breaker side', async () => {
  assert.equal(await paidImageBudgetReached(mem), false);
  await recordPaidImage(mem); await recordPaidImage(mem);
  assert.equal(await paidImageBudgetReached(mem), true);
  assert.equal(await paidImageBudgetReached(mem), true);
  assert.equal(budgetLines().length, 1);
  assert.match(budgetLines()[0], /DAILY_IMAGE_BUDGET 2\/2/);
});

test('the alert carries no user data and never throws, even if Redis is broken', async () => {
  const orig = global._redisClient.set;
  global._redisClient.set = async () => { throw new Error('down'); };
  try { await reportBudgetReached('DAILY_IMAGE_BUDGET', 5, 5); } finally { global._redisClient.set = orig; }
  assert.equal(budgetLines().length, 1);
  assert.ok(!/@|u:|ip:/.test(budgetLines()[0]));
});

test('Telegram: exactly ONE message per budget per day, with name/count/limit and no user data', async () => {
  const { createServer } = await import('node:http');
  const received = [];
  const server = createServer((req, res) => {
    let body = ''; req.on('data', (c) => { body += c; });
    req.on('end', () => { received.push(JSON.parse(body)); res.writeHead(200); res.end('{"ok":true}'); });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const prev = { ...process.env };
  process.env.NODE_ENV = 'production'; // alertOnce only fires in production
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${server.address().port}`;
  process.env.TELEGRAM_BOT_TOKEN = 'test-token-not-real';
  process.env.TELEGRAM_CHAT_ID = '1';
  try {
    for (let i = 0; i < 5; i++) { _resetBudgetAlertMemory(); await reportBudgetReached('DAILY_IDENTITY_BUDGET', 7, 7); }
    await reportBudgetReached('DAILY_IMAGE_BUDGET', 71, 71);
    assert.equal(received.length, 2);
    assert.match(received[0].text, /DAILY\\_IDENTITY\\_BUDGET/); // Markdown-escaped for Telegram
    assert.match(received[0].text, /7 \/ limit: 7/);
    assert.match(received[1].text, /DAILY\\_IMAGE\\_BUDGET/);
    assert.ok(!/@|u:|ip:/.test(received[0].text));
  } finally {
    for (const k of ['NODE_ENV', 'TELEGRAM_API_BASE', 'TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']) {
      if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    }
    server.close();
  }
});
