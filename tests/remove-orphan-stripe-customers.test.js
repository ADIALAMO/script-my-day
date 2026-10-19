import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis._redisClient = {};
const { run, parseArgs, makeRedisDeps } = await import('../scripts/remove-orphan-stripe-customers.mjs');

function world({ confirm = true, backupFails = false } = {}) {
  const redis = new Map(Object.entries({
    'user:stripe_customer:aaaa1': 'cus_SECRET1', 'user:tier:aaaa1': 'pro', 'user:tier_source:aaaa1': JSON.stringify({ source: 'admin', by: 'x', at: 1 }),
    'user:stripe_customer:bbbb2': 'cus_SECRET2', 'user:tier_source:bbbb2': JSON.stringify({ source: 'stripe', at: 1 }), 'user:tier:bbbb2': 'pro',
    'user:stripe_customer:cccc3': 'cus_SECRET3',
    'user:other:zzz': 'keep',
  }));
  const members = new Set(['aaaa1', 'bbbb2']);
  const lines = []; const files = new Map(); const order = [];
  const deps = {
    scanKeys: async () => [...redis.keys()],
    readRaw: async (k) => (redis.has(k) ? redis.get(k) : null),
    isProMember: async (u) => members.has(u),
    casDelete: async (k, exp) => { if (!redis.has(k)) return 'missing'; if (redis.get(k) !== exp) return 'changed'; redis.delete(k); order.push('delete'); return 'ok'; },
    setIfMissing: async (k, v) => { if (redis.has(k)) return false; redis.set(k, v); return true; },
    writeBackup: async (d, id, data) => { if (backupFails) throw new Error('disk'); order.push('backup'); files.set('f', JSON.parse(JSON.stringify(data))); },
    readBackup: async () => files.get('f'),
    newRunId: () => 'r1', confirm: async (p, w) => confirm && w, log: (s) => lines.push(s),
  };
  deps.confirm = async (p, w) => { deps.word = w; return confirm; };
  return { redis, deps, lines, files, order };
}

test('dry run lists masked rows, deletes nothing, never prints a customer id or full user id', async () => {
  const w = world();
  const r = await run({ argv: [], deps: w.deps });
  assert.equal(r.code, 0); assert.equal(w.redis.size, 8);
  const out = w.lines.join('\n');
  assert.match(out, /would delete: 2 · kept \(tier_source = stripe\): 1/);
  assert.doesNotMatch(out, /cus_|aaaa1|bbbb2|cccc3/);
});

test('apply: backup first, typed word, deletes only non-stripe-sourced customer keys, leaves tier_source and others alone', async () => {
  const w = world();
  const r = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(r.code, 0); assert.equal(w.deps.word, 'DELETE 2');
  assert.deepEqual(w.order, ['backup', 'delete', 'delete']);
  assert.ok(!w.redis.has('user:stripe_customer:aaaa1') && !w.redis.has('user:stripe_customer:cccc3'));
  assert.ok(w.redis.has('user:stripe_customer:bbbb2') && w.redis.has('user:tier_source:aaaa1') && w.redis.has('user:other:zzz'));
});

test('no confirmation or no backup = nothing changes; rollback restores only missing keys', async () => {
  for (const o of [{ confirm: false }, { backupFails: true }]) { const w = world(o); assert.equal((await run({ argv: ['--apply'], deps: w.deps })).code, 1); assert.equal(w.redis.size, 8); }
  const w = world(); await run({ argv: ['--apply'], deps: w.deps });
  assert.equal((await run({ argv: ['--rollback', 'f', '--apply'], deps: w.deps })).code, 0);
  assert.equal(w.redis.get('user:stripe_customer:aaaa1'), 'cus_SECRET1');
});

test('argument parsing and Redis wiring', async () => {
  assert.ok(parseArgs(['--apply', '--dry-run']).error); assert.ok(parseArgs(['--x']).error);
  assert.equal(typeof makeRedisDeps({}).casDelete, 'function');
});
