import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

globalThis._redisClient = {};
const M = await import('../scripts/migrate-waitlist-records.mjs');
const { run, parseArgs, makeRedisDeps, makeFileDeps, CAS_LUA } = M;
const W = await import('../lib/waitlist.js');

const NOW = Date.UTC(2026, 9, 20);
const T1 = Date.UTC(2026, 5, 2, 10, 0, 0);
const EMAILS = ['alice@example.com', 'bob@example.org', 'carol@example.net'];

/** in-memory Redis + file system with the semantics the script relies on (atomic compare-and-set) */
function world(extra = {}) {
  const redis = new Map(Object.entries({
    'waitlist:alice@example.com': String(T1),                                              // legacy
    'waitlist:bob@example.org': String(T1 + 1000),                                         // legacy
    'waitlist:carol@example.net': JSON.stringify(W.buildRecord({ email: 'carol@example.net', lang: 'en', now: new Date(T1) })),   // already v1
    'waitlist:not an email': '1',                                                          // not waitlist:<email>
    'waitlist:weird@example.com': 'hello',                                                 // unexpected value
    ...extra.redis,
  }));
  const calls = { writes: [], order: [] };
  const files = new Map();
  const lines = [];
  const deps = {
    scanKeys: async () => [...redis.keys()],
    readRaw: async (k) => { if (extra.unreadable?.has(k)) throw new Error(`boom ${k}`); return redis.has(k) ? redis.get(k) : null; },
    casWrite: async (k, exp, nw) => {
      if (extra.failWrites) throw Object.assign(new Error('x'), { name: 'UpstashError' });
      if (!redis.has(k)) return 'missing'; if (redis.get(k) !== exp) return 'changed';
      redis.set(k, nw); calls.writes.push(k); calls.order.push('write'); return 'ok';
    },
    writeBackup: async (dir, runId, data) => { if (extra.backupFails) throw new Error('disk full'); calls.order.push('backup'); files.set(`${dir}/waitlist-backup-${runId}.json`, JSON.parse(JSON.stringify(data))); },
    readBackup: async (f) => { if (!files.has(f)) throw new Error('nope'); return files.get(f); },
    newRunId: () => 'run1', now: () => NOW, confirm: async (plan, word) => { calls.confirmed = word; return extra.confirm !== false; },
    log: (s) => lines.push(s),
  };
  return { redis, calls, files, lines, deps };
}
const noEmails = (lines) => { const t = lines.join('\n'); for (const e of EMAILS) assert.ok(!t.includes(e.split('@')[0]), `output leaked ${e}`); assert.ok(!t.includes('@'), 'output contains an address'); };

test('parseArgs: dry run by default, --dry-run accepted, --apply/--backup-dir/--rollback parsed, nonsense rejected', () => {
  assert.deepEqual(parseArgs([]), { apply: false, backupDir: './waitlist-backups', rollback: null });
  assert.equal(parseArgs(['--dry-run']).apply, false);
  assert.equal(parseArgs(['--apply', '--backup-dir', '/tmp/x']).backupDir, '/tmp/x');
  assert.equal(parseArgs(['--rollback', 'f.json']).rollback, 'f.json');
  for (const bad of [['--wat'], ['--backup-dir'], ['--rollback'], ['--apply', '--dry-run']]) assert.ok(parseArgs(bad).error, bad.join(' '));
});

test('DRY RUN (default): counts only, nothing written, no backup, no confirmation asked, no e-mail printed', async () => {
  const w = world();
  const before = JSON.stringify([...w.redis]);
  const r = await run({ argv: [], deps: w.deps });
  assert.equal(r.code, 0); assert.equal(JSON.stringify([...w.redis]), before); assert.equal(w.calls.writes.length, 0); assert.equal(w.files.size, 0); assert.equal(w.calls.confirmed, undefined);
  const out = w.lines.join('\n');
  assert.match(out, /waitlist keys found: 5/); assert.match(out, /legacy records to rewrite: 2/); assert.match(out, /already in the new shape 1/); assert.match(out, /key is not waitlist:<email> 1/); assert.match(out, /unreadable or unexpected shape 1/); assert.match(out, /DRY RUN/);
  noEmails(w.lines);
});

test('APPLY: backup is written BEFORE the first write; legacy records get the v1 shape with the ORIGINAL timestamp as createdAt; others untouched; read-back verified', async () => {
  const w = world();
  const r = await run({ argv: ['--apply', '--backup-dir', '/b'], deps: w.deps });
  assert.equal(r.code, 0); assert.equal(w.calls.confirmed, 'MIGRATE 2');
  assert.equal(w.calls.order[0], 'backup'); assert.deepEqual(w.calls.order, ['backup', 'write', 'write']);
  const a = JSON.parse(w.redis.get('waitlist:alice@example.com'));
  assert.deepEqual(a, { v: 1, email: 'alice@example.com', createdAt: new Date(T1).toISOString(), locale: null, source: 'legacy-waitlist', userId: null, consentVersion: null });
  assert.equal(JSON.parse(w.redis.get('waitlist:bob@example.org')).createdAt, new Date(T1 + 1000).toISOString());
  assert.equal(w.redis.get('waitlist:weird@example.com'), 'hello'); assert.equal(w.redis.get('waitlist:not an email'), '1');
  const [file] = [...w.files.values()];
  assert.equal(file.runId, 'run1'); assert.equal(file.entries.length, 2);
  assert.deepEqual(file.entries.map((e) => e.original).sort(), [String(T1), String(T1 + 1000)].sort());
  assert.match(w.lines.join('\n'), /migrated: 2 · failed: 0/); noEmails(w.lines.filter((l) => !/^rollback:/.test(l)));
});

test('APPLY is idempotent: a second run finds nothing to rewrite', async () => {
  const w = world(); await run({ argv: ['--apply'], deps: w.deps });
  const snapshot = JSON.stringify([...w.redis]); w.lines.length = 0; w.calls.order.length = 0;
  const r = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(r.code, 0); assert.match(w.lines.join('\n'), /legacy records to rewrite: 0/); assert.equal(JSON.stringify([...w.redis]), snapshot); assert.deepEqual(w.calls.order, []);
});

test('implausible timestamp: still migrated, createdAt is null, and it is counted', async () => {
  const w = world({ redis: { 'waitlist:old@example.com': '123456789', 'waitlist:future@example.com': String(NOW + 10 * 86400000) } });
  await run({ argv: [], deps: w.deps });
  assert.match(w.lines.join('\n'), /legacy records to rewrite: 4 \(2 with a missing or implausible timestamp/);
  await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(JSON.parse(w.redis.get('waitlist:old@example.com')).createdAt, null);
});

test('refused confirmation: nothing is written and no backup either; a failing backup aborts before any write', async () => {
  let w = world({ confirm: false });
  assert.equal((await run({ argv: ['--apply'], deps: w.deps })).code, 1); assert.equal(w.calls.writes.length, 0); assert.equal(w.files.size, 0);
  w = world({ backupFails: true });
  const r = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(r.code, 1); assert.equal(w.calls.writes.length, 0); assert.match(w.lines.join('\n'), /backup could not be written/); assert.equal(w.redis.get('waitlist:alice@example.com'), String(T1));
});

test('compare-and-set: a record that changed after the plan is left alone (counted), the others are migrated', async () => {
  const w = world();
  const realRead = w.deps.readRaw; let reads = 0;
  w.deps.readRaw = async (k) => { const v = await realRead(k); if (k === 'waitlist:alice@example.com' && ++reads === 2) { w.redis.set(k, JSON.stringify(W.buildRecord({ email: 'alice@example.com', lang: 'he', now: new Date(NOW) }))); return String(T1); } return v; };   // changes between the plan read and the re-check
  const r = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(r.code, 0); assert.match(w.lines.join('\n'), /migrated: 1 · failed: 0 · skipped at re-check: 1 \(value changed since the plan 1\)/);
  assert.equal(JSON.parse(w.redis.get('waitlist:alice@example.com')).source, 'pro-modal', 'the newer record is untouched');
});

test('5 failed writes in a row stop the run with a non-zero code and a safe message (no key, no address)', async () => {
  const redis = {}; for (let i = 0; i < 8; i++) redis[`waitlist:p${i}@example.com`] = String(T1 + i);
  const w = world({ redis, failWrites: true });
  const r = await run({ argv: ['--apply'], deps: w.deps });
  assert.equal(r.code, 1); assert.match(w.lines.join('\n'), /stopped early after 5 failures in a row/); assert.match(w.lines.join('\n'), /stage=write class=UpstashError/);
  assert.ok(!w.lines.join('\n').includes('example.com'));
});

test('ROLLBACK: dry run by default; --apply restores the originals only where the key still holds the migrated value', async () => {
  const w = world(); await run({ argv: ['--apply', '--backup-dir', '/b'], deps: w.deps });
  const file = '/b/waitlist-backup-run1.json';
  w.redis.set('waitlist:bob@example.org', JSON.stringify(W.buildRecord({ email: 'bob@example.org', lang: 'en', now: new Date(NOW) })));   // bob re-signed up after the migration (a newer record)
  w.lines.length = 0;
  let r = await run({ argv: ['--rollback', file], deps: w.deps });
  assert.equal(r.code, 0); assert.match(w.lines.join('\n'), /records to restore: 1/); assert.match(w.lines.join('\n'), /changed since the migration \(left alone\) 1/); assert.match(w.lines.join('\n'), /DRY RUN/);
  assert.notEqual(w.redis.get('waitlist:alice@example.com'), String(T1), 'dry run restored nothing');
  r = await run({ argv: ['--rollback', file, '--apply'], deps: w.deps });
  assert.equal(r.code, 0); assert.equal(w.calls.confirmed, 'ROLLBACK 1');
  assert.equal(w.redis.get('waitlist:alice@example.com'), String(T1), 'alice restored to the bare timestamp');
  assert.equal(JSON.parse(w.redis.get('waitlist:bob@example.org')).source, 'pro-modal', "bob's newer record was not touched");
  w.lines.length = 0; await run({ argv: ['--rollback', file], deps: w.deps });
  assert.match(w.lines.join('\n'), /already restored 1/); noEmails(w.lines);
});

test('rollback rejects a file that is not a waitlist backup, and an unreadable file', async () => {
  const w = world(); w.files.set('bad.json', { entries: [{ key: 'characters/x', original: 'a', migrated: 'b' }] }); w.files.set('empty.json', {});
  assert.equal((await run({ argv: ['--rollback', 'bad.json', '--apply'], deps: w.deps })).code, 2);
  assert.equal((await run({ argv: ['--rollback', 'empty.json'], deps: w.deps })).code, 2);
  assert.equal((await run({ argv: ['--rollback', 'missing.json'], deps: w.deps })).code, 2);
  assert.equal(w.calls.writes.length, 0);
});

test('file backup: written with mode 0600 in a fresh folder, never overwrites an existing file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wl-backup-')); const sub = path.join(dir, 'nested');
  try {
    const f = makeFileDeps(); await f.writeBackup(sub, 'abc', { runId: 'abc', entries: [] });
    const file = path.join(sub, 'waitlist-backup-abc.json');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(await f.readBackup(file), { runId: 'abc', entries: [] });
    await assert.rejects(() => f.writeBackup(sub, 'abc', { runId: 'abc', entries: ['x'] }));
    assert.deepEqual(await f.readBackup(file), { runId: 'abc', entries: [] }, 'first backup intact');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Redis wiring: scan pages through the cursor, reads the stored string, and the CAS is a Lua compare-and-set', async () => {
  const keys = ['waitlist:a@b.com', 'waitlist:c@d.com', 'waitlist:e@f.com'];
  const calls = [];
  const fake = {
    scan: async (cursor, opts) => { calls.push([cursor, opts]); return cursor === '0' ? ['7', keys.slice(0, 2)] : ['0', keys.slice(2)]; },
    get: async (k) => (k === 'waitlist:a@b.com' ? 1760000000000 : null),
    eval: async (lua, ks, args) => { calls.push(['eval', lua, ks, args]); return 'ok'; },
  };
  const d = makeRedisDeps(fake);
  assert.deepEqual(await d.scanKeys(), keys); assert.equal(calls[0][1].match, 'waitlist:*');
  assert.equal(await d.readRaw('waitlist:a@b.com'), '1760000000000'); assert.equal(await d.readRaw('waitlist:zzz'), null);
  assert.equal(await d.casWrite('waitlist:a@b.com', 'old', 'new'), 'ok');
  const ev = calls.at(-1); assert.equal(ev[1], CAS_LUA); assert.deepEqual(ev[2], ['waitlist:a@b.com']); assert.deepEqual(ev[3], ['old', 'new']);
  assert.match(CAS_LUA, /cur ~= ARGV\[1\]/);
});
