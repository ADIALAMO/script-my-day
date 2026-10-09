import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem;
const { reservePosterQuota, releasePosterQuota, posterQuotaKey } = await import('../lib/poster-quota.js');
beforeEach(() => mem._store.clear());

test('Free 2/day, Pro 3/day, admin unlimited and never counted, anonymous 1 lifetime (no expiry)', async () => {
  for (let i = 0; i < 2; i++) assert.equal((await reservePosterQuota('free', 'u:f')).ok, true);
  const r = await reservePosterQuota('free', 'u:f'); assert.deepEqual([r.ok, r.status, r.code], [false, 429, 'QUOTA_POSTER']);
  for (let i = 0; i < 3; i++) assert.equal((await reservePosterQuota('pro', 'u:p')).ok, true);
  assert.equal((await reservePosterQuota('pro', 'u:p')).ok, false);
  for (let i = 0; i < 20; i++) assert.equal((await reservePosterQuota('admin', 'u:a')).ok, true);
  assert.equal([...mem._store.keys()].some((k) => k.includes('u:a')), false);
  assert.equal((await reservePosterQuota('anonymous', '1.2.3.4')).ok, true);
  const g = await reservePosterQuota('anonymous', '1.2.3.4'); assert.deepEqual([g.ok, g.code], [false, 'QUOTA_POSTER_GUEST']);
  assert.equal(mem._expiries.get('usage:poster:lifetime:1.2.3.4'), undefined, 'guest allowance never expires');
});

test('25 PARALLEL reservations for a limit of 2 → exactly 2 succeed and the counter ends at 2', async () => {
  const rs = await Promise.all(Array.from({ length: 25 }, () => reservePosterQuota('free', 'u:race')));
  assert.equal(rs.filter((r) => r.ok).length, 2);
  assert.equal(mem._store.get(posterQuotaKey('free', 'u:race')), '2');
});

test('release gives the slot back (a request that produced no image is free)', async () => {
  const a = await reservePosterQuota('free', 'u:rel'); const b = await reservePosterQuota('free', 'u:rel');
  assert.equal((await reservePosterQuota('free', 'u:rel')).ok, false);
  await releasePosterQuota(a.key);
  assert.equal((await reservePosterQuota('free', 'u:rel')).ok, true);
  assert.ok(b.ok);
});

test('Redis failure throws so the route can fail open exactly like before', async () => {
  const orig = global._redisClient.pipeline; global._redisClient.pipeline = () => { throw new Error('down'); };
  try { await assert.rejects(reservePosterQuota('free', 'u:x')); } finally { global._redisClient.pipeline = orig; }
});
