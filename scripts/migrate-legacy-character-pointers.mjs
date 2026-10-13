#!/usr/bin/env node
/**
 * One-off: rewrite the LEGACY character pointers so they no longer name the raw selfie. A legacy upload (key `characters/<id>-raw-<stamp>.jpg`, written until 2026-10-09)
 * stored `character:<id>` = { url: <RAW url>, styledUrl: <SHEET url>, … }. `url` is a stale field (the app reads `styledUrl || url` and accepts either as the reference).
 * This script sets `url` = `styledUrl` (the sheet), so the raw is referenced by nothing and scripts/quarantine-legacy-raw-selfies.mjs can move it.
 *
 *   node scripts/migrate-legacy-character-pointers.mjs                          DRY RUN (default): counts only, nothing is written
 *   node scripts/migrate-legacy-character-pointers.mjs --apply [--limit N]      real rewrite after you type  MIGRATE <count>
 *   node scripts/migrate-legacy-character-pointers.mjs --rollback <runId>       dry run of a rollback (counts only)
 *   node scripts/migrate-legacy-character-pointers.mjs --rollback <runId> --apply   restore the saved originals after you type  ROLLBACK <count>
 *
 * Per pointer (all checked at plan time AND again right before its write):
 *   - the pointer is exactly { url: RAW, styledUrl: SHEET of the same upload }, and that sheet exists in R2 and is not empty;
 *   - the original JSON is saved to Redis (migration:character-pointer:<runId>:<id>, 30-day TTL) BEFORE anything is written;
 *   - the write is a Lua COMPARE-AND-SET (only if the stored value is still byte-for-byte what was read) that KEEPS the pointer's TTL: a user who re-uploads meanwhile is never overwritten;
 *   - afterwards the pointer is read back and the sheet is HEADed again.
 * Idempotent: a pointer already pointing at the sheet is counted "already migrated" and left alone. Rollback restores an original ONLY if the pointer is still exactly what the
 * migration wrote (a newer upload / expiry is never touched).
 *
 * Output: counts + safe `stage=… class=… http=…` failures + the run id (random, needed for a rollback). NEVER an id, key, stamp, URL, bucket or host.
 * Credentials: shell environment or prompts (no file; secrets hidden): CLOUDFLARE_ACCOUNT_ID R2_BUCKET_NAME R2_ACCESS_KEY_ID(h) R2_SECRET_ACCESS_KEY(h) — R2 READ only, not needed for a rollback —
 * and UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN(h) — a READ-WRITE token (SET/EVAL/SCAN). Optional R2_JURISDICTION=eu|fedramp.
 */
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { parseLegacyRaw } from '../lib/leftover-raw.js';
import { safeErrInfo, formatSafeErr } from '../lib/safe-error.js';
import { r2Endpoint } from '../lib/blob-store.js';
import { StageError, readValue, describeFailure } from './list-leftover-raw-selfies.mjs';
import { keyOfPointerUrl } from './quarantine-legacy-raw-selfies.mjs';

export const BACKUP_PREFIX = 'migration:character-pointer:';
export const BACKUP_TTL_SEC = 30 * 24 * 60 * 60;
const STOP_AFTER_FAILURES = 5;
const RUN_ID = /^[a-z0-9]{6,24}$/;

/** compare-and-set that keeps the TTL (KEEPTTL, Redis >= 6). ARGV[1] = the value we read, ARGV[2] = the new value. */
export const CAS_LUA = `local cur = redis.call('GET', KEYS[1])
if not cur then return 'missing' end
if cur ~= ARGV[1] then return 'changed' end
redis.call('SET', KEYS[1], ARGV[2], 'KEEPTTL')
return 'ok'`;

const SKIP_LABELS = {
  alreadyMigrated: 'already migrated', noPointer: 'no pointer', styledIsRaw: 'styledUrl is the raw (no sheet in use)', otherUpload: 'pointer is for another upload',
  sheetMissing: 'sheet missing or empty', unexpectedShape: 'unexpected pointer shape', malformed: 'pointer is not valid JSON', pointerUnreadable: 'pointer could not be read (fail closed)', sheetCheckFailed: 'sheet check failed (fail closed)',
};
const RECHECK_LABELS = { changed: 'pointer changed since the plan', sheetMissing: 'sheet missing or empty', pointerUnreadable: 'pointer could not be read (fail closed)', sheetCheckFailed: 'sheet check failed (fail closed)', backupFailed: 'backup could not be saved (nothing written)' };

export function parseArgs(argv) {
  const out = { apply: false, limit: Infinity, rollback: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--limit' || a.startsWith('--limit=')) {
      const n = Number(a === '--limit' ? argv[++i] : a.slice(8));
      if (!Number.isInteger(n) || n < 1) return { error: '--limit needs a whole number >= 1' };
      out.limit = n;
    } else if (a === '--rollback' || a.startsWith('--rollback=')) {
      const v = a === '--rollback' ? argv[++i] : a.slice(11);
      if (!RUN_ID.test(String(v ?? ''))) return { error: '--rollback needs the run id printed by the apply run' };
      out.rollback = v;
    } else return { error: 'unknown argument (use --apply, --limit N, --rollback RUNID)' };
  }
  if (out.rollback && out.limit !== Infinity) return { error: '--limit cannot be combined with --rollback' };
  return out;
}

const count = (o) => Object.values(o).reduce((a, b) => a + b, 0);
const zero = (labels) => Object.fromEntries(Object.keys(labels).map((k) => [k, 0]));
const describe = (labels, o) => Object.entries(o).filter(([, n]) => n).map(([k, n]) => `${labels[k]} ${n}`).join(' · ');
const failLine = (stage, e) => `stage=${stage} ${formatSafeErr(e?.cls ? { cls: e.cls, http: e.http ?? null } : safeErrInfo(e))}`;

/** the pointer exactly as the migration writes it: same JSON, `url` := `styledUrl` */
export const migratedForm = (originalRaw) => { const p = JSON.parse(originalRaw); return JSON.stringify({ ...p, url: p.styledUrl }); };

/**
 * @param {{ argv: string[], deps: {
 *   listPublic: () => Promise<{key:string}[]>,
 *   headPublic: (key:string) => Promise<{exists:boolean,size:number}>,
 *   readPointer: (id:string) => Promise<string|null>,                   the stored STRING, byte for byte; throws when unreadable
 *   saveBackup: (runId:string, id:string, raw:string) => Promise<boolean>,
 *   casWrite: (id:string, expectedRaw:string, newRaw:string) => Promise<'ok'|'changed'|'missing'>,
 *   scanBackups: (runId:string) => Promise<{id:string, raw:string}[]>,
 *   newRunId: () => string, confirm: (plan:string, word:string)=>Promise<boolean>, log?: (s:string)=>void }}} args
 */
export async function run({ argv, deps }) {
  const log = deps.log ?? console.log;
  const args = parseArgs(argv);
  if (args.error) { log(`migrate-legacy-character-pointers: ${args.error}`); return { code: 2 }; }
  if (args.rollback) return rollback({ args, deps, log });

  let listed;
  try { listed = await deps.listPublic(); } catch (e) { throw new StageError('list', 'could not list the public bucket (check the R2 token: Object Read on the bucket, and the account id / bucket name)', safeErrInfo(e)); }
  const raws = listed.map((o) => ({ key: o.key, p: parseLegacyRaw(o.key) })).filter((x) => x.p);

  // classify ONE raw against its pointer; returns { skip } or { plan: { id, original, migrated } }
  const classify = async ({ key, p }) => {
    let original;
    try { original = await deps.readPointer(p.id); } catch { return { skip: 'pointerUnreadable' }; }
    if (original === null || original === undefined) return { skip: 'noPointer' };
    let ptr; try { ptr = JSON.parse(original); } catch { return { skip: 'malformed' }; }
    if (!ptr || typeof ptr !== 'object' || Array.isArray(ptr)) return { skip: 'malformed' };
    const u = keyOfPointerUrl(ptr.url); const s = keyOfPointerUrl(ptr.styledUrl);
    if (u === p.sheetKey && s === p.sheetKey) return { skip: 'alreadyMigrated' };
    if (s === key) return { skip: 'styledIsRaw' };
    if (u !== key && s !== key) return { skip: 'otherUpload' };
    if (!(u === key && s === p.sheetKey)) return { skip: 'unexpectedShape' };
    let sheet; try { sheet = await deps.headPublic(p.sheetKey); } catch { return { skip: 'sheetCheckFailed' }; }
    if (!sheet.exists || !(sheet.size > 0)) return { skip: 'sheetMissing' };
    return { plan: { id: p.id, original, migrated: migratedForm(original), sheetKey: p.sheetKey } };
  };

  const skipped = zero(SKIP_LABELS); const plans = new Map();
  for (const r of raws) {
    const c = await classify(r);
    if (c.skip) skipped[c.skip] += 1;
    else if (plans.has(c.plan.id)) skipped.otherUpload += 1;   // one id has ONE pointer; a second raw of the same id can never be its reference (defensive)
    else plans.set(c.plan.id, c.plan);
  }
  const todo = [...plans.values()];
  log(`legacy raw selfies found: ${raws.length}`);
  log(`pointers to migrate (url names the raw, styledUrl names its sheet, sheet verified): ${todo.length}`);
  log(`not migrated: ${count(skipped)}${count(skipped) ? ` (${describe(SKIP_LABELS, skipped)})` : ''}`);
  if (!args.apply) { log('DRY RUN: nothing was changed. Add --apply to rewrite them (you will be asked to type a confirmation first).'); return { code: 0 }; }

  const batch = todo.slice(0, args.limit);
  if (!batch.length) { log('nothing to migrate.'); return { code: 0 }; }
  const runId = deps.newRunId();
  if (!(await deps.confirm(`Rewrite ${batch.length} character pointer(s): url := styledUrl (the sheet). Originals are saved in Redis for 30 days under run id ${runId}.`, `MIGRATE ${batch.length}`))) { log('aborted: nothing was changed.'); return { code: 1 }; }

  let migrated = 0; let consecutive = 0; let stopped = false; const failures = new Map();
  const rechecked = zero(RECHECK_LABELS);
  const fail = (reason) => { failures.set(reason, (failures.get(reason) ?? 0) + 1); return ++consecutive >= STOP_AFTER_FAILURES; };
  for (const plan of batch) {
    // re-check right before writing: the pointer must still be byte-for-byte the planned original, and the sheet must still be there
    let now;
    try { now = await deps.readPointer(plan.id); } catch { rechecked.pointerUnreadable += 1; continue; }
    if (now !== plan.original) { rechecked.changed += 1; continue; }
    let sheet; try { sheet = await deps.headPublic(plan.sheetKey); } catch { rechecked.sheetCheckFailed += 1; continue; }
    if (!sheet.exists || !(sheet.size > 0)) { rechecked.sheetMissing += 1; continue; }
    let saved = false;
    try { saved = await deps.saveBackup(runId, plan.id, plan.original); } catch { saved = false; }
    if (!saved) { rechecked.backupFailed += 1; if (fail('stage=backup')) { stopped = true; break; } continue; }
    let r;
    try { r = await deps.casWrite(plan.id, plan.original, plan.migrated); } catch (e) { if (fail(failLine('write', e))) { stopped = true; break; } continue; }
    if (r !== 'ok') { rechecked.changed += 1; continue; }                                  // the user re-uploaded (or the pointer expired) between the re-check and the write: left exactly as it is
    let back; let head;
    try { back = await deps.readPointer(plan.id); head = await deps.headPublic(plan.sheetKey); } catch (e) { if (fail(failLine('verify', e))) { stopped = true; break; } continue; }
    if (back !== plan.migrated || !head.exists || !(head.size > 0)) { if (fail('stage=verify reason=read-back or sheet check did not match')) { stopped = true; break; } continue; }
    migrated += 1; consecutive = 0;
  }
  const failed = count(Object.fromEntries([...failures]));
  log(`run id: ${runId}`);
  log(`migrated: ${migrated} · failed: ${failed} · skipped at re-check: ${count(rechecked)}${count(rechecked) ? ` (${describe(RECHECK_LABELS, rechecked)})` : ''}`);
  for (const [reason, n] of failures) log(`  failed ×${n}: ${reason}`);
  if (stopped) log(`stopped early after ${STOP_AFTER_FAILURES} failures in a row; re-run to continue (already migrated pointers are skipped).`);
  log(`next: node scripts/quarantine-legacy-raw-selfies.mjs   (rollback: --rollback ${runId})`);
  return { code: failed || stopped ? 1 : 0, runId };
}

async function rollback({ args, deps, log }) {
  const saved = await deps.scanBackups(args.rollback);
  const plan = []; const skipped = { alreadyRestored: 0, changedSince: 0, pointerGone: 0, unreadable: 0, badBackup: 0 };
  const LABELS = { alreadyRestored: 'already restored', changedSince: 'pointer changed since the migration (a newer upload; left alone)', pointerGone: 'pointer expired or removed (left alone)', unreadable: 'pointer could not be read (fail closed)', badBackup: 'backup is not valid' };
  for (const b of saved) {
    let migrated; try { migrated = migratedForm(b.raw); } catch { skipped.badBackup += 1; continue; }
    let cur; try { cur = await deps.readPointer(b.id); } catch { skipped.unreadable += 1; continue; }
    if (cur === null || cur === undefined) skipped.pointerGone += 1;
    else if (cur === b.raw && b.raw !== migrated) skipped.alreadyRestored += 1;
    else if (cur === migrated) plan.push({ id: b.id, original: b.raw, migrated });
    else skipped.changedSince += 1;
  }
  log(`backups found for this run: ${saved.length}`);
  log(`pointers to restore: ${plan.length}`);
  log(`not restored: ${count(skipped)}${count(skipped) ? ` (${describe(LABELS, skipped)})` : ''}`);
  if (!args.apply) { log('DRY RUN: nothing was changed. Add --apply to restore them (you will be asked to type a confirmation first).'); return { code: 0 }; }
  if (!plan.length) { log('nothing to restore.'); return { code: 0 }; }
  if (!(await deps.confirm(`Restore ${plan.length} character pointer(s) to the saved originals (url := the raw again).`, `ROLLBACK ${plan.length}`))) { log('aborted: nothing was changed.'); return { code: 1 }; }
  let restored = 0; let changed = 0; const failures = new Map();
  for (const p of plan) {
    try { const r = await deps.casWrite(p.id, p.migrated, p.original); if (r === 'ok') restored += 1; else changed += 1; }
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
    async readPointer(id) { const v = await redis.get(`character:${id}`); return v === null || v === undefined ? null : String(v); },
    async saveBackup(runId, id, raw) { const r = await redis.set(`${BACKUP_PREFIX}${runId}:${id}`, raw, { nx: true, ex: BACKUP_TTL_SEC }); return r === 'OK' || r === null; },   // null = already saved by this run
    async casWrite(id, expectedRaw, newRaw) { return String(await redis.eval(CAS_LUA, [`character:${id}`], [expectedRaw, newRaw])); },
    async scanBackups(runId) {
      const out = []; let cursor = '0'; const prefix = `${BACKUP_PREFIX}${runId}:`;
      do {
        const [next, keys] = await redis.scan(cursor, { match: `${prefix}*`, count: 200 });
        for (const k of keys || []) { const v = await redis.get(k); if (v !== null && v !== undefined) out.push({ id: String(k).slice(prefix.length), raw: String(v) }); }
        cursor = String(next);
      } while (cursor !== '0');
      return out;
    },
  };
}

const LABELS = {
  CLOUDFLARE_ACCOUNT_ID: ['Cloudflare Account ID', false], R2_BUCKET_NAME: ['Public bucket name', false], R2_ACCESS_KEY_ID: ['Access Key ID (hidden)', true], R2_SECRET_ACCESS_KEY: ['Secret Access Key (hidden)', true],
  UPSTASH_REDIS_REST_URL: ['Upstash REST URL', false], UPSTASH_REDIS_REST_TOKEN: ['Upstash READ-WRITE REST token (hidden)', true],
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) throw new StageError('config', args.error);
  const names = [...(args.rollback ? [] : ['CLOUDFLARE_ACCOUNT_ID', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']), 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const blank = (k) => !String(process.env[k] ?? '').trim();
  const need = names.filter(blank);
  if (need.length && !process.stdin.isTTY) throw new StageError('config', `missing env ${need.join(', ')} (not a terminal, so it cannot ask: set them in the shell)`);
  if (need.length) {
    process.stderr.write(`Press Ctrl+C to cancel. ${args.apply ? 'APPLY mode: this WRITES Redis pointers after a typed confirmation.' : 'Dry run: nothing is changed.'}\n`);
    for (const name of need) { const v = await readValue({ input: process.stdin, output: process.stderr, label: LABELS[name][0], hidden: LABELS[name][1] }); if (v) process.env[name] = v.trim(); }
  }
  const missing = names.filter(blank);
  if (missing.length) throw new StageError('config', `missing env ${missing.join(', ')} (nothing was entered)`);
  const jur = String(process.env.R2_JURISDICTION ?? '').trim().toLowerCase();
  if (jur && jur !== 'eu' && jur !== 'fedramp') throw new StageError('config', 'R2_JURISDICTION must be eu or fedramp (or unset)');

  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL.trim(), token: process.env.UPSTASH_REDIS_REST_TOKEN.trim(), automaticDeserialization: false });
  const deps = { ...makeRedisDeps(redis), newRunId: () => `${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`,
    async confirm(plan, word) {
      if (!process.stdin.isTTY) { console.log('Refusing to run without an interactive terminal.'); return false; }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`\n${plan}\nType "${word}" to continue: `);
      rl.close();
      return ans.trim() === word;
    } };
  if (!args.rollback) {
    const { S3Client, ListObjectsV2Command, HeadObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: 'auto', endpoint: r2Endpoint(process.env.CLOUDFLARE_ACCOUNT_ID.trim(), jur), credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim() } });
    const Bucket = process.env.R2_BUCKET_NAME.trim();
    deps.listPublic = async () => {
      const out = []; let ContinuationToken;
      do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: 'characters/', ContinuationToken }));
        for (const o of res.Contents || []) out.push({ key: o.Key });
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    };
    deps.headPublic = async (Key) => {
      try { const h = await s3.send(new HeadObjectCommand({ Bucket, Key })); return { exists: true, size: Number(h.ContentLength) || 0 }; }
      catch (e) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return { exists: false, size: 0 }; throw e; }
    };
  }
  const { code } = await run({ argv: process.argv.slice(2), deps });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`migrate-legacy-character-pointers: ${e instanceof StageError ? describeFailure(e) : `stage=run reason=unexpected error ${formatSafeErr(safeErrInfo(e))}`}`); process.exit(1); });
}
