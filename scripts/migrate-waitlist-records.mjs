#!/usr/bin/env node
/**
 * One-off: rewrite the LEGACY Pro-waitlist values into the v1 record shape (lib/waitlist.js).
 *
 *   before:  waitlist:<email>  =  1760000000000                       (a bare unix-ms number)
 *   after:   waitlist:<email>  =  {"v":1,"email":…,"createdAt":"<that time as ISO>","locale":null,"source":"legacy-waitlist","userId":null,"consentVersion":null}
 *
 *   node scripts/migrate-waitlist-records.mjs                                   DRY RUN (default): counts only, nothing is written
 *   node scripts/migrate-waitlist-records.mjs --apply [--backup-dir DIR]        real rewrite after you type  MIGRATE <count>
 *   node scripts/migrate-waitlist-records.mjs --rollback FILE                   dry run of a rollback (counts only)
 *   node scripts/migrate-waitlist-records.mjs --rollback FILE --apply           restore the originals from the backup after you type  ROLLBACK <count>
 *
 * Safety:
 *   - dry run is the default; --dry-run is accepted and means the same;
 *   - BEFORE any write, a JSON backup (the original value of every key that will change, plus the value the script will write) is saved to
 *     <backup-dir>/waitlist-backup-<runId>.json with file mode 0600 (it contains e-mail addresses: keep it OUT of git; default dir ./waitlist-backups is git-ignored,
 *     but a folder outside the repo is better). If the backup cannot be written, nothing is changed;
 *   - every write is a Lua COMPARE-AND-SET (only if the stored value is still byte-for-byte what was read), so a signup that changed meanwhile is never clobbered;
 *   - each rewrite is read back; 5 failures in a row stop the run;
 *   - idempotent: values already in the v1 shape are counted and left alone;
 *   - rollback restores an original ONLY if the key still holds the value this script wrote.
 *
 * Output: COUNTS and safe `stage=… class=… http=…` failures only — never an e-mail address, a key or a stored value.
 * Credentials: shell environment or hidden prompts: UPSTASH_REDIS_REST_URL and a READ-WRITE UPSTASH_REDIS_REST_TOKEN (SCAN/GET/EVAL).
 */
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { safeErrInfo, formatSafeErr } from '../lib/safe-error.js';
import { WAITLIST_KEY_PREFIX, normalizeEmail, parseWaitlistValue, buildLegacyRecord, legacyCreatedAt, serializeRecord } from '../lib/waitlist.js';
import { StageError, readValue, describeFailure } from './list-leftover-raw-selfies.mjs';

const STOP_AFTER_FAILURES = 5;
const DEFAULT_BACKUP_DIR = './waitlist-backups';

/** compare-and-set that keeps the TTL (these keys have none; KEEPTTL is harmless). ARGV[1] = the value we read, ARGV[2] = the new value. */
export const CAS_LUA = `local cur = redis.call('GET', KEYS[1])
if not cur then return 'missing' end
if cur ~= ARGV[1] then return 'changed' end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 'ok'`;

const SKIP_LABELS = { alreadyMigrated: 'already in the new shape', notAnEmailKey: 'key is not waitlist:<email>', unreadable: 'value unreadable or unexpected shape', gone: 'key vanished' };
const RECHECK_LABELS = { changed: 'value changed since the plan', unreadable: 'value could not be read' };

export function parseArgs(argv) {
  const out = { apply: false, backupDir: DEFAULT_BACKUP_DIR, rollback: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--dry-run') out.apply = false;
    else if (a === '--backup-dir' || a.startsWith('--backup-dir=')) {
      const v = a === '--backup-dir' ? argv[++i] : a.slice(13);
      if (!v || v.startsWith('--')) return { error: '--backup-dir needs a folder' };
      out.backupDir = v;
    } else if (a === '--rollback' || a.startsWith('--rollback=')) {
      const v = a === '--rollback' ? argv[++i] : a.slice(11);
      if (!v || v.startsWith('--')) return { error: '--rollback needs the backup file written by the apply run' };
      out.rollback = v;
    } else return { error: 'unknown argument (use --apply, --dry-run, --backup-dir DIR, --rollback FILE)' };
  }
  if (argv.includes('--apply') && argv.includes('--dry-run')) return { error: '--apply and --dry-run contradict each other' };
  return out;
}

const count = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const zero = (labels) => Object.fromEntries(Object.keys(labels).map((k) => [k, 0]));
const describe = (labels, o) => Object.entries(o).filter(([, n]) => n).map(([k, n]) => `${labels[k]} ${n}`).join(' · ');
const failLine = (stage, e) => `stage=${stage} ${formatSafeErr(safeErrInfo(e))}`;

/**
 * @param {{ argv: string[], deps: {
 *   scanKeys: () => Promise<string[]>,                                   every key matching waitlist:*
 *   readRaw: (key:string) => Promise<string|null>,                       the stored STRING, byte for byte; throws when unreadable
 *   casWrite: (key:string, expectedRaw:string, newRaw:string) => Promise<'ok'|'changed'|'missing'>,
 *   writeBackup: (dir:string, runId:string, data:object) => Promise<void>,   must write mode 0600 and throw on failure
 *   readBackup: (file:string) => Promise<object>,
 *   newRunId: () => string, now?: () => number, confirm: (plan:string, word:string)=>Promise<boolean>, log?: (s:string)=>void }}} args
 */
export async function run({ argv, deps }) {
  const log = deps.log ?? console.log;
  const args = parseArgs(argv);
  if (args.error) { log(`migrate-waitlist-records: ${args.error}`); return { code: 2 }; }
  if (args.rollback) return rollback({ args, deps, log });

  const nowMs = (deps.now ?? Date.now)();
  let keys;
  try { keys = await deps.scanKeys(); } catch (e) { throw new StageError('scan', 'could not scan Redis (check the URL and that the token is READ-WRITE)'); }

  const skipped = zero(SKIP_LABELS); const plans = []; let noTimestamp = 0;
  for (const key of keys) {
    const email = String(key).slice(WAITLIST_KEY_PREFIX.length);
    if (!String(key).startsWith(WAITLIST_KEY_PREFIX) || normalizeEmail(email) !== email) { skipped.notAnEmailKey += 1; continue; }
    let original;
    try { original = await deps.readRaw(key); } catch { skipped.unreadable += 1; continue; }
    if (original === null || original === undefined) { skipped.gone += 1; continue; }
    const p = parseWaitlistValue(original);
    if (p.kind === 'v1') { skipped.alreadyMigrated += 1; continue; }
    if (p.kind !== 'legacy') { skipped.unreadable += 1; continue; }
    if (legacyCreatedAt(p.value, nowMs) === null) noTimestamp += 1;
    plans.push({ key, original, migrated: serializeRecord(buildLegacyRecord({ email, legacyValue: p.value, nowMs })) });
  }
  log(`waitlist keys found: ${keys.length}`);
  log(`legacy records to rewrite: ${plans.length}${noTimestamp ? ` (${noTimestamp} with a missing or implausible timestamp: createdAt will be null)` : ''}`);
  log(`not rewritten: ${count(skipped)}${count(skipped) ? ` (${describe(SKIP_LABELS, skipped)})` : ''}`);
  if (!args.apply) { log('DRY RUN: nothing was changed. Add --apply to rewrite them (a backup file is written first and you will be asked to type a confirmation).'); return { code: 0 }; }
  if (!plans.length) { log('nothing to migrate.'); return { code: 0 }; }

  const runId = deps.newRunId();
  if (!(await deps.confirm(`Rewrite ${plans.length} waitlist record(s) to the v1 shape. A backup is saved to ${path.join(args.backupDir, `waitlist-backup-${runId}.json`)} first.`, `MIGRATE ${plans.length}`))) {
    log('aborted: nothing was changed.'); return { code: 1 };
  }
  // the backup comes BEFORE the first write; if it cannot be saved the run stops here
  try { await deps.writeBackup(args.backupDir, runId, { runId, createdAt: new Date(nowMs).toISOString(), entries: plans }); }
  catch (e) { log(`aborted: the backup could not be written (${formatSafeErr(safeErrInfo(e))}). Nothing was changed.`); return { code: 1 }; }

  let migrated = 0; let consecutive = 0; let stopped = false; const failures = new Map(); const rechecked = zero(RECHECK_LABELS);
  const fail = (reason) => { failures.set(reason, (failures.get(reason) ?? 0) + 1); return ++consecutive >= STOP_AFTER_FAILURES; };
  for (const plan of plans) {
    let now;
    try { now = await deps.readRaw(plan.key); } catch { rechecked.unreadable += 1; continue; }
    if (now !== plan.original) { rechecked.changed += 1; continue; }
    let r;
    try { r = await deps.casWrite(plan.key, plan.original, plan.migrated); } catch (e) { if (fail(failLine('write', e))) { stopped = true; break; } continue; }
    if (r !== 'ok') { rechecked.changed += 1; continue; }
    let back;
    try { back = await deps.readRaw(plan.key); } catch (e) { if (fail(failLine('verify', e))) { stopped = true; break; } continue; }
    if (back !== plan.migrated) { if (fail('stage=verify reason=read-back did not match')) { stopped = true; break; } continue; }
    migrated += 1; consecutive = 0;
  }
  const failed = count(Object.fromEntries([...failures]));
  log(`run id: ${runId}`);
  log(`migrated: ${migrated} · failed: ${failed} · skipped at re-check: ${count(rechecked)}${count(rechecked) ? ` (${describe(RECHECK_LABELS, rechecked)})` : ''}`);
  for (const [reason, n] of failures) log(`  failed ×${n}: ${reason}`);
  if (stopped) log(`stopped early after ${STOP_AFTER_FAILURES} failures in a row; re-run to continue (already rewritten records are skipped).`);
  log(`rollback: node scripts/migrate-waitlist-records.mjs --rollback <backup file for run ${runId}>`);
  return { code: failed || stopped ? 1 : 0, runId };
}

async function rollback({ args, deps, log }) {
  let backup;
  try { backup = await deps.readBackup(args.rollback); } catch { log('migrate-waitlist-records: the backup file could not be read or is not valid JSON.'); return { code: 2 }; }
  const entries = Array.isArray(backup?.entries) ? backup.entries : null;
  if (!entries || entries.some((e) => typeof e?.key !== 'string' || typeof e?.original !== 'string' || typeof e?.migrated !== 'string' || !e.key.startsWith(WAITLIST_KEY_PREFIX))) {
    log('migrate-waitlist-records: the file is not a waitlist backup written by this script.'); return { code: 2 };
  }
  const plan = []; const skipped = { alreadyRestored: 0, changedSince: 0, gone: 0, unreadable: 0 };
  const LABELS = { alreadyRestored: 'already restored', changedSince: 'changed since the migration (left alone)', gone: 'key removed (left alone)', unreadable: 'could not be read' };
  for (const e of entries) {
    let cur; try { cur = await deps.readRaw(e.key); } catch { skipped.unreadable += 1; continue; }
    if (cur === null || cur === undefined) skipped.gone += 1;
    else if (cur === e.original && e.original !== e.migrated) skipped.alreadyRestored += 1;
    else if (cur === e.migrated) plan.push(e);
    else skipped.changedSince += 1;
  }
  log(`entries in the backup: ${entries.length}`);
  log(`records to restore: ${plan.length}`);
  log(`not restored: ${count(skipped)}${count(skipped) ? ` (${describe(LABELS, skipped)})` : ''}`);
  if (!args.apply) { log('DRY RUN: nothing was changed. Add --apply to restore them (you will be asked to type a confirmation first).'); return { code: 0 }; }
  if (!plan.length) { log('nothing to restore.'); return { code: 0 }; }
  if (!(await deps.confirm(`Restore ${plan.length} waitlist record(s) to their original (legacy) value.`, `ROLLBACK ${plan.length}`))) { log('aborted: nothing was changed.'); return { code: 1 }; }
  let restored = 0; let changed = 0; const failures = new Map();
  for (const p of plan) {
    try { const r = await deps.casWrite(p.key, p.migrated, p.original); if (r === 'ok') restored += 1; else changed += 1; }
    catch (e) { const k = failLine('write', e); failures.set(k, (failures.get(k) ?? 0) + 1); }
  }
  const failed = count(Object.fromEntries([...failures]));
  log(`restored: ${restored} · failed: ${failed} · changed meanwhile (left alone): ${changed}`);
  for (const [reason, n] of failures) log(`  failed ×${n}: ${reason}`);
  return { code: failed ? 1 : 0 };
}

/** Real Redis wiring (exported so a test can run it against a fake client). `redis` must be created with automaticDeserialization:false so reads return the stored STRING. */
export function makeRedisDeps(redis) {
  return {
    async scanKeys() {
      const out = []; let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, { match: `${WAITLIST_KEY_PREFIX}*`, count: 500 });
        for (const k of keys || []) out.push(String(k));
        cursor = String(next);
      } while (cursor !== '0');
      return out;
    },
    async readRaw(key) { const v = await redis.get(key); return v === null || v === undefined ? null : String(v); },
    async casWrite(key, expectedRaw, newRaw) { return String(await redis.eval(CAS_LUA, [key], [expectedRaw, newRaw])); },
  };
}

export function makeFileDeps() {
  return {
    async writeBackup(dir, runId, data) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `waitlist-backup-${runId}.json`);
      fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });   // wx: never overwrite an existing backup
      fs.chmodSync(file, 0o600);
    },
    async readBackup(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); },
  };
}

const LABELS = {
  UPSTASH_REDIS_REST_URL: ['Upstash REST URL', false], UPSTASH_REDIS_REST_TOKEN: ['Upstash READ-WRITE REST token (hidden)', true],
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) throw new StageError('config', args.error);
  const names = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const blank = (k) => !String(process.env[k] ?? '').trim();
  const need = names.filter(blank);
  if (need.length && !process.stdin.isTTY) throw new StageError('config', `missing env ${need.join(', ')} (not a terminal, so it cannot ask: set them in the shell)`);
  if (need.length) {
    process.stderr.write(`Press Ctrl+C to cancel. ${args.apply ? 'APPLY mode: this WRITES Redis records after a typed confirmation.' : 'Dry run: nothing is changed.'}\n`);
    for (const name of need) { const v = await readValue({ input: process.stdin, output: process.stderr, label: LABELS[name][0], hidden: LABELS[name][1] }); if (v) process.env[name] = v.trim(); }
  }
  const missing = names.filter(blank);
  if (missing.length) throw new StageError('config', `missing env ${missing.join(', ')} (nothing was entered)`);

  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL.trim(), token: process.env.UPSTASH_REDIS_REST_TOKEN.trim(), automaticDeserialization: false });
  const deps = { ...makeRedisDeps(redis), ...makeFileDeps(), newRunId: () => `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
    async confirm(plan, word) {
      if (!process.stdin.isTTY) { console.log('Refusing to run without an interactive terminal.'); return false; }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`\n${plan}\nType "${word}" to continue: `);
      rl.close();
      return ans.trim() === word;
    } };
  const { code } = await run({ argv: process.argv.slice(2), deps });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`migrate-waitlist-records: ${e instanceof StageError ? describeFailure(e) : `stage=run reason=unexpected error ${formatSafeErr(safeErrInfo(e))}`}`); process.exit(1); });
}
