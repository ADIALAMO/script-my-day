import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.OBJECT_KEY_SECRET = 'unit-test-secret';
globalThis._redisClient = {};
const M = await import('../scripts/migrate-legacy-character-pointers.mjs');
const { run, parseArgs, makeRedisDeps, migratedForm, CAS_LUA, BACKUP_PREFIX, BACKUP_TTL_SEC } = M;
const { StageError } = await import('../scripts/list-leftover-raw-selfies.mjs');

const H = 'https://pub-test.r2.dev/';
const raw = (id, st = 1700000001) => `characters/${id}-raw-${st}.jpg`;
const sheet = (id, st = 1700000001) => `characters/${id}-sheet-${st}.jpg`;
const ptr = (id, o = {}) => JSON.stringify({ url: H + raw(id), styledUrl: H + sheet(id), createdAt: 1760000000, status: 'ready', consentAt: 1760000000, ...o });
const SECRETS = ['u:alice', 'u:bob', 'u:carol', 'u:dave', 'u:erin', 'u:fred', '1700000001', 'pub-test.r2.dev', 'characters/'];

/** an in-memory Redis + R2 with the semantics the script relies on (atomic compare-and-set that KEEPS the ttl) */
function world(init = {}) {
  const redis = new Map(Object.entries({
    'character:u:alice': ptr('u:alice'),                                           // migrate
    'character:u:bob': ptr('u:bob', { url: H + sheet('u:bob') }),                  // already migrated
    'character:u:carol': ptr('u:carol'),                                           // sheet empty
    'character:u:dave': ptr('u:dave', { styledUrl: H + raw('u:dave') }),           // styledUrl IS the raw
    'character:u:fred': ptr('u:fred', { url: H + raw('u:fred', 1600000000), styledUrl: H + sheet('u:fred', 1600000000) }),   // pointer is for another (older) upload
    ...init.redis,
  }));
  const ttl = new Map([...redis.keys()].map((k) => [k, 7_000_000]));
  const objects = new Map(Object.entries({
    [raw('u:alice')]: 10, [sheet('u:alice')]: 50, [raw('u:bob')]: 10, [sheet('u:bob')]: 50, [raw('u:carol')]: 10, [sheet('u:carol')]: 0,
    [raw('u:dave')]: 10, [sheet('u:dave')]: 50, [raw('u:erin')]: 10,                                                // erin: no pointer, no sheet
    [raw('u:fred')]: 10, [sheet('u:fred')]: 50,                                                                      // fred's pointer names an OLDER upload whose objects are gone
    [`characters/${'a'.repeat(32)}/11111111-1111-1111-1111-111111111111-raw.jpg`]: 5, 'panels/x/y.png': 5, ...init.objects,
  }));
  const backups = new Map(); const out = []; const calls = { confirm: [], writes: [], backups: [] };
  const hooks = {};
  const deps = {
    listPublic: async () => [...objects.keys()].map((key) => ({ key })),
    headPublic: async (k) => ({ exists: objects.has(k), size: objects.get(k) ?? 0 }),
    readPointer: async (id) => { if (hooks.readThrows) throw new Error(`redis down for ${id}`); return redis.has(`character:${id}`) ? redis.get(`character:${id}`) : null; },
    saveBackup: async (runId, id, rawv) => { if (hooks.backupFails) return false; calls.backups.push(id); hooks.afterBackup?.(id); backups.set(`${runId}:${id}`, rawv); return true; },
    casWrite: async (id, expected, next) => {
      calls.writes.push(id);
      if (hooks.casThrows) throw Object.assign(new Error(`EVAL failed for character:${id} token=secret`), { name: 'UpstashError' });
      const k = `character:${id}`; const cur = redis.get(k);
      if (cur === undefined) return 'missing'; if (cur !== expected) return 'changed';
      redis.set(k, hooks.writeGarbage ? '{"x":1}' : next); return 'ok';            // ttl map untouched = KEEPTTL
    },
    scanBackups: async (runId) => [...backups].filter(([k]) => k.startsWith(`${runId}:`)).map(([k, v]) => ({ id: k.slice(runId.length + 1), raw: v })),
    newRunId: () => 'testrun01', confirm: async (plan, word) => { calls.confirm.push(word); return hooks.answer ?? true; }, log: (s) => out.push(s),
  };
  return { deps, redis, ttl, objects, backups, out, calls, hooks, text: () => out.join('\n') };
}
const noLeak = (w) => { for (const s of SECRETS) assert.ok(!w.text().includes(s), `output leaks ${s}`); };

test('classification: exactly the pointers with url=raw and styledUrl=its non-empty sheet are migrated; everything else is counted, nothing is written in a dry run', async () => {
  const w = world();
  const before = new Map(w.redis);
  assert.equal((await run({ argv: [], deps: w.deps })).code, 0);
  const t = w.text();
  assert.match(t, /legacy raw selfies found: 6/);                   // alice, bob, carol, dave, erin, fred
  assert.match(t, /pointers to migrate .*: 1\b/);
  assert.match(t, /already migrated 1/); assert.match(t, /no pointer 1/); assert.match(t, /sheet missing or empty 1/); assert.match(t, /styledUrl is the raw .*1/); assert.match(t, /pointer is for another upload 1/);
  assert.match(t, /not migrated: 5/);
  assert.deepEqual([...w.redis], [...before]); assert.equal(w.calls.writes.length, 0); assert.equal(w.calls.confirm.length, 0); assert.equal(w.calls.backups.length, 0);
  assert.match(t, /DRY RUN/); noLeak(w);
});

test('classification of odd pointers: malformed JSON, unexpected shape, unreadable (fail closed) and a failing sheet check are skipped, never rewritten', async () => {
  let w = world({ redis: { 'character:u:alice': '{not json' } });
  await run({ argv: ['--apply'], deps: w.deps }); assert.match(w.text(), /pointer is not valid JSON 1/); assert.equal(w.calls.writes.length, 0);
  w = world({ redis: { 'character:u:alice': ptr('u:alice', { url: H + raw('u:alice'), styledUrl: H + 'characters/other-sheet-5.jpg' }) } });
  await run({ argv: [], deps: w.deps }); assert.match(w.text(), /unexpected pointer shape 1/);
  w = world(); w.hooks.readThrows = true;
  await run({ argv: ['--apply'], deps: w.deps }); assert.match(w.text(), /could not be read \(fail closed\) 6/); assert.equal(w.calls.writes.length, 0); noLeak(w);
  w = world(); w.deps.headPublic = async () => { throw new Error('boom'); };
  await run({ argv: [], deps: w.deps }); assert.match(w.text(), /sheet check failed \(fail closed\) 2/);
});

test('APPLY: typed MIGRATE <count>; backup first; compare-and-set; TTL untouched; read-back verified; other users\' pointers untouched; output has no ids/keys/stamps', async () => {
  let w = world(); w.hooks.answer = false;
  assert.equal((await run({ argv: ['--apply'], deps: w.deps })).code, 1);
  assert.deepEqual(w.calls.confirm, ['MIGRATE 1']); assert.equal(w.calls.writes.length, 0); assert.equal(w.calls.backups.length, 0); assert.match(w.text(), /aborted: nothing was changed/);
  w = world();
  const others = Object.fromEntries([...w.redis].filter(([k]) => k !== 'character:u:alice'));
  const original = w.redis.get('character:u:alice');
  const r = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(r.code, 0); assert.equal(r.runId, 'testrun01');
  assert.deepEqual(w.calls.backups, ['u:alice']); assert.equal(w.backups.get('testrun01:u:alice'), original, 'the original is saved verbatim');
  const now = JSON.parse(w.redis.get('character:u:alice'));
  assert.equal(now.url, now.styledUrl); assert.equal(now.styledUrl, H + sheet('u:alice')); assert.equal(now.createdAt, 1760000000); assert.equal(now.status, 'ready'); assert.equal(now.consentAt, 1760000000);
  assert.equal(w.ttl.get('character:u:alice'), 7_000_000, 'TTL preserved');
  for (const [k, v] of Object.entries(others)) assert.equal(w.redis.get(k), v, `${k} untouched`);
  assert.match(w.text(), /run id: testrun01/); assert.match(w.text(), /migrated: 1 · failed: 0 · skipped at re-check: 0/); noLeak(w);
});

test('IDEMPOTENT: a second run finds nothing to migrate and writes nothing; --limit caps; bad arguments are refused first', async () => {
  const w = world();
  await run({ argv: ['--apply'], deps: w.deps });
  const w2Writes = w.calls.writes.length; w.out.length = 0;
  const again = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(again.code, 0); assert.match(w.text(), /pointers to migrate .*: 0/); assert.match(w.text(), /nothing to migrate/); assert.match(w.text(), /already migrated 2/);
  assert.equal(w.calls.writes.length, w2Writes);
  const many = {}; const objs = {};
  for (const n of ['g1', 'g2', 'g3']) { many[`character:u:${n}`] = ptr(`u:${n}`); objs[raw(`u:${n}`)] = 10; objs[sheet(`u:${n}`)] = 50; }
  const l = world({ redis: many, objects: objs });
  await run({ argv: ['--apply', '--limit', '2'], deps: l.deps });
  assert.deepEqual(l.calls.confirm, ['MIGRATE 2']); assert.equal(l.calls.writes.length, 2);
  for (const bad of [['--limit'], ['--limit=0'], ['--delete'], ['--rollback'], ['--rollback', 'x'], ['--rollback', 'abc123', '--limit', '2'], ['now']]) {
    const v = world(); assert.equal((await run({ argv: bad, deps: v.deps })).code, 2, bad.join(' ')); assert.equal(v.calls.writes.length, 0);
  }
  assert.ok(parseArgs(['--rollback=abcdef12', '--apply']).rollback === 'abcdef12');
});

test('RACE: a user who re-uploads between the plan and the write keeps their NEW pointer (re-check and compare-and-set both refuse)', async () => {
  // (1) changes after the plan is shown, before the re-check
  let w = world(); const fresh = ptr('u:alice', { url: H + sheet('u:alice', 1800000000), styledUrl: H + sheet('u:alice', 1800000000), createdAt: 1800000000 });
  const orig = w.deps.confirm; w.deps.confirm = async (...a) => { const r = await orig(...a); w.redis.set('character:u:alice', fresh); return r; };
  await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(w.redis.get('character:u:alice'), fresh); assert.equal(w.calls.writes.length, 0); assert.match(w.text(), /pointer changed since the plan 1/);
  // (2) changes AFTER the re-check, during the backup, i.e. right before the compare-and-set: the CAS itself must refuse
  w = world(); w.hooks.afterBackup = () => w.redis.set('character:u:alice', fresh);
  const r = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(w.calls.writes.length, 1, 'the CAS was attempted'); assert.equal(w.redis.get('character:u:alice'), fresh, 'and refused: the newer pointer survives');
  assert.match(w.text(), /migrated: 0 · failed: 0 · skipped at re-check: 1/); assert.equal(r.code, 0);
  // (3) the pointer expired between re-check and write
  w = world(); w.hooks.afterBackup = () => w.redis.delete('character:u:alice');
  await run({ argv: ['--apply'], deps: w.deps }); assert.equal(w.redis.has('character:u:alice'), false, 'an expired pointer is never resurrected');
});

test('failures: no backup = no write; a throwing write or a mismatching read-back is counted with stage/class only; 5 in a row stop the run', async () => {
  let w = world(); w.hooks.backupFails = true;
  await run({ argv: ['--apply'], deps: w.deps }); assert.equal(w.calls.writes.length, 0); assert.match(w.text(), /backup could not be saved \(nothing written\) 1/); assert.match(w.text(), /stage=backup/);
  w = world(); w.hooks.casThrows = true;
  assert.equal((await run({ argv: ['--apply'], deps: w.deps })).code, 1); assert.match(w.text(), /failed ×1: stage=write class=UpstashError/); assert.ok(!/EVAL failed|token=secret|u:alice/.test(w.text()));
  w = world(); w.hooks.writeGarbage = true;
  assert.equal((await run({ argv: ['--apply'], deps: w.deps })).code, 1); assert.match(w.text(), /stage=verify/);
  const many = {}; const objs = {};
  for (let i = 0; i < 8; i++) { many[`character:u:h${i}`] = ptr(`u:h${i}`); objs[raw(`u:h${i}`)] = 10; objs[sheet(`u:h${i}`)] = 50; }
  w = world({ redis: many, objects: objs }); w.hooks.casThrows = true;
  await run({ argv: ['--apply'], deps: w.deps }); assert.equal(w.calls.writes.length, 5); assert.match(w.text(), /stopped early/); noLeak(w);
});

test('ROLLBACK: dry run counts; --apply needs ROLLBACK <count>; restores via compare-and-set ONLY when the pointer is still what the migration wrote', async () => {
  const w = world();
  await run({ argv: ['--apply'], deps: w.deps });
  const original = w.backups.get('testrun01:u:alice'); const migrated = w.redis.get('character:u:alice');
  assert.notEqual(original, migrated);
  w.out.length = 0; const writes = w.calls.writes.length;
  assert.equal((await run({ argv: ['--rollback', 'testrun01'], deps: w.deps })).code, 0);
  assert.match(w.text(), /backups found for this run: 1/); assert.match(w.text(), /pointers to restore: 1/); assert.match(w.text(), /DRY RUN/); assert.equal(w.redis.get('character:u:alice'), migrated); assert.equal(w.calls.writes.length, writes);
  w.hooks.answer = false; assert.equal((await run({ argv: ['--rollback', 'testrun01', '--apply'], deps: w.deps })).code, 1);
  assert.equal(w.calls.confirm.at(-1), 'ROLLBACK 1'); assert.equal(w.redis.get('character:u:alice'), migrated);
  w.hooks.answer = true; w.out.length = 0;
  assert.equal((await run({ argv: ['--rollback', 'testrun01', '--apply'], deps: w.deps })).code, 0);
  assert.equal(w.redis.get('character:u:alice'), original, 'restored byte for byte'); assert.equal(w.ttl.get('character:u:alice'), 7_000_000); assert.match(w.text(), /restored: 1 · failed: 0/); noLeak(w);
  // idempotent: running it again changes nothing
  w.out.length = 0; await run({ argv: ['--rollback', 'testrun01', '--apply'], deps: w.deps });
  assert.match(w.text(), /already restored 1/); assert.equal(w.redis.get('character:u:alice'), original);
  // a different run id has nothing
  w.out.length = 0; await run({ argv: ['--rollback', 'nope123456'], deps: w.deps }); assert.match(w.text(), /backups found for this run: 0/);
});

test('ROLLBACK never overwrites a newer upload or resurrects an expired pointer', async () => {
  const w = world();
  await run({ argv: ['--apply'], deps: w.deps });
  const newer = ptr('u:alice', { url: H + sheet('u:alice', 1800000000), styledUrl: H + sheet('u:alice', 1800000000) });
  w.redis.set('character:u:alice', newer);
  await run({ argv: ['--rollback', 'testrun01', '--apply'], deps: w.deps });
  assert.equal(w.redis.get('character:u:alice'), newer); assert.match(w.text(), /pointer changed since the migration/);
  w.redis.delete('character:u:alice'); w.out.length = 0;
  await run({ argv: ['--rollback', 'testrun01', '--apply'], deps: w.deps });
  assert.equal(w.redis.has('character:u:alice'), false); assert.match(w.text(), /pointer expired or removed/);
  // CAS race during the rollback itself
  const v = world(); await run({ argv: ['--apply'], deps: v.deps });
  const base = v.deps.casWrite; v.deps.casWrite = async (id, e, n) => { v.redis.set('character:u:alice', newer); return base(id, e, n); };
  v.out.length = 0; await run({ argv: ['--rollback', 'testrun01', '--apply'], deps: v.deps });
  assert.equal(v.redis.get('character:u:alice'), newer); assert.match(v.text(), /changed meanwhile \(left alone\): 1/);
});

test('real Redis wiring: Lua compare-and-set with KEEPTTL, backup with a 30-day TTL (NX), string-exact reads, scan by run id', async () => {
  assert.match(CAS_LUA, /KEEPTTL/); assert.match(CAS_LUA, /cur ~= ARGV\[1\]/); assert.match(CAS_LUA, /return 'missing'/);
  const store = new Map(); const ttl = new Map(); const log = [];
  const fake = {
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v, o = {}) { log.push(['set', k, o]); if (o.nx && store.has(k)) return null; store.set(k, v); if (o.ex) ttl.set(k, o.ex); return 'OK'; },
    async eval(script, keys, args) {
      assert.equal(script, CAS_LUA); assert.equal(keys.length, 1); assert.equal(args.length, 2);
      const cur = store.get(keys[0]); if (cur === undefined) return 'missing'; if (cur !== args[0]) return 'changed'; store.set(keys[0], args[1]); return 'ok';   // KEEPTTL: ttl map untouched
    },
    async scan(cursor, { match }) { const re = new RegExp(`^${match.replace('*', '.*')}$`); return ['0', [...store.keys()].filter((k) => re.test(k))]; },
  };
  const d = makeRedisDeps(fake);
  store.set('character:u:alice', 'A'); ttl.set('character:u:alice', 999);
  assert.equal(await d.readPointer('u:alice'), 'A'); assert.equal(await d.readPointer('u:zed'), null);
  assert.equal(await d.casWrite('u:alice', 'X', 'B'), 'changed'); assert.equal(await d.casWrite('u:alice', 'A', 'B'), 'ok'); assert.equal(store.get('character:u:alice'), 'B'); assert.equal(ttl.get('character:u:alice'), 999);
  assert.equal(await d.casWrite('u:zed', 'A', 'B'), 'missing');
  assert.equal(await d.saveBackup('run00001', 'u:alice', 'A'), true);
  assert.deepEqual(log.at(-1), ['set', `${BACKUP_PREFIX}run00001:u:alice`, { nx: true, ex: BACKUP_TTL_SEC }]); assert.equal(BACKUP_TTL_SEC, 30 * 86400);
  assert.equal(await d.saveBackup('run00001', 'u:alice', 'A'), true, 'a repeated save of the same backup is fine (NX)');
  assert.deepEqual(await d.scanBackups('run00001'), [{ id: 'u:alice', raw: 'A' }]); assert.deepEqual(await d.scanBackups('other999'), []);
});

test('the script reads R2 only (list + head), writes only the pointer through the Lua CAS and its own backup keys, and never touches objects', () => {
  const src = readFileSync(new URL('../scripts/migrate-legacy-character-pointers.mjs', import.meta.url), 'utf8');
  assert.ok(!/PutObject|DeleteObject|CopyObject|GetObjectCommand/.test(src), 'no R2 writes at all');
  assert.ok(!/redis\.(del|incr|expire|sadd|pipeline|hset)\(/.test(src), 'only get / set(backup) / eval(CAS) / scan');
  assert.equal((src.match(/redis\.set\(/g) ?? []).length, 1); assert.match(src, /redis\.set\(`\$\{BACKUP_PREFIX\}/);
  assert.match(src, /automaticDeserialization: false/);
  assert.equal(migratedForm(ptr('u:a')), JSON.stringify({ ...JSON.parse(ptr('u:a')), url: H + sheet('u:a') }));
});

test('a listing failure is a StageError(list) with a class only', async () => {
  const w = world(); w.deps.listPublic = async () => { throw Object.assign(new Error('bucket my-secret https://acct.r2.cloudflarestorage.com'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } }); };
  await assert.rejects(run({ argv: [], deps: w.deps }), (e) => e instanceof StageError && e.stage === 'list' && !/my-secret|acct/.test(e.message) && e.info.cls === 'AccessDenied');
});
