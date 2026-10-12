import { test } from 'node:test';
import assert from 'node:assert/strict';

const { run, keyFromArg } = await import('../scripts/takedown-object.mjs');

function fakes(initial = {}) {
  const buckets = { public: new Map(Object.entries(initial.public || {})), quarantine: new Map(Object.entries(initial.quarantine || {})) };
  const redisData = new Map(); const log = []; const ops = [];
  const r2 = {
    async head(b, k) { return buckets[b].has(k); },
    async copy(from, to, k) { ops.push(`copy ${from}->${to} ${k}`); buckets[to].set(k, buckets[from].get(k)); },
    async del(b, k) { ops.push(`del ${b} ${k}`); buckets[b].delete(k); },
    async list(b, prefix) { return [...buckets[b].entries()].filter(([k]) => k.startsWith(prefix)).map(([key, v]) => ({ key, size: v.size, lastModified: v.at })); },
  };
  const redis = { async set(k, v) { redisData.set(k, v); }, async del(k) { redisData.delete(k); } };
  return { buckets, redisData, log, ops, deps: { r2, redis, log: (s) => log.push(s), publicBase: 'https://pub.example', now: () => 1_700_000_000_000, confirm: async () => true } };
}
const KEY = 'panels/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/11111111-1111-1111-1111-111111111111.png';

test('keyFromArg accepts keys and URLs under the public base only, never other prefixes or traversal', () => {
  assert.equal(keyFromArg(KEY, 'https://pub.example'), KEY);
  assert.equal(keyFromArg(`https://pub.example/${KEY}?x=1`, 'https://pub.example/'), KEY);
  for (const bad of ['characters/x/y-raw.jpg', 'panels/../characters/x.png', '', null, 'https://evil.example/panels/x.png', 'panels/x.exe']) assert.equal(keyFromArg(bad, 'https://pub.example'), null, String(bad));
});

test('quarantine moves public → quarantine (copy before delete), marks hidden, and refuses without confirmation', async () => {
  const f = fakes({ public: { [KEY]: { size: 5 } } });
  const refused = await run({ ...f.deps, argv: ['quarantine', KEY], confirm: async () => false });
  assert.equal(refused.code, 1); assert.equal(f.buckets.public.has(KEY), true); assert.equal(f.ops.length, 0);
  const r = await run({ ...f.deps, argv: ['quarantine', `https://pub.example/${KEY}`] });
  assert.equal(r.code, 0); assert.equal(f.buckets.public.has(KEY), false); assert.equal(f.buckets.quarantine.has(KEY), true);
  assert.deepEqual(f.ops, [`copy public->quarantine ${KEY}`, `del public ${KEY}`]);
  assert.ok(f.redisData.has(`report:hidden:${KEY}`));
});

test('restore moves it back and clears the hidden mark + reporter set; an unknown key changes nothing', async () => {
  const f = fakes({ quarantine: { [KEY]: { size: 5 } } });
  f.redisData.set(`report:hidden:${KEY}`, '{}'); f.redisData.set(`report:who:${KEY}`, 'x');
  const r = await run({ ...f.deps, argv: ['restore', KEY] });
  assert.equal(r.code, 0); assert.equal(f.buckets.public.has(KEY), true); assert.equal(f.buckets.quarantine.has(KEY), false);
  assert.equal(f.redisData.has(`report:hidden:${KEY}`), false); assert.equal(f.redisData.has(`report:who:${KEY}`), false);
  const none = fakes();
  assert.equal((await run({ ...none.deps, argv: ['restore', KEY] })).code, 1); assert.equal(none.ops.length, 0);
});

test('delete is permanent, needs the typed word, and finds the object in either bucket', async () => {
  const f = fakes({ quarantine: { [KEY]: { size: 5 } } });
  let asked;
  const r = await run({ ...f.deps, argv: ['delete', KEY], confirm: async (plan, word) => { asked = word; return true; } });
  assert.equal(asked, `DELETE ${KEY}`); assert.equal(r.code, 0); assert.equal(f.buckets.quarantine.has(KEY), false); assert.deepEqual(f.ops, [`del quarantine ${KEY}`]);
});

test('list-recent prints key, size and time only (no content), filtered by window; owner lists one owner prefix', async () => {
  const f = fakes({ public: {
    'panels/a/old.png': { size: 1, at: new Date('2026-10-01T00:00:00Z') },
    'panels/a/new.png': { size: 2, at: new Date('2026-10-10T12:00:00Z') },
    'posters/b/new2.png': { size: 3, at: new Date('2026-10-11T00:00:00Z') },
  } });
  const r = await run({ ...f.deps, argv: ['list-recent', '--since', '2026-10-05T00:00:00Z'] });
  assert.equal(r.code, 0);
  assert.deepEqual(f.log.filter((l) => l.includes('\t')).map((l) => l.split('\t')[0]).sort(), ['panels/a/new.png', 'posters/b/new2.png']);
  const o = fakes({ public: { 'panels/SEG/x.png': { size: 1, at: new Date() }, 'panels/other/y.png': { size: 1, at: new Date() } } });
  await run({ ...o.deps, argv: ['owner', 'u:123'], ownerSegment: () => 'SEG' });
  assert.deepEqual(o.log.filter((l) => l.includes('\t')).map((l) => l.split('\t')[0]), ['panels/SEG/x.png']);
});

test('bad usage and non-reportable keys are refused with a non-zero code and no side effects', async () => {
  const f = fakes({ public: { 'characters/x/y-raw.jpg': { size: 1 } } });
  assert.equal((await run({ ...f.deps, argv: ['nonsense'] })).code, 2);
  assert.equal((await run({ ...f.deps, argv: ['delete', 'characters/x/y-raw.jpg'] })).code, 2);
  assert.equal(f.ops.length, 0);
});

test('sweep: dry run lists hidden objects still in the public bucket; --apply moves them after the typed word; hash-only marks and quarantined items are ignored', async () => {
  const A = 'panels/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/11111111-1111-1111-1111-111111111111.png';
  const B = 'panels/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb/22222222-2222-2222-2222-222222222222.png';
  const f = fakes({ public: { [A]: { size: 1 } }, quarantine: { [B]: { size: 1 } } });
  f.deps.redis.scanHidden = async () => [A, B];
  const dry = await run({ ...f.deps, argv: ['sweep'] });
  assert.equal(dry.code, 0); assert.equal(f.ops.length, 0);
  assert.match(f.log.join('\n'), /2 hidden item\(s\) checked; 1 still in the PUBLIC bucket/); assert.ok(f.log.includes(`  still public: ${A}`));
  assert.match(f.log.join('\n'), /dry run — add --apply/);
  let asked;
  const r = await run({ ...f.deps, argv: ['sweep', '--apply'], confirm: async (plan, word) => { asked = word; return true; } });
  assert.equal(asked, 'SWEEP 1'); assert.equal(r.code, 0);
  assert.deepEqual(f.ops, [`copy public->quarantine ${A}`, `del public ${A}`]);
  assert.equal(f.buckets.public.has(A), false); assert.equal(f.buckets.quarantine.has(A), true);
});

test('sweep --apply: refused confirmation moves nothing; nothing to do exits cleanly without asking', async () => {
  const A = 'panels/1699999999999_abc123_00.png';
  const f = fakes({ public: { [A]: { size: 1 } } });
  f.deps.redis.scanHidden = async () => [A];
  const refused = await run({ ...f.deps, argv: ['sweep', '--apply'], confirm: async () => false });
  assert.equal(refused.code, 1); assert.equal(f.ops.length, 0);
  const none = fakes(); none.deps.redis.scanHidden = async () => [];
  let asked = false;
  assert.equal((await run({ ...none.deps, argv: ['sweep', '--apply'], confirm: async () => { asked = true; return true; } })).code, 0); assert.equal(asked, false);
});
