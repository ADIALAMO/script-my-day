import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backfill, maskKey } from '../scripts/backfill-guest-ttl.js';
import { GUEST_RETENTION } from '../config/limits.js';

function mockRedis(keys) { // keys: { key: ttlSeconds | -1 }
  const ttls = new Map(Object.entries(keys)); const expired = [];
  return {
    ttls, expired,
    async scan(_c, { match }) { const re = new RegExp('^' + match.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'); return ['0', [...ttls.keys()].filter((k) => re.test(k))]; },
    async ttl(k) { return ttls.has(k) ? ttls.get(k) : -2; },
    async expire(k, s) { expired.push([k, s]); ttls.set(k, s); return 1; },
  };
}
const SEED = {
  'usage:poster:lifetime:203.0.113.5': -1,
  'usage:poster:lifetime:2001:db8:1:1::/64': -1,
  'usage:poster:lifetime:198.51.100.7': 5000,           // already has a TTL
  'usage:poster:u:abc:2026-10-15': -1,                  // not a guest-lifetime key: never touched
  'usage:script:203.0.113.5:2026-10-15': -1,
};
const quiet = () => {};

test('dry run (default): counts, changes nothing', async () => {
  const r = mockRedis(SEED); const lines = [];
  const res = await backfill({ redis: r, out: (s) => lines.push(s) });
  assert.deepEqual([res.scanned, res.withoutTtl, res.updated], [3, 2, 0]);
  assert.equal(r.expired.length, 0);
  assert.ok(lines.join('\n').includes('DRY RUN'));
});

test('--execute: only guest lifetime keys WITHOUT a TTL get the configured retention; others untouched', async () => {
  const r = mockRedis(SEED);
  const res = await backfill({ redis: r, execute: true, out: quiet });
  assert.equal(res.updated, 2);
  const secs = GUEST_RETENTION.ipDays * 86400;
  assert.deepEqual(r.expired.map(([k, s]) => [k, s]).sort(), [['usage:poster:lifetime:2001:db8:1:1::/64', secs], ['usage:poster:lifetime:203.0.113.5', secs]]);
  assert.equal(r.ttls.get('usage:poster:lifetime:198.51.100.7'), 5000, 'existing TTL not shortened or lengthened');
  assert.equal(r.ttls.get('usage:poster:u:abc:2026-10-15'), -1);
  assert.equal(r.ttls.get('usage:script:203.0.113.5:2026-10-15'), -1);
});

test('re-running changes nothing more (idempotent) and uses a custom retention when given', async () => {
  const r = mockRedis(SEED);
  await backfill({ redis: r, execute: true, days: 30, out: quiet });
  assert.equal(r.ttls.get('usage:poster:lifetime:203.0.113.5'), 30 * 86400);
  const again = await backfill({ redis: r, execute: true, days: 30, out: quiet });
  assert.equal(again.withoutTtl, 0); assert.equal(again.updated, 0);
});

test('a key that gains a TTL between the scan and the write is skipped; a failing EXPIRE is reported, not fatal', async () => {
  const r = mockRedis({ 'usage:poster:lifetime:a': -1, 'usage:poster:lifetime:b': -1 });
  let n = 0; const origTtl = r.ttl; r.ttl = async (k) => (k.endsWith(':a') && ++n === 2 ? 123 : origTtl(k));
  r.expire = async (k) => { if (k.endsWith(':b')) throw new Error('boom'); r.ttls.set(k, 1); return 1; };
  const res = await backfill({ redis: r, execute: true, out: quiet });
  assert.equal(res.updated, 0); assert.equal(res.errors.length, 1);
});

test('output masks the guest IP', async () => {
  assert.ok(!maskKey('usage:poster:lifetime:203.0.113.5').includes('113'));
  const lines = []; await backfill({ redis: mockRedis(SEED), out: (s) => lines.push(s) });
  assert.ok(!lines.join('\n').includes('203.0.113.5'));
});
