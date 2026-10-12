import { test } from 'node:test';
import assert from 'node:assert/strict';

const { run, sniffMime } = await import('../scripts/scan-existing-images.mjs');

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('payload-bytes')]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('payload-bytes-jpeg')]);
const day = (d) => new Date(`2026-10-${String(d).padStart(2, '0')}T12:00:00Z`);

function setup(objects, { classify, local = {} } = {}) {
  const files = new Map(); const log = []; const gets = [];
  const bytesOf = Object.fromEntries(objects.map((o) => [o.key, o.bytes ?? PNG]));
  const deps = {
    r2: { async list(prefix) { return objects.filter((o) => o.key.startsWith(prefix)).map((o) => ({ key: o.key, size: o.size ?? o.bytes?.length ?? PNG.length, lastModified: o.at ?? day(10) })); }, async get(k) { gets.push(k); return bytesOf[k]; } },
    fileio: {
      exists: (f) => files.has(f), read: (f) => files.get(f), write: (f, d) => files.set(f, d), readBytes: (f) => local[f],
      walk: () => Object.entries(local).map(([f, b]) => ({ rel: f.split('/').slice(1).join('/'), size: b.length, mtime: day(5) })),
    },
    classify: classify ?? (async () => ({ verdict: 'safe', via: 'nemotron' })),
    log: (s) => log.push(s), now: () => 1_700_000_000_000,
  };
  return { deps, files, log, gets };
}
const OBJ = [{ key: 'panels/a/1.png' }, { key: 'panels/a/2.png' }, { key: 'posters/b/3.png', bytes: JPG }, { key: 'characters/x/raw.jpg' }];

test('sniffMime recognises png / jpeg / webp by magic bytes only', () => {
  assert.equal(sniffMime(PNG), 'image/png'); assert.equal(sniffMime(JPG), 'image/jpeg');
  assert.equal(sniffMime(Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(sniffMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(sniffMime(null), null);
});

test('--count-only: counts and bytes, NO downloads and NO model calls; characters/ is never listed', async () => {
  let called = 0;
  const f = setup(OBJ, { classify: async () => { called += 1; return { verdict: 'safe' }; } });
  const r = await run({ argv: ['--count-only'], deps: f.deps });
  assert.equal(r.code, 0); assert.equal(r.summary.objects, 3);
  assert.equal(f.gets.length, 0); assert.equal(called, 0);
  assert.match(f.log.join('\n'), /3 object\(s\)/); assert.match(f.log.join('\n'), /panels: 2, posters: 1/);
  assert.match(f.log.join('\n'), /≈ \$0\.00/);
});

test('--since / --until / --prefix narrow the scope', async () => {
  const objs = [{ key: 'panels/a/old.png', at: day(1) }, { key: 'panels/a/new.png', at: day(20) }, { key: 'posters/b/new.png', at: day(20) }];
  const f = setup(objs);
  assert.equal((await run({ argv: ['--count-only', '--since', '2026-10-10T00:00:00Z'], deps: f.deps })).summary.objects, 2);
  assert.equal((await run({ argv: ['--count-only', '--since', '2026-10-10T00:00:00Z', '--prefix', 'posters/'], deps: f.deps })).summary.objects, 1);
  assert.equal((await run({ argv: ['--count-only', '--until', '2026-10-05T00:00:00Z'], deps: f.deps })).summary.objects, 1);
});

test('dry run: classifies every object, prints counts and ONLY the keys flagged unsafe, writes keys + verdicts (no image data), moves nothing', async () => {
  const verdicts = { 'panels/a/1.png': 'safe', 'panels/a/2.png': 'unsafe', 'posters/b/3.png': 'unreadable' };
  const seen = [];
  const f = setup(OBJ, { classify: async (dataUri) => { seen.push(dataUri.slice(0, 22)); const k = [...Object.keys(verdicts)][seen.length - 1]; return { verdict: verdicts[k], via: 'nemotron' }; } });
  const r = await run({ argv: ['--concurrency', '1', '--out', 'res.json'], deps: f.deps });
  assert.equal(r.code, 0); assert.deepEqual({ safe: r.summary.safe, unsafe: r.summary.unsafe, unreadable: r.summary.unreadable }, { safe: 1, unsafe: 1, unreadable: 1 });
  const text = f.log.join('\n');
  assert.match(text, /DRY RUN — nothing was moved or deleted/); assert.match(text, /safe 1 · unsafe 1 · unreadable 1/);
  assert.ok(text.includes('  panels/a/2.png')); assert.ok(!text.includes('  panels/a/1.png'), 'safe keys are not listed');
  assert.deepEqual(seen.map((s) => s.slice(0, 15)), ['data:image/png;', 'data:image/png;', 'data:image/jpeg'], 'mime comes from the bytes');
  const saved = JSON.parse(f.files.get('res.json'));
  assert.deepEqual(Object.keys(saved.entries).sort(), ['panels/a/1.png', 'panels/a/2.png', 'posters/b/3.png']);
  assert.ok(!f.files.get('res.json').includes('payload-bytes') && !f.files.get('res.json').includes('base64'), 'no image data in the results file');
  assert.ok(!text.includes('base64') && !text.includes('payload-bytes'));
});

test('resumable: a second run skips safe / unsafe / skipped, and retries unreadable + unavailable', async () => {
  let calls = 0;
  const f = setup(OBJ, { classify: async () => { calls += 1; return { verdict: calls === 2 ? 'unavailable' : 'safe', via: 'nemotron' }; } });
  await run({ argv: ['--concurrency', '1', '--out', 'r.json'], deps: f.deps });
  assert.equal(calls, 3);
  const second = await run({ argv: ['--concurrency', '1', '--out', 'r.json'], deps: f.deps });
  assert.equal(calls, 4, 'only the one "unavailable" key was retried');
  assert.equal(second.summary.safe, 3); assert.match(f.log.join('\n'), /resuming from r\.json: 3 key\(s\)/);
});

test('--limit and --concurrency are honoured; concurrency never exceeds the cap', async () => {
  let inFlight = 0; let max = 0;
  const objs = Array.from({ length: 12 }, (_, i) => ({ key: `panels/a/${i}.png` }));
  const f = setup(objs, { classify: async () => { inFlight += 1; max = Math.max(max, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight -= 1; return { verdict: 'safe' }; } });
  const r = await run({ argv: ['--limit', '7', '--concurrency', '100'], deps: f.deps });
  assert.equal(r.summary.safe, 7); assert.ok(max <= 8, `max in flight ${max}`);
  assert.ok(max >= 2);
});

test('oversized and non-image objects are skipped, never sent to a model; a read error is "unavailable" (retried next run)', async () => {
  let called = 0;
  const objs = [{ key: 'panels/a/big.png', size: 5 * 1024 * 1024 }, { key: 'panels/a/svg.png', bytes: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>') }, { key: 'panels/a/boom.png' }];
  const f = setup(objs, { classify: async () => { called += 1; return { verdict: 'safe' }; } });
  const origGet = f.deps.r2.get; f.deps.r2.get = async (k) => { if (k.endsWith('boom.png')) throw new Error('R2 down'); return origGet(k); };
  const r = await run({ argv: ['--concurrency', '1'], deps: f.deps });
  assert.equal(called, 0); assert.equal(r.summary.skipped, 2); assert.equal(r.summary.unavailable, 1);
});

test('--dir scans local files (names only), marks the results as local, and the quarantine step refuses such a file', async () => {
  const f = setup([], { local: { 'gallery/sample-1.png': PNG, 'gallery/comics/c1.jpg': JPG, 'gallery/notes.txt': Buffer.from('hi') }, classify: async () => ({ verdict: 'unsafe', via: 'nemotron' }) });
  const r = await run({ argv: ['--dir', 'gallery', '--out', 'local.json'], deps: f.deps });
  assert.equal(r.summary.unsafe, 2);
  const saved = JSON.parse(f.files.get('local.json')); assert.equal(saved.local, true); assert.deepEqual(Object.keys(saved.entries).sort(), ['comics/c1.jpg', 'sample-1.png']);
  const q = await run({ argv: ['--quarantine-from', 'local.json'], deps: { ...f.deps, confirm: async () => true } });
  assert.equal(q.code, 2);
});

test('quarantine step: separate, typed confirmation naming the COUNT; only unsafe keys (plus unreadable on request) are moved; hidden mark set; missing objects tolerated', async () => {
  const results = { version: 1, local: false, entries: { 'panels/a/1.png': { v: 'safe' }, 'panels/a/2.png': { v: 'unsafe' }, 'panels/a/3.png': { v: 'unsafe' }, 'panels/a/4.png': { v: 'unreadable' } } };
  const f = setup([]); f.files.set('res.json', JSON.stringify(results));
  const moved = []; const marks = []; let asked;
  const deps = { ...f.deps, headPublic: async (k) => k !== 'panels/a/3.png', quarantine: async (k) => { moved.push(k); return { status: 'moved' }; }, redis: { set: async (k) => { marks.push(k); } }, confirm: async (plan, word) => { asked = word; return true; } };
  const r = await run({ argv: ['--quarantine-from', 'res.json'], deps });
  assert.equal(asked, 'QUARANTINE 2 OBJECTS'); assert.deepEqual(moved, ['panels/a/2.png']); assert.deepEqual(marks, ['report:hidden:panels/a/2.png']);
  assert.deepEqual(r.summary, { moved: 1, missing: 1, failed: 0 });
  moved.length = 0; asked = null;
  await run({ argv: ['--quarantine-from', 'res.json', '--include-unreadable'], deps });
  assert.equal(asked, 'QUARANTINE 3 OBJECTS');
});

test('quarantine step: refused confirmation moves nothing; an unconfigured private bucket stops the run; a failed move is reported and counted', async () => {
  const results = { entries: { 'panels/a/2.png': { v: 'unsafe' }, 'panels/a/9.png': { v: 'unsafe' } } };
  const f = setup([]); f.files.set('res.json', JSON.stringify(results));
  let moved = 0;
  const base = { ...f.deps, headPublic: async () => true, redis: { set: async () => {} } };
  assert.equal((await run({ argv: ['--quarantine-from', 'res.json'], deps: { ...base, quarantine: async () => { moved += 1; return { status: 'moved' }; }, confirm: async () => false } })).code, 1);
  assert.equal(moved, 0);
  assert.equal((await run({ argv: ['--quarantine-from', 'res.json'], deps: { ...base, quarantine: async () => ({ status: 'not-configured' }), confirm: async () => true } })).code, 2);
  const mixed = await run({ argv: ['--quarantine-from', 'res.json'], deps: { ...base, quarantine: async (k) => (k.endsWith('2.png') ? { status: 'moved' } : { status: 'failed' }), confirm: async () => true } });
  assert.equal(mixed.code, 1); assert.deepEqual(mixed.summary, { moved: 1, missing: 0, failed: 1 });
});

test('bad --route is refused before anything is read', async () => {
  const f = setup(OBJ);
  assert.equal((await run({ argv: ['--route', 'turbo'], deps: f.deps })).code, 2); assert.equal(f.gets.length, 0);
});
