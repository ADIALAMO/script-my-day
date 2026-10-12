import { test } from 'node:test';
import assert from 'node:assert/strict';

const { scanHiddenKeys, sweepHidden } = await import('../lib/report-sweep.js');

const fakeRedis = (pages) => ({ calls: [], async scan(cursor, opts) { this.calls.push([cursor, opts.match]); const [next, keys] = pages[String(cursor)] ?? ['0', []]; return [next, keys]; } });

test('scanHiddenKeys follows the cursor to the end, strips the prefix and SKIPS hash-only marks', async () => {
  const redis = fakeRedis({ 0: ['7', ['report:hidden:panels/a/1.png', 'report:hidden:h:' + 'a'.repeat(64)]], 7: ['0', ['report:hidden:posters/b/2.png']] });
  assert.deepEqual(await scanHiddenKeys(redis, 100), ['panels/a/1.png', 'posters/b/2.png']);
  assert.deepEqual(redis.calls.map((c) => c[1]), ['report:hidden:*', 'report:hidden:*']);
});

test('scanHiddenKeys stops at the cap', async () => {
  const redis = fakeRedis({ 0: ['5', ['report:hidden:a.png', 'report:hidden:b.png', 'report:hidden:c.png']], 5: ['0', ['report:hidden:d.png']] });
  assert.deepEqual(await scanHiddenKeys(redis, 2), ['a.png', 'b.png']);
});

test('sweepHidden moves only keys that are still public; counts failures; an R2 error on one key does not stop the rest', async () => {
  const publicSet = new Set(['k1', 'k2', 'k4']); const moved = [];
  const r = await sweepHidden({
    keys: ['k1', 'k2', 'k3', 'k4', 'k5'],
    headPublic: async (k) => { if (k === 'k5') throw new Error('R2 hiccup'); return publicSet.has(k); },
    quarantine: async (k) => { if (k === 'k2') return { status: 'failed' }; moved.push(k); return { status: 'moved' }; },
  });
  assert.deepEqual(moved, ['k1', 'k4']); assert.deepEqual(r, { examined: 5, stillPublic: ['k1', 'k2', 'k4'], moved: 2, failed: ['k2'], notConfigured: false, timedOut: false });
});

test('sweepHidden with apply:false only reports; with an unconfigured quarantine bucket it stops without touching anything', async () => {
  const q = []; const base = { keys: ['a', 'b'], headPublic: async () => true };
  const dry = await sweepHidden({ ...base, apply: false, quarantine: async (k) => { q.push(k); return { status: 'moved' }; } });
  assert.deepEqual(dry.stillPublic, ['a', 'b']); assert.equal(dry.moved, 0); assert.equal(q.length, 0);
  const nc = await sweepHidden({ ...base, quarantine: async () => ({ status: 'not-configured' }) });
  assert.equal(nc.notConfigured, true); assert.equal(nc.moved, 0); assert.equal(nc.examined, 1);
});

test('sweepHidden honours the deadline', async () => {
  let t = 0;
  const r = await sweepHidden({ keys: ['a', 'b', 'c'], headPublic: async () => false, deadlineMs: 10, now: () => (t += 6) });
  assert.equal(r.timedOut, true); assert.ok(r.examined < 3);
});
