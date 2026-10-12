import { test } from 'node:test';
import assert from 'node:assert/strict';

const { scanHiddenKeys, sweepHidden, sweepPaged, isSweepableKey, SWEEP_CURSOR_KEY } = await import('../lib/report-sweep.js');

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
  const publicSet = new Set(['panels/k1.png', 'panels/k2.png', 'panels/k4.png']); const moved = [];
  const r = await sweepHidden({
    keys: ['panels/k1.png', 'panels/k2.png', 'panels/k3.png', 'panels/k4.png', 'panels/k5.png'],
    headPublic: async (k) => { if (k === 'panels/k5.png') throw new Error('R2 hiccup'); return publicSet.has(k); },
    quarantine: async (k) => { if (k === 'panels/k2.png') return { status: 'failed' }; moved.push(k); return { status: 'moved' }; },
  });
  assert.deepEqual(moved, ['panels/k1.png', 'panels/k4.png']); assert.deepEqual(r, { examined: 5, stillPublic: ['panels/k1.png', 'panels/k2.png', 'panels/k4.png'], moved: 2, failed: ['panels/k2.png'], notConfigured: false, timedOut: false });
});

test('sweepHidden with apply:false only reports; with an unconfigured quarantine bucket it stops without touching anything', async () => {
  const q = []; const base = { keys: ['panels/a.png', 'panels/b.png'], headPublic: async () => true };
  const dry = await sweepHidden({ ...base, apply: false, quarantine: async (k) => { q.push(k); return { status: 'moved' }; } });
  assert.deepEqual(dry.stillPublic, ['panels/a.png', 'panels/b.png']); assert.equal(dry.moved, 0); assert.equal(q.length, 0);
  const nc = await sweepHidden({ ...base, quarantine: async () => ({ status: 'not-configured' }) });
  assert.equal(nc.notConfigured, true); assert.equal(nc.moved, 0); assert.equal(nc.examined, 1);
});

test('sweepHidden honours the deadline', async () => {
  let t = 0;
  const r = await sweepHidden({ keys: ['panels/a.png', 'panels/b.png', 'panels/c.png'], headPublic: async () => false, deadlineMs: 10, now: () => (t += 6) });
  assert.equal(r.timedOut, true); assert.ok(r.examined < 3);
});

test('isSweepableKey: panels/ and posters/ only — never characters/, other prefixes, traversal or junk', () => {
  for (const k of ['panels/a/b.png', 'posters/x.jpg', 'panels/1699_abc_00.png']) assert.equal(isSweepableKey(k), true, k);
  for (const k of ['characters/a/b-sheet.jpg', 'quarantine/panels/a.png', 'panels/../characters/x.jpg', '', null, undefined, 42, 'panels', `panels/${'x'.repeat(400)}`]) assert.equal(isSweepableKey(k), false, String(k));
});

test('sweepHidden skips non-sweepable keys without even looking at them', async () => {
  const looked = [];
  const r = await sweepHidden({ keys: ['characters/a/s.jpg', 'panels/a/1.png', 'weird/x.png'], headPublic: async (k) => { looked.push(k); return false; } });
  assert.deepEqual(looked, ['panels/a/1.png']); assert.equal(r.examined, 1);
});

function pagedRedis(pages, stored = {}) {
  const kv = new Map(Object.entries(stored)); const scans = [];
  return { kv, scans,
    async get(k) { return kv.has(k) ? kv.get(k) : null; }, async set(k, v) { kv.set(k, v); }, async del(k) { kv.delete(k); },
    async scan(cursor) { scans.push(String(cursor)); return pages[String(cursor)] ?? ['0', []]; } };
}

test('sweepPaged resumes from the stored cursor across runs and clears it when the walk is complete', async () => {
  const pages = { 0: ['11', ['report:hidden:panels/a/1.png', 'report:hidden:panels/a/2.png']], 11: ['22', ['report:hidden:panels/a/3.png', 'report:hidden:panels/a/4.png']], 22: ['0', ['report:hidden:panels/a/5.png']] };
  const redis = pagedRedis(pages);
  const seen = [];
  const deps = { redis, headPublic: async (k) => { seen.push(k); return false; }, quarantine: async () => ({ status: 'moved' }) };
  const run1 = await sweepPaged({ ...deps, maxKeys: 3 });                       // run 1 stops after the 2nd page (4 ≥ 3)
  assert.equal(run1.finished, false); assert.equal(redis.kv.get(SWEEP_CURSOR_KEY), '22'); assert.deepEqual(redis.scans, ['0', '11']);
  seen.length = 0; redis.scans.length = 0;
  const run2 = await sweepPaged({ ...deps, maxKeys: 3 });                       // run 2 starts at 22, not at 0
  assert.deepEqual(redis.scans, ['22']); assert.deepEqual(seen, ['panels/a/5.png']); assert.equal(run2.finished, true); assert.equal(redis.kv.has(SWEEP_CURSOR_KEY), false);
});

test('sweepPaged: a deadline or an unconfigured bucket keeps the cursor ON the page (redone next run); hash-only marks and junk cursors are handled', async () => {
  const pages = { 0: ['9', ['report:hidden:panels/a/1.png', 'report:hidden:h:' + 'a'.repeat(64)]], 9: ['0', ['report:hidden:panels/a/2.png']] };
  const nc = pagedRedis(pages);
  const r = await sweepPaged({ redis: nc, headPublic: async () => true, quarantine: async () => ({ status: 'not-configured' }) });
  assert.equal(r.notConfigured, true); assert.equal(nc.kv.get(SWEEP_CURSOR_KEY), '0', 'cursor stays where the page started');
  const junk = pagedRedis(pages, { [SWEEP_CURSOR_KEY]: 'not-a-cursor' });
  await sweepPaged({ redis: junk, headPublic: async () => false, quarantine: async () => ({ status: 'moved' }) });
  assert.equal(junk.scans[0], '0', 'a corrupt stored cursor restarts from 0');
  let t = 0;
  const slow = pagedRedis(pages);
  const d = await sweepPaged({ redis: slow, headPublic: async () => false, quarantine: async () => ({ status: 'moved' }), deadlineMs: 5, now: () => (t += 4) });
  assert.equal(d.timedOut, true); assert.equal(d.finished, false);
});
