import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem;
const { reservePosterQuota, releasePosterQuota, posterQuotaKey } = await import('../lib/poster-quota.js');
beforeEach(() => mem._store.clear());

test('Free 2/day, Pro 3/day, admin unlimited and never counted, anonymous 1 lifetime (expires after 90 days of silence)', async () => {
  for (let i = 0; i < 2; i++) assert.equal((await reservePosterQuota('free', 'u:f')).ok, true);
  const r = await reservePosterQuota('free', 'u:f'); assert.deepEqual([r.ok, r.status, r.code], [false, 429, 'QUOTA_POSTER']);
  for (let i = 0; i < 3; i++) assert.equal((await reservePosterQuota('pro', 'u:p')).ok, true);
  assert.equal((await reservePosterQuota('pro', 'u:p')).ok, false);
  for (let i = 0; i < 20; i++) assert.equal((await reservePosterQuota('admin', 'u:a')).ok, true);
  assert.equal([...mem._store.keys()].some((k) => k.includes('u:a')), false);
  assert.equal((await reservePosterQuota('anonymous', '1.2.3.4')).ok, true);
  const g = await reservePosterQuota('anonymous', '1.2.3.4'); assert.deepEqual([g.ok, g.code], [false, 'QUOTA_POSTER_GUEST']);
  const exp = mem._expiries.get('usage:poster:lifetime:1.2.3.4');
  assert.ok(exp, 'the guest IP counter now expires');
  assert.ok(Math.abs(exp - (Math.floor(Date.now() / 1000) + 90 * 86400)) < 5, 'default retention is 90 days');
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

test('guest counter: 90-day expiry is refreshed on every use, refused attempts and releases included; the allowance is not reset early', async () => {
  const key = posterQuotaKey('anonymous', '2001:db8:1:1::/64');
  const ttl = () => mem._expiries.get(key) - Math.floor(Date.now() / 1000);
  const a = await reservePosterQuota('anonymous', '2001:db8:1:1::/64');
  assert.equal(a.ok, true);
  mem._expiries.set(key, Math.floor(Date.now() / 1000) + 5 * 86400);       // pretend 85 days have passed
  const b = await reservePosterQuota('anonymous', '2001:db8:1:1::/64');   // refused attempt…
  assert.equal(b.ok, false);
  assert.ok(ttl() > 89 * 86400, 'refused attempt refreshed the clock to ~90 days');
  assert.equal(mem._store.get(key), '1', 'and the spent allowance is still spent');
  await releasePosterQuota(key);                                           // DECR must not strip the TTL
  assert.ok(mem._expiries.get(key) > Math.floor(Date.now() / 1000));
});

test('other tiers are unaffected (still expire at UTC midnight)', async () => {
  await reservePosterQuota('free', 'u:midnight');
  const exp = mem._expiries.get(posterQuotaKey('free', 'u:midnight'));
  assert.ok(exp - Math.floor(Date.now() / 1000) <= 86400);
});
