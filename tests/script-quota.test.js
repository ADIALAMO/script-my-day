import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem;

const { reserveScriptQuota, releaseScriptQuota, scriptQuotaKey } = await import('../lib/script-quota.js');
const { TIER_LIMITS } = await import('../config/limits.js');

beforeEach(() => mem._store.clear());

test('defaults: guest 2, free 5, pro 20 per day; admin unlimited', () => {
  assert.equal(TIER_LIMITS.anonymous.script, 2);
  assert.equal(TIER_LIMITS.free.script, 5);
  assert.equal(TIER_LIMITS.pro.script, 20);
  assert.equal(TIER_LIMITS.admin.script, Infinity);
});

test('pro: exactly 20 scripts per day, the 21st is refused', async () => {
  for (let i = 0; i < 20; i++) assert.equal((await reserveScriptQuota('pro', 'u:p')).ok, true, `#${i + 1}`);
  const r = await reserveScriptQuota('pro', 'u:p');
  assert.equal(r.ok, false);
  assert.equal(r.limit, 20);
  assert.equal(mem._store.get(scriptQuotaKey('u:p')), '20'); // rolled back, not 21
});

test('free and anonymous use their own limits; admin is never counted', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await reserveScriptQuota('free', 'u:f')).ok, true);
  assert.equal((await reserveScriptQuota('free', 'u:f')).ok, false);
  for (let i = 0; i < 2; i++) assert.equal((await reserveScriptQuota('anonymous', 'ip:1')).ok, true);
  assert.equal((await reserveScriptQuota('anonymous', 'ip:1')).ok, false);
  for (let i = 0; i < 50; i++) assert.equal((await reserveScriptQuota('admin', 'u:a')).ok, true);
  assert.equal([...mem._store.keys()].some((k) => k.includes('u:a')), false);
});

test('atomic under concurrency; a failed generation gives the slot back', async () => {
  const rs = await Promise.all(Array.from({ length: 40 }, () => reserveScriptQuota('pro', 'u:race')));
  assert.equal(rs.filter((r) => r.ok).length, 20);
  await releaseScriptQuota(rs.find((r) => r.ok).key);
  assert.equal((await reserveScriptQuota('pro', 'u:race')).ok, true);
});

test('key is per day and expires at the next UTC midnight', async () => {
  const r = await reserveScriptQuota('pro', 'u:ttl');
  const exp = mem._expiries.get(r.key);
  assert.ok(exp > Date.now() / 1000 && exp - Date.now() / 1000 <= 86400);
});

// ── monthly cap (Pro) ───────────────────────────────────────────────────────────────────
const { scriptMonthKey, scriptMonthlyLimit } = await import('../lib/script-quota.js');
const { nextMonthStartUTC } = await import('../lib/api-utils.js');

test('Pro monthly cap defaults to 150 (and only Pro has one)', () => {
  assert.equal(scriptMonthlyLimit('pro'), 150);
  assert.equal(scriptMonthlyLimit('free'), Infinity);
  assert.equal(scriptMonthlyLimit('anonymous'), Infinity);
});

test('Pro: the 151st script of the month is refused with scope=month even if the day has room; both slots are returned', async () => {
  mem._store.set(scriptMonthKey('u:m'), '150');
  const r = await reserveScriptQuota('pro', 'u:m');
  assert.equal(r.ok, false); assert.equal(r.scope, 'month'); assert.equal(r.limit, 150);
  assert.equal(r.resetsAt, new Date(nextMonthStartUTC() * 1000).toISOString());
  assert.equal(mem._store.get(scriptMonthKey('u:m')), '150');
  assert.equal(mem._store.get(scriptQuotaKey('u:m')), '0', 'the day slot taken before the month check was returned');
});

test('the daily cap is still checked first (scope=day) and does not touch the monthly counter', async () => {
  mem._store.set(scriptQuotaKey('u:d'), '20');
  const r = await reserveScriptQuota('pro', 'u:d');
  assert.equal(r.ok, false); assert.equal(r.scope, 'day'); assert.equal(r.limit, 20);
  assert.equal(mem._store.get(scriptMonthKey('u:d')) ?? null, null);
});

test('monthly key is month-stamped, outlives the month by a few days; release returns BOTH slots; 200 parallel → exactly 20/day', async () => {
  const r = await reserveScriptQuota('pro', 'u:ttl2');
  assert.match(r.monthKey, /^usage:script-month:u:ttl2:\d{4}-\d{2}$/);
  const exp = mem._expiries.get(r.monthKey), end = nextMonthStartUTC();
  assert.ok(exp > end && exp - end <= 4 * 86400);
  await releaseScriptQuota(r);
  assert.equal(mem._store.get(r.monthKey), '0'); assert.equal(mem._store.get(r.key), '0');
  const rs = await Promise.all(Array.from({ length: 200 }, () => reserveScriptQuota('pro', 'u:par')));
  assert.equal(rs.filter((x) => x.ok).length, 20);
  assert.equal(mem._store.get(scriptMonthKey('u:par')), '20');
});
