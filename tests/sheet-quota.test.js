import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem; // must precede the lib imports (lib/redis.js reuses it)
// Defaults under test: Free 3 / month, Pro 30 / month (no env override set here on purpose).
delete process.env.SHEET_UPLOADS_FREE_PER_MONTH;
delete process.env.SHEET_UPLOADS_PRO_PER_MONTH;
process.env.DAILY_IDENTITY_BUDGET = '0.18'; // 0.18 / 0.06 = 3 identity calls per day

const { reserveSheetQuota, releaseSheetQuota, sheetKey, sheetResetsAt } = await import('../lib/sheet-quota.js');
const { getMsg, CODES } = await import('../lib/messages.js');
const { SHEET_LIMITS } = await import('../config/limits.js');
const { nextMonthStartUTC } = await import('../lib/api-utils.js');
const { reserveIdentityBudget, releaseIdentityBudget, identityBudgetReached, globalIdentityKey } = await import('../lib/budget.js');

beforeEach(() => mem._store.clear());

test('defaults: Free 3 per month, Pro 30 per month', () => {
  assert.equal(SHEET_LIMITS.free, 3);
  assert.equal(SHEET_LIMITS.pro, 30);
  assert.equal(SHEET_LIMITS.anonymous, 0);
  assert.equal(SHEET_LIMITS.admin, Infinity);
});

test('free: 3 uploads per month, the 4th is refused and the slot is returned', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await reserveSheetQuota('free', 'u:a')).ok, true);
  const r = await reserveSheetQuota('free', 'u:a');
  assert.equal(r.ok, false);
  assert.equal(r.limit, 3);
  const key = [...mem._store.keys()].find((k) => k.startsWith('usage:sheet:u:a:'));
  assert.equal(mem._store.get(key), '3'); // rolled back, not 4
});

test('free and pro have separate values; users are independent', async () => {
  for (let i = 0; i < 30; i++) assert.equal((await reserveSheetQuota('pro', 'u:p')).ok, true, `#${i + 1}`);
  const over = await reserveSheetQuota('pro', 'u:p');
  assert.equal(over.ok, false);
  assert.equal(over.limit, 30);
  assert.equal((await reserveSheetQuota('free', 'u:other')).ok, true);
});

test('anonymous is never allowed; admin is unlimited and uncounted', async () => {
  assert.equal((await reserveSheetQuota('anonymous', 'ip:1')).ok, false);
  for (let i = 0; i < 20; i++) assert.equal((await reserveSheetQuota('admin', 'u:adm')).ok, true);
  assert.equal([...mem._store.keys()].some((k) => k.includes('u:adm')), false);
});

test('atomic: 20 concurrent reservations for a limit of 3 → exactly 3 succeed', async () => {
  const results = await Promise.all(Array.from({ length: 20 }, () => reserveSheetQuota('free', 'u:race')));
  assert.equal(results.filter((r) => r.ok).length, 3);
});

test('release gives the slot back', async () => {
  const r = await reserveSheetQuota('free', 'u:rel');
  await releaseSheetQuota(r.key);
  for (let i = 0; i < 3; i++) assert.equal((await reserveSheetQuota('free', 'u:rel')).ok, true);
});

test('global identity budget: atomic reservation, refusal at the cap, release', async () => {
  const results = await Promise.all(Array.from({ length: 10 }, () => reserveIdentityBudget()));
  assert.equal(results.filter((r) => r.ok).length, 3);
  assert.equal(mem._store.get(globalIdentityKey()), '3'); // refusals were rolled back
  assert.equal(await identityBudgetReached(), true);
  await releaseIdentityBudget();
  assert.equal(await identityBudgetReached(), false);
});

test('no budget configured → reservation always succeeds (and is still counted)', async () => {
  const saved = process.env.DAILY_IDENTITY_BUDGET;
  delete process.env.DAILY_IDENTITY_BUDGET;
  try {
    for (let i = 0; i < 5; i++) assert.equal((await reserveIdentityBudget()).ok, true);
    assert.equal(mem._store.get(globalIdentityKey()), '5');
  } finally { process.env.DAILY_IDENTITY_BUDGET = saved; }
});

test('Redis failure throws (callers must fail closed)', async () => {
  const saved = global._redisClient.pipeline;
  global._redisClient.pipeline = () => { throw new Error('boom'); };
  try {
    await assert.rejects(reserveSheetQuota('free', 'u:x'));
    await assert.rejects(reserveIdentityBudget());
  } finally { global._redisClient.pipeline = saved; }
});

// ── monthly window ─────────────────────────────────────────────────────────────────────
test('the key is month-stamped (YYYY-MM): a new month is a fresh key, i.e. the quota resets on the 1st', () => {
  assert.equal(sheetKey('u:a', new Date('2026-10-31T23:59:59Z')), 'usage:sheet:u:a:2026-10');
  assert.equal(sheetKey('u:a', new Date('2026-11-01T00:00:00Z')), 'usage:sheet:u:a:2026-11');
});

test('refusal tells the UI how many are included and when it renews (first instant of next UTC month)', async () => {
  for (let i = 0; i < 3; i++) await reserveSheetQuota('free', 'u:r');
  const r = await reserveSheetQuota('free', 'u:r');
  assert.equal(r.ok, false);
  assert.equal(r.limit, 3);
  const reset = new Date(r.resetsAt);
  assert.equal(reset.getTime(), nextMonthStartUTC() * 1000);
  assert.equal(reset.getUTCDate(), 1);
  assert.equal(reset.getUTCHours(), 0);
  assert.equal(r.resetsAt, sheetResetsAt());
});

test('TTL: expires slightly over a month — after the month ends, not before', async () => {
  const r = await reserveSheetQuota('free', 'u:ttl');
  const exp = mem._expiries.get(r.key);
  const monthEnd = nextMonthStartUTC();
  assert.ok(exp > monthEnd, 'TTL must outlive the month');
  assert.ok(exp - monthEnd <= 4 * 86400, 'but only by a few days');
  assert.ok(exp - Date.now() / 1000 <= 36 * 86400);
});

test('user-facing message names the included uploads and the renewal date (he + en); safe fallback without params', () => {
  const vars = { limit: 3, reset: '1 November 2026' };
  const en = getMsg(CODES.QUOTA_SHEET, 'en', vars);
  assert.match(en, /all 3 face-photo uploads/);
  assert.match(en, /renews on 1 November 2026 \(UTC\)/);
  const he = getMsg(CODES.QUOTA_SHEET, 'he', { limit: 30, reset: '1 בנובמבר 2026' });
  assert.match(he, /30 העלאות/);
  assert.match(he, /מתחדשת ב-1 בנובמבר 2026/);
  for (const lang of ['en', 'he']) {
    const fb = getMsg(CODES.QUOTA_SHEET, lang);           // no params → generic text, no raw "{limit}"
    assert.ok(!fb.includes('{'), fb);
  }
  assert.equal(getMsg(CODES.QUOTA_COMIC, 'en'), getMsg(CODES.QUOTA_COMIC, 'en', { x: 1 })); // other messages unaffected
});
