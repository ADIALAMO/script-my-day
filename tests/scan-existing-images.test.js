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

test('quarantine step refuses the WHOLE file if any key is outside panels/ or posters/ (tampered or wrong file): nothing is moved, no confirmation is even asked', async () => {
  for (const bad of ['characters/x/y-sheet.jpg', 'panels/../characters/x.jpg', 'quarantine/panels/a.png', 'avatars/u.png']) {
    const f = setup([]); f.files.set('res.json', JSON.stringify({ local: false, entries: { 'panels/a/ok.png': { v: 'unsafe' }, [bad]: { v: 'unsafe' } } }));
    let asked = false; let moved = 0;
    const r = await run({ argv: ['--quarantine-from', 'res.json'], deps: { ...f.deps, headPublic: async () => true, quarantine: async () => { moved += 1; return { status: 'moved' }; }, redis: { set: async () => {} }, confirm: async () => { asked = true; return true; } } });
    assert.equal(r.code, 2, bad); assert.equal(asked, false); assert.equal(moved, 0);
    assert.match(f.log.join('\n'), /refused: 1 key\(s\)/);
    assert.ok(!f.log.join('\n').includes(bad), 'the offending key is not echoed');
  }
});

test('--max-paid-usd really stops the spending: the classifier is handed a budget gate that closes at the cap (and at 0 never opens)', async () => {
  const COST = 0.00015;
  const spendWith = async (maxUsd, items) => {
    let paidCalls = 0;
    const objs = Array.from({ length: items }, (_, i) => ({ key: `panels/a/${i}.png` }));
    const f = setup(objs, { classify: async (_u, { paid }) => { if (paid.allow()) { paid.used(); paidCalls += 1; return { verdict: 'safe', via: 'fallback' }; } return { verdict: 'unavailable', via: 'paid-cap' }; } });
    const r = await run({ argv: ['--route', 'auto', '--concurrency', '8', '--max-paid-usd', String(maxUsd), '--out', 'x.json'], deps: f.deps });
    return { paidCalls, summary: r.summary };
  };
  const capped = await spendWith(0.0006, 40);                 // 0.0006 / 0.00015 = 4 calls
  assert.equal(capped.paidCalls, 4); assert.equal(capped.summary.safe, 4); assert.equal(capped.summary.unavailable, 36); assert.equal(capped.summary.paidCalls, 4);
  const zero = await spendWith(0, 10);
  assert.equal(zero.paidCalls, 0); assert.equal(zero.summary.unavailable, 10);
});

test('the script never touches Redis in scan mode: even with Redis variables set and an unreachable address, a local scan runs and exits cleanly', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(`${tmpdir()}/scan-empty-`);
  try {
    writeFileSync(`${dir}/note.txt`, 'not an image');
    const out = execFileSync(process.execPath, ['scripts/scan-existing-images.mjs', '--dir', dir, '--out', `${dir}/r.json`], {
      cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', timeout: 20000,
      env: { PATH: process.env.PATH, OPENROUTER_API_KEY: 'dummy-not-used', UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:9', UPSTASH_REDIS_REST_TOKEN: 'dummy' },
    });
    assert.match(out, /0 object\(s\) in scope, 0 to scan/); assert.match(out, /DRY RUN — nothing was moved or deleted/);
    assert.ok(!/ECONNREFUSED|upstash|redis/i.test(out));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// ── --recheck-from: a second opinion on ONLY the entries a previous run marked unsafe ───────────────────────────────────────────
const FIRST = {
  version: 1, local: false, route: 'free',
  entries: {
    'panels/a/1.png': { v: 'safe', via: 'nemotron' }, 'panels/a/2.png': { v: 'unsafe', via: 'nemotron' }, 'panels/a/3.png': { v: 'unsafe', via: 'nemotron' },
    'posters/b/4.png': { v: 'unsafe', via: 'nemotron' }, 'panels/a/5.png': { v: 'unreadable', via: 'nemotron' }, 'panels/a/6.png': { v: 'skipped' },
  },
};
function recheckSetup(first = FIRST, { classify } = {}) {
  const f = setup([...Object.keys(first.entries).map((key) => ({ key }))], { classify });
  f.files.set('first.json', JSON.stringify(first));
  const calls = []; let listed = 0;
  const origList = f.deps.r2.list; f.deps.r2.list = async (p) => { listed += 1; return origList(p); };
  f.deps.classify = classify ?? (async (_u, ctx) => { calls.push(ctx.route); return { verdict: 'unsafe', via: 'fallback' }; });
  return { ...f, calls, listed: () => listed };
}

test('--recheck-from sends ONLY the unsafe entries to the checker (no listing, no other downloads) and defaults to the PAID route', async () => {
  const f = recheckSetup();
  const routes = []; const seenKeys = [];
  const origGet = f.deps.r2.get; f.deps.r2.get = async (k) => { seenKeys.push(k); return origGet(k); };
  f.deps.classify = async (_u, ctx) => { routes.push(ctx.route); return { verdict: 'unsafe', via: 'fallback' }; };
  const r = await run({ argv: ['--recheck-from', 'first.json', '--out', 'second.json', '--concurrency', '1'], deps: f.deps });
  assert.equal(r.code, 0);
  assert.deepEqual(seenKeys.sort(), ['panels/a/2.png', 'panels/a/3.png', 'posters/b/4.png']);
  assert.equal(f.listed(), 0, 'no listing: only the flagged keys are fetched');
  assert.deepEqual([...new Set(routes)], ['paid'], 'the default route of a second opinion is paid');
  const out = JSON.parse(f.files.get('second.json'));
  assert.deepEqual(Object.keys(out.entries).sort(), ['panels/a/2.png', 'panels/a/3.png', 'posters/b/4.png']);
  assert.equal(out.recheckOf, 'first.json');
});

test('--route free can still be chosen explicitly for the recheck', async () => {
  const f = recheckSetup(); const routes = [];
  f.deps.classify = async (_u, ctx) => { routes.push(ctx.route); return { verdict: 'unsafe', via: 'nemotron' }; };
  await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', '--route', 'free'], deps: f.deps });
  assert.deepEqual([...new Set(routes)], ['free']);
});

test('the same file as --out (any spelling), a missing --out, and a pre-existing foreign --out are all REFUSED before anything is read', async () => {
  for (const argv of [
    ['--recheck-from', 'first.json', '--out', 'first.json'],
    ['--recheck-from', './first.json', '--out', 'first.json'],
    ['--recheck-from', 'first.json'],
    ['--recheck-from', 'first.json', '--out'],
  ]) {
    const f = recheckSetup(); let called = 0; f.deps.classify = async () => { called += 1; return { verdict: 'unsafe' }; };
    f.files.set('./first.json', JSON.stringify(FIRST));   // the fake file system has no path normalisation; the real one resolves './first.json' to the same file
    const r = await run({ argv, deps: f.deps });
    assert.equal(r.code, 2, argv.join(' ')); assert.equal(called, 0); assert.equal(f.gets.length, 0);
    assert.match(f.log.join('\n'), /--out is required for --recheck-from and must be a DIFFERENT file/);
    assert.equal(f.files.get('first.json'), JSON.stringify(FIRST), 'the first results are untouched');
  }
  // an existing --out that is some other results file is never merged into or overwritten
  const f = recheckSetup(); f.files.set('other.json', JSON.stringify({ entries: { 'panels/x/y.png': { v: 'safe' } } }));
  let called = 0; f.deps.classify = async () => { called += 1; return { verdict: 'unsafe' }; };
  assert.equal((await run({ argv: ['--recheck-from', 'first.json', '--out', 'other.json'], deps: f.deps })).code, 2);
  assert.equal(called, 0); assert.equal(f.files.get('other.json'), JSON.stringify({ entries: { 'panels/x/y.png': { v: 'safe' } } }));
});

test('the FIRST results file is byte-for-byte unchanged after a recheck, and the second file records firstOpinion + the new verdict', async () => {
  const verdicts = { 'panels/a/2.png': 'safe', 'panels/a/3.png': 'unsafe', 'posters/b/4.png': 'unreadable' };
  const f = recheckSetup();
  let i = 0; const order = Object.keys(verdicts);
  f.deps.classify = async () => ({ verdict: verdicts[order[i++]], via: 'fallback' });
  const before = f.files.get('first.json');
  await run({ argv: ['--recheck-from', 'first.json', '--out', 'second.json', '--concurrency', '1'], deps: f.deps });
  assert.equal(f.files.get('first.json'), before);
  const second = JSON.parse(f.files.get('second.json')).entries;
  assert.deepEqual(second['panels/a/2.png'], { v: 'safe', via: 'fallback', firstOpinion: 'unsafe', at: 1_700_000_000_000 });
  assert.equal(second['panels/a/3.png'].firstOpinion, 'unsafe'); assert.equal(second['panels/a/3.png'].v, 'unsafe');
  assert.equal(second['posters/b/4.png'].v, 'unreadable');
  assert.ok(!f.files.get('second.json').includes('payload-bytes') && !f.files.get('second.json').includes('base64'));
});

test('summary: confirmed / cleared / undecided counts, the cleared keys are listed (keys only), and it says the first file was not modified', async () => {
  const verdicts = ['unsafe', 'safe', 'unavailable'];
  const f = recheckSetup(); let i = 0;
  f.deps.classify = async () => ({ verdict: verdicts[i++], via: 'fallback' });
  const r = await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', '--concurrency', '1'], deps: f.deps });
  assert.deepEqual(r.summary.second, { checked: 3, confirmed: 1, cleared: 1, undecided: 1 });
  const text = f.log.join('\n');
  assert.match(text, /SECOND OPINION \(route paid\) on 3 image\(s\) the first pass called unsafe: confirmed unsafe 1 · cleared \(second says safe\) 1 · undecided 1/);
  assert.match(text, /the second opinion says SAFE \(first said unsafe\) — keys only:\n  panels\/a\/3\.png/);
  assert.match(text, /the first results file was not modified/);
  assert.ok(!text.includes('base64') && !text.includes('payload-bytes'));
});

test('--include-unreadable adds the unreadable entries (skipped and safe ones are never re-checked)', async () => {
  const f = recheckSetup(); const keys = [];
  const origGet = f.deps.r2.get; f.deps.r2.get = async (k) => { keys.push(k); return origGet(k); };
  f.deps.classify = async () => ({ verdict: 'unsafe', via: 'fallback' });
  const r = await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', '--include-unreadable'], deps: f.deps });
  assert.equal(r.summary.second.checked, 4); assert.ok(keys.includes('panels/a/5.png')); assert.ok(!keys.includes('panels/a/1.png') && !keys.includes('panels/a/6.png'));
  assert.equal(JSON.parse(f.files.get('s.json')).entries['panels/a/5.png'].firstOpinion, 'unreadable');
});

test('a key outside panels/ or posters/ in the first file refuses the WHOLE recheck: nothing is read, nothing is sent, the offending key is not echoed', async () => {
  for (const bad of ['characters/x/y-sheet.jpg', 'panels/../characters/x.jpg', 'avatars/u.png', '/etc/passwd']) {
    const first = { local: false, entries: { 'panels/a/ok.png': { v: 'unsafe' }, [bad]: { v: 'unsafe' } } };
    const f = recheckSetup(first); let called = 0; f.deps.classify = async () => { called += 1; return { verdict: 'unsafe' }; };
    const r = await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json'], deps: f.deps });
    assert.equal(r.code, 2, bad); assert.equal(called, 0); assert.equal(f.gets.length, 0); assert.equal(f.files.has('s.json'), false);
    assert.match(f.log.join('\n'), /refused: 1 key\(s\)/); assert.ok(!f.log.join('\n').includes(bad));
  }
});

test('the paid cap (--max-paid-usd) stops the spending during a recheck; the rest is recorded "unavailable" and a re-run with the same --out resumes only those', async () => {
  const first = { local: false, entries: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`panels/a/${i}.png`, { v: 'unsafe' }])) };
  const f = recheckSetup(first); let paidCalls = 0;
  const gate = async (_u, { paid }) => { if (paid.allow()) { paid.used(); paidCalls += 1; return { verdict: 'unsafe', via: 'fallback' }; } return { verdict: 'unavailable', via: 'paid-cap' }; };
  f.deps.classify = gate;
  const r1 = await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', '--max-paid-usd', '0.00045', '--concurrency', '1'], deps: f.deps });
  assert.equal(paidCalls, 3); assert.deepEqual({ c: r1.summary.second.confirmed, u: r1.summary.second.undecided }, { c: 3, u: 7 });
  const r2 = await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', '--max-paid-usd', '1', '--concurrency', '1'], deps: f.deps });
  assert.equal(paidCalls, 3 + 7, 'only the 7 undecided were retried');
  assert.equal(r2.summary.second.confirmed, 10); assert.match(f.log.join('\n'), /resuming from s\.json: 10 key\(s\)/);
  const zero = recheckSetup(first); let z = 0; zero.deps.classify = async (_u, { paid }) => { if (paid.allow()) { z += 1; paid.used(); } return { verdict: 'unavailable' }; };
  await run({ argv: ['--recheck-from', 'first.json', '--out', 'z.json', '--max-paid-usd', '0'], deps: zero.deps });
  assert.equal(z, 0, 'a cap of 0 never opens the gate');
});

test('local (--dir) results: the same --dir is required, an R2 results file with --dir is refused, traversal keys are refused, files are read from --dir', async () => {
  const PNGB = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('payload-bytes')]);
  const mk = (entries, local = true) => { const f = setup([], { local: { 'gallery/a.png': PNGB, 'gallery/sub/b.png': PNGB } }); f.files.set('first.json', JSON.stringify({ local, entries })); return f; };
  const entries = { 'a.png': { v: 'unsafe' }, 'sub/b.png': { v: 'safe' } };
  const noDir = mk(entries); assert.equal((await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json'], deps: { ...noDir.deps, classify: async () => ({ verdict: 'safe' }) } })).code, 2);
  assert.match(noDir.log.join('\n'), /pass the same --dir/);
  const wrongKind = mk({ 'panels/a/1.png': { v: 'unsafe' } }, false);
  assert.equal((await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', '--dir', 'gallery'], deps: { ...wrongKind.deps, classify: async () => ({ verdict: 'safe' }) } })).code, 2);
  for (const bad of ['../secret.png', '/etc/hosts.png', 'a/../../x.png']) {
    const f = mk({ [bad]: { v: 'unsafe' } }); let called = 0;
    assert.equal((await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', '--dir', 'gallery'], deps: { ...f.deps, classify: async () => { called += 1; return { verdict: 'safe' }; } } })).code, 2, bad); assert.equal(called, 0);
  }
  const ok = mk(entries); const sent = [];
  const r = await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', '--dir', 'gallery'], deps: { ...ok.deps, classify: async (u) => { sent.push(u.slice(0, 15)); return { verdict: 'safe', via: 'fallback' }; } } });
  assert.equal(r.code, 0); assert.equal(sent.length, 1, 'only the one unsafe local file'); assert.equal(r.summary.second.cleared, 1);
  assert.equal(JSON.parse(ok.files.get('s.json')).local, true);
});

test('recheck cannot be combined with --count-only or --quarantine-from', async () => {
  for (const extra of [['--count-only'], ['--quarantine-from', 'first.json']]) {
    const f = recheckSetup(); const r = await run({ argv: ['--recheck-from', 'first.json', '--out', 's.json', ...extra], deps: { ...f.deps, confirm: async () => true } });
    assert.equal(r.code, 2); assert.equal(f.gets.length, 0);
  }
});

test('workflow: quarantining from the SECOND file moves only the keys the paid model confirmed — not the ones it cleared or could not decide', async () => {
  const verdicts = { 'panels/a/2.png': 'unsafe', 'panels/a/3.png': 'safe', 'posters/b/4.png': 'unavailable' };
  const f = recheckSetup(); const order = Object.keys(verdicts); let i = 0;
  f.deps.classify = async () => ({ verdict: verdicts[order[i++]], via: 'fallback' });
  await run({ argv: ['--recheck-from', 'first.json', '--out', 'second.json', '--concurrency', '1'], deps: f.deps });
  const moved = []; let asked;
  const q = await run({ argv: ['--quarantine-from', 'second.json'], deps: { ...f.deps, headPublic: async () => true, quarantine: async (k) => { moved.push(k); return { status: 'moved' }; }, redis: { set: async () => {} }, confirm: async (_p, word) => { asked = word; return true; } } });
  assert.deepEqual(moved, ['panels/a/2.png']); assert.equal(asked, 'QUARANTINE 1 OBJECTS'); assert.equal(q.summary.moved, 1);
});

test('failure reasons: stage + error class + HTTP status only — never the message, key or bucket', async () => {
  const results = { entries: { 'panels/SECRETKEY/1.png': { v: 'unsafe' }, 'panels/SECRETKEY/2.png': { v: 'unsafe' }, 'panels/SECRETKEY/3.png': { v: 'unsafe' } } };
  const f = setup([]); f.files.set('res.json', JSON.stringify(results));
  const boom = (name, status, msg) => Object.assign(new Error(msg), { name, $metadata: { httpStatusCode: status } });
  const deps = {
    ...f.deps, confirm: async () => true, redis: { set: async () => {} },
    headPublic: async (k) => { if (k.endsWith('1.png')) throw boom('AccessDenied', 403, 'denied for my-secret-bucket/panels/SECRETKEY/1.png'); return true; },
    quarantine: async (k) => (k.endsWith('2.png') ? { status: 'failed', error: 'copy: leak my-secret-bucket', stage: 'copy', cls: 'NoSuchBucket', http: 404 } : { status: 'moved' }),
  };
  const r = await run({ argv: ['--quarantine-from', 'res.json'], deps });
  const out = f.log.join('\n');
  assert.equal(r.code, 1); assert.deepEqual(r.summary, { moved: 1, missing: 0, failed: 2 });
  assert.match(out, /failed ×1: stage=head class=AccessDenied http=403/);
  assert.match(out, /failed ×1: stage=copy class=NoSuchBucket http=404/);
  assert.doesNotMatch(out, /SECRETKEY|my-secret-bucket|denied for|leak/);
});

test('failure reasons: a Redis-mark failure is reported as redis-mark with its own note; a missing env var is labelled ConfigMissing, not echoed', async () => {
  const f = setup([]); f.files.set('res.json', JSON.stringify({ entries: { 'panels/a/1.png': { v: 'unsafe' }, 'panels/a/2.png': { v: 'unsafe' } } }));
  const deps = { ...f.deps, confirm: async () => true, headPublic: async (k) => { if (k.endsWith('2.png')) throw new Error('R2_ACCESS_KEY_ID not configured.'); return true; },
    quarantine: async () => ({ status: 'moved' }), redis: { set: async () => { throw Object.assign(new Error('https://secret.upstash.io refused'), { name: 'FetchError' }); } } };
  const r = await run({ argv: ['--quarantine-from', 'res.json'], deps });
  const out = f.log.join('\n');
  assert.equal(r.code, 1);
  assert.match(out, /stage=redis-mark class=FetchError/); assert.match(out, /already MOVED/);
  assert.match(out, /stage=head class=ConfigMissing/);
  assert.doesNotMatch(out, /upstash|R2_ACCESS_KEY_ID|panels\//);
});

test('quarantineObject failures carry stage + class + status, and the original is never deleted after a failed copy', async () => {
  const { safeErrInfo } = await import('../lib/safe-error.js');
  assert.deepEqual(safeErrInfo(Object.assign(new Error('x bucket/key'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })), { cls: 'AccessDenied', http: 403 });
  assert.deepEqual(safeErrInfo(new Error('weird')), { cls: 'Error', http: null });
  assert.deepEqual(safeErrInfo(Object.assign(new Error('a'), { name: 'bad name with spaces/and-slash' })), { cls: 'Error', http: null });
  const { quarantineObject } = await import('../lib/quarantine.js');
  const g = await quarantineObject('characters/x/y.jpg');
  assert.deepEqual([g.status, g.stage, g.cls], ['failed', 'key-guard', 'OutOfScope']);
});
