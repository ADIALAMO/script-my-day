import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.OBJECT_KEY_SECRET = 'unit-test-secret';
globalThis._redisClient = {};
const { run, parseArgs, keyOfPointerUrl } = await import('../scripts/quarantine-legacy-raw-selfies.mjs');
const { parseLegacyRaw } = await import('../lib/leftover-raw.js');
const { quarantineObject, quarantineLegacyRaw } = await import('../lib/quarantine.js');
const { StageError } = await import('../scripts/list-leftover-raw-selfies.mjs');

const raw = (id, stamp) => `characters/${id}-raw-${stamp}.jpg`;
const sheet = (id, stamp) => `characters/${id}-sheet-${stamp}.jpg`;
const SEG = 'a'.repeat(32); const UUID = '11111111-1111-1111-1111-111111111111';
const SECRETS = ['u:alice', 'u:bob', 'u:carol', 'u:dave', 'u:erin', '1700000001', '1700000002', 'pub-test.r2.dev'];

/** a world with 6 legacy raws, one per situation, plus noise that must never be touched */
function world(over = {}) {
  const objects = {
    [raw('u:alice', 1700000001)]: 100, [sheet('u:alice', 1700000001)]: 50,                       // eligible
    [raw('u:bob', 1700000001)]: 100,                                                              // no sheet
    [raw('u:carol', 1700000001)]: 100, [sheet('u:carol', 1700000001)]: 0,                         // empty sheet
    [raw('u:dave', 1700000001)]: 100, [sheet('u:dave', 1700000001)]: 50,                          // pointer names the raw
    [raw('u:erin', 1700000001)]: 100, [sheet('u:erin', 1700000001)]: 50,                          // pointer unreadable
    [raw('u:alice', 1700000002)]: 100, [sheet('u:alice', 1700000001)]: 50,                        // other stamp: NO sheet of the same upload
    [`characters/${SEG}/${UUID}-raw.jpg`]: 100, [`characters/${SEG}/${UUID}-sheet.jpg`]: 50,      // current format: never touched
    'panels/x/y.png': 5,
    ...over.objects,
  };
  const pointers = { 'u:dave': { url: `https://pub-test.r2.dev/${raw('u:dave', 1700000001)}`, styledUrl: `https://pub-test.r2.dev/${sheet('u:dave', 1700000001)}` }, ...over.pointers };
  const moves = []; const calls = { confirm: [], head: 0, pointer: 0 };
  const deps = {
    listPublic: async () => Object.entries(objects).map(([key, size]) => ({ key, size })),
    headPublic: async (k) => { calls.head++; if (over.headThrows) throw new Error('boom key=' + k); return { exists: k in objects, size: objects[k] ?? 0 }; },
    pointer: async (id) => { calls.pointer++; if (id === 'u:erin') throw new Error('redis down'); return pointers[id] ?? null; },
    move: async (k) => { moves.push(k); return over.move ? over.move(k) : { status: 'moved' }; },
    confirm: async (plan, word) => { calls.confirm.push(word); return over.confirmAnswer ?? true; },
    log: (s) => out.push(s),
  };
  const out = [];
  return { deps, out, moves, calls, objects };
}
const text = (w) => w.out.join('\n');

test('DRY RUN (default): counts every skip reason, moves nothing, asks nothing, prints no key / id / stamp / host', async () => {
  const w = world();
  const { code } = await run({ argv: [], deps: w.deps });
  assert.equal(code, 0); assert.equal(w.moves.length, 0); assert.equal(w.calls.confirm.length, 0);
  const t = text(w);
  assert.match(t, /legacy raw selfies found: 6/); assert.match(t, /eligible to move.*: 1/);
  assert.match(t, /skipped: 5/); assert.match(t, /no sheet of the same upload 2/); assert.match(t, /sheet is empty 1/); assert.match(t, /a Redis pointer names the raw 1/); assert.match(t, /could not be read \(fail closed\) 1/);
  assert.match(t, /DRY RUN: nothing was changed/);
  for (const s of SECRETS) assert.ok(!t.includes(s), `output leaks ${s}`);
  assert.ok(!/characters\//.test(t) && !/https?:/.test(t));
});

test('--apply needs the typed confirmation with the exact count; a wrong answer changes nothing', async () => {
  let w = world({ confirmAnswer: false });
  assert.equal((await run({ argv: ['--apply'], deps: w.deps })).code, 1);
  assert.deepEqual(w.calls.confirm, ['MOVE 1']); assert.equal(w.moves.length, 0); assert.match(text(w), /aborted: nothing was changed/);
  w = world();
  const { code } = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(code, 0); assert.deepEqual(w.moves, [raw('u:alice', 1700000001)]);
  assert.match(text(w), /moved: 1 · failed: 0 · skipped at re-check: 0/);
  for (const s of SECRETS) assert.ok(!text(w).includes(s), `output leaks ${s}`);
});

test('a pointer naming the raw by EITHER url or styledUrl blocks the move (fail closed); a pointer for another upload does not', async () => {
  for (const ptr of [{ url: `https://pub-test.r2.dev/${raw('u:alice', 1700000001)}` }, { styledUrl: `https://pub-test.r2.dev/${encodeURIComponent('characters/u:alice-raw-1700000001.jpg').replace('characters%2F', 'characters/')}` }]) {
    const w = world({ pointers: { 'u:alice': ptr } });
    await run({ argv: ['--apply'], deps: w.deps });
    assert.equal(w.moves.length, 0, JSON.stringify(ptr)); assert.match(text(w), /eligible to move.*: 0/);
  }
  const w = world({ pointers: { 'u:alice': { url: 'https://pub-test.r2.dev/characters/u:alice-sheet-1700000001.jpg', styledUrl: 'https://pub-test.r2.dev/characters/u:alice-sheet-1700000001.jpg' } } });
  await run({ argv: ['--apply'], deps: w.deps });
  assert.deepEqual(w.moves, [raw('u:alice', 1700000001)]);
});

test('the safety check is repeated right before each move: a sheet that vanished in between is skipped, not moved', async () => {
  const w = world(); let first = true;
  const orig = w.deps.confirm;
  w.deps.confirm = async (...a) => { const r = await orig(...a); delete w.objects[sheet('u:alice', 1700000001)]; return r; };   // changes after the plan was shown
  await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(w.moves.length, 0); assert.match(text(w), /skipped at re-check: 1 \(no sheet of the same upload 1\)/); void first;
});

test('failures are counted with stage + class + status only; 5 in a row stop the run; a missing quarantine bucket stops at once', async () => {
  const objects = {}; for (let i = 0; i < 8; i++) { objects[raw(`u:x${i}`, 1700000001)] = 10; objects[sheet(`u:x${i}`, 1700000001)] = 10; }
  let w = world({ objects, move: () => ({ status: 'failed', stage: 'copy', cls: 'AccessDenied', http: 403, error: 'copy: Access denied for bucket secret-bucket key characters/u:x1' }) });
  const r = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(r.code, 1); assert.equal(w.moves.length, 5, 'stopped after 5 in a row');
  assert.match(text(w), /failed ×5: stage=copy class=AccessDenied http=403/); assert.match(text(w), /stopped early/);
  assert.ok(!/secret-bucket|u:x1|Access denied for/.test(text(w)));
  w = world({ move: () => ({ status: 'not-configured' }) });
  assert.equal((await run({ argv: ['--apply'], deps: w.deps })).code, 1); assert.equal(w.moves.length, 1); assert.match(text(w), /quarantine bucket not set/);
  w = world({ move: () => { throw Object.assign(new Error('bucket my-b key characters/u:alice'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }); } });
  await run({ argv: ['--apply'], deps: w.deps }); assert.ok(!/my-b|alice/.test(text(w))); assert.match(text(w), /class=AccessDenied http=403/);
});

test('--limit caps the number of moves and the confirmation word; bad arguments are refused before anything happens', async () => {
  const objects = {}; for (let i = 0; i < 4; i++) { objects[raw(`u:y${i}`, 1700000001)] = 10; objects[sheet(`u:y${i}`, 1700000001)] = 10; }
  const w = world({ objects });
  await run({ argv: ['--apply', '--limit', '2'], deps: w.deps });
  assert.deepEqual(w.calls.confirm, ['MOVE 2']); assert.equal(w.moves.length, 2);
  for (const bad of [['--limit'], ['--limit=0'], ['--limit', 'x'], ['--delete'], ['--apply', 'now']]) {
    const v = world(); assert.equal((await run({ argv: bad, deps: v.deps })).code, 2, bad.join(' ')); assert.equal(v.calls.head, 0);
  }
  assert.ok(parseArgs(['--limit=3']).limit === 3 && parseArgs([]).apply === false);
});

test('a listing failure is a StageError(list) with a safe reason and class only', async () => {
  const w = world(); w.deps.listPublic = async () => { throw Object.assign(new Error('The bucket secret-bucket ... https://acct.r2.cloudflarestorage.com'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }); };
  await assert.rejects(run({ argv: [], deps: w.deps }), (e) => e instanceof StageError && e.stage === 'list' && !/secret-bucket|acct/.test(e.message) && e.info.cls === 'AccessDenied');
  const v = world({ headThrows: true });
  await run({ argv: [], deps: v.deps }); assert.match(text(v), /sheet check failed \(fail closed\) 6/); assert.ok(!/boom|key=/.test(text(v)));
});

test('only the legacy raw shape is parsed or quarantined: current-format, sheets, panels and traversal are out of scope for BOTH helpers in the right way', async () => {
  assert.deepEqual(parseLegacyRaw(raw('u:alice', 1700000001)), { id: 'u:alice', stamp: '1700000001', sheetKey: sheet('u:alice', 1700000001) });
  for (const k of [sheet('u:alice', 1), `characters/${SEG}/${UUID}-raw.jpg`, 'panels/a/b.png', 'characters/u:a-raw-1.jpg/../x', 'characters/u:a-raw-x.jpg', '', null]) assert.equal(parseLegacyRaw(k), null, String(k));
  for (const k of [`characters/${SEG}/${UUID}-raw.jpg`, sheet('u:alice', 1), 'panels/a/b.png', 'characters/../x-raw-1.jpg']) {
    const g = await quarantineLegacyRaw(k); assert.deepEqual([g.status, g.stage, g.cls], ['failed', 'key-guard', 'OutOfScope'], k);
  }
  const g = await quarantineObject(raw('u:alice', 1700000001));   // the app-wide helper still refuses legacy keys
  assert.deepEqual([g.status, g.stage, g.cls], ['failed', 'key-guard', 'OutOfScope']);
  assert.equal(keyOfPointerUrl('https://h.example/characters/u%3Aalice-raw-1700000001.jpg'), raw('u:alice', 1700000001));
  assert.equal(keyOfPointerUrl('nope'), null);
});

test('the script never writes to Redis and never deletes except through the quarantine helper', () => {
  const src = readFileSync(new URL('../scripts/quarantine-legacy-raw-selfies.mjs', import.meta.url), 'utf8');
  assert.ok(!/redis\.(set|del|incr|expire|sadd|pipeline|hset)/.test(src), 'Redis is only read');
  assert.ok(!/DeleteObjectCommand|CopyObjectCommand|PutObjectCommand/.test(src), 'all writes go through lib/quarantine.js');
  assert.match(src, /quarantineLegacyRaw/);
});
