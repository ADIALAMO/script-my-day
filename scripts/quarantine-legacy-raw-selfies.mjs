#!/usr/bin/env node
/**
 * One-off clean-up: MOVE the legacy raw selfies (public bucket, key `characters/<id>-raw-<stamp>.jpg` — the key embeds a user id) into the PRIVATE quarantine bucket.
 * Nothing is ever deleted outright: the move is copy-then-delete through lib/quarantine.js (the original is removed only after the copy succeeded) and the quarantine
 * bucket's own 30-day lifecycle rule is what finally expires the copy. Output is counts only — never a key, owner id, stamp, bucket name or URL.
 *
 *   node scripts/quarantine-legacy-raw-selfies.mjs                 DRY RUN (default): lists R2 + checks the sheets + reads Redis; changes nothing, needs no write permission
 *   node scripts/quarantine-legacy-raw-selfies.mjs --apply         real move, after you type  MOVE <count>
 *   node scripts/quarantine-legacy-raw-selfies.mjs --apply --limit 5   at most 5 moves (try a small batch first)
 *   node scripts/quarantine-legacy-raw-selfies.mjs --preflight     only check the token (see below), move nothing
 *
 * PREFLIGHT (always before the first move with --apply, or alone with --preflight): (a) the public bucket can be read (list 1 object + HEAD of the first eligible raw),
 * (b) the quarantine bucket can be WRITTEN (a tiny marker object under `preflight/`, deleted right after). The first failing check is reported with a safe reason
 * ("token lacks WRITE on the quarantine bucket", …) and nothing is moved. A move failure is split into stage=copy-source-read / copy-dest-write / delete-source.
 * Optional R2_JURISDICTION=eu|fedramp when the buckets were created with a jurisdiction (they need that endpoint; both buckets must share it for CopyObject).
 *
 * A raw is moved ONLY when, checked now AND again right before its own move:
 *   1. a sheet of the SAME upload exists (characters/<id>-sheet-<stamp>.jpg) and is not empty, and
 *   2. no Redis pointer character:<id> names the raw (neither `styledUrl` nor `url`) — Redis is only READ (GET). A pointer that cannot be read = skipped.
 * Anything else is skipped and counted. Stops after 5 failed moves in a row.
 *
 * Values are asked at hidden/echoing prompts (like list-leftover-raw-selfies.mjs), or taken from the shell environment when already set; no .env file is read:
 *   CLOUDFLARE_ACCOUNT_ID  R2_BUCKET_NAME  R2_ACCESS_KEY_ID(hidden)  R2_SECRET_ACCESS_KEY(hidden)  UPSTASH_REDIS_REST_URL  UPSTASH_REDIS_REST_TOKEN(hidden)
 *   and, with --apply only, R2_QUARANTINE_BUCKET_NAME.
 */
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import readline from 'node:readline/promises';
import { parseLegacyRaw } from '../lib/leftover-raw.js';
import { safeErrInfo, formatSafeErr, safeClass } from '../lib/safe-error.js';
import { StageError, readValue, describeFailure } from './list-leftover-raw-selfies.mjs';
import { r2Endpoint } from '../lib/blob-store.js';

const STOP_AFTER_FAILURES = 5;
/** Safe, fixed sentences for the permission problems (no bucket, key or URL is ever part of them). */
const REASONS = {
  'public-read': { AccessDenied: 'token lacks READ on the public bucket (needs Object Read, scoped to that bucket)', NoSuchBucket: 'public bucket not found at this endpoint (check its name and R2_JURISDICTION)' },
  'quarantine-write': { AccessDenied: 'token lacks WRITE on the quarantine bucket (needs Object Read & Write scoped to that bucket too)', NoSuchBucket: 'quarantine bucket not found at this endpoint (check its name; a bucket in a different jurisdiction than the public one cannot be reached, nor copied to)' },
  'quarantine-cleanup': { AccessDenied: 'token can write to the quarantine bucket but not delete there (needs Object Read & Write, not write-only)' },
  'copy-source-read': { _: 'token lacks READ on the public bucket' },
  'copy-dest-write': { _: 'token lacks WRITE on the quarantine bucket' },
  'delete-source': { _: 'token lacks DELETE on the public bucket (needs Object Read & Write, not read-only): a copy now exists in the private bucket and the ORIGINAL IS STILL PUBLIC' },
};
/** the `_` sentences describe a PERMISSION problem, so they only apply to an access-denied answer (403), never to a timeout or a 5xx */
export const reasonFor = (stage, cls, http = null) => REASONS[stage]?.[cls] ?? (cls === 'AccessDenied' || http === 403 ? REASONS[stage]?._ : null) ?? null;
const line = (stage, info) => { const r = reasonFor(stage, info.cls, info.http); return `stage=${stage} ${formatSafeErr({ cls: info.cls ?? 'Error', http: info.http ?? null })}${r ? ` — ${r}` : ''}`; };

const SKIP_LABELS = { noSheet: 'no sheet of the same upload', emptySheet: 'sheet is empty', pointerNamesRaw: 'a Redis pointer names the raw', pointerUnreadable: 'pointer could not be read (fail closed)', vanished: 'raw no longer in the public bucket', sheetCheckFailed: 'sheet check failed (fail closed)' };

export function parseArgs(argv) {
  const out = { apply: false, preflight: false, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--preflight') out.preflight = true;
    else if (a === '--limit' || a.startsWith('--limit=')) {
      const v = a === '--limit' ? argv[++i] : a.slice(8);
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) return { error: '--limit needs a whole number >= 1' };
      out.limit = n;
    } else return { error: `unknown argument (use --apply, --preflight, --limit N)` };
  }
  return out;
}

/** the object key a pointer URL names (the part from "characters/" on, decoded), or null */
export function keyOfPointerUrl(u) {
  if (typeof u !== 'string') return null;
  let path; try { path = decodeURIComponent(new URL(u).pathname); } catch { return null; }
  const i = path.indexOf('characters/');
  return i === -1 ? null : path.slice(i);
}

/**
 * @param {{ argv: string[], deps: {
 *   listPublic: () => Promise<{key:string,size?:number}[]>,
 *   headPublic: (key:string) => Promise<{exists:boolean,size:number}>,
 *   pointer: (id:string) => Promise<object|null>,            throws when Redis cannot be read
 *   move: (key:string) => Promise<{status:string,stage?:string,cls?:string,http?:number|null}>,
 *   preflight?: (firstKey: string|null) => Promise<{ stage: string, cls?: string, http?: number|null } | null>,   null = all checks passed
 *   confirm: (plan:string, word:string) => Promise<boolean>, log?: (s:string)=>void }}} args
 */
export async function run({ argv, deps }) {
  const log = deps.log ?? console.log;
  const args = parseArgs(argv);
  if (args.error) { log(`quarantine-legacy-raw-selfies: ${args.error}`); return { code: 2 }; }

  let listed;
  try { listed = await deps.listPublic(); } catch (e) { throw new StageError('list', 'could not list the public bucket (check the token: Object Read on the bucket, and the account id / bucket name)', safeErrInfo(e)); }
  const raws = listed.map((o) => ({ o, p: parseLegacyRaw(o.key) })).filter((x) => x.p);

  // The full safety check for ONE raw. Used for the plan and again immediately before the move.
  const verify = async ({ o, p }) => {
    let raw; let sheet;
    try { raw = await deps.headPublic(o.key); sheet = await deps.headPublic(p.sheetKey); } catch { return 'sheetCheckFailed'; }
    if (!raw.exists) return 'vanished';
    if (!sheet.exists) return 'noSheet';
    if (!(sheet.size > 0)) return 'emptySheet';
    let ptr;
    try { ptr = await deps.pointer(p.id); } catch { return 'pointerUnreadable'; }
    if (ptr) for (const u of [ptr.styledUrl, ptr.url]) if (keyOfPointerUrl(u) === o.key) return 'pointerNamesRaw';
    return null;
  };

  const skipped = Object.fromEntries(Object.keys(SKIP_LABELS).map((k) => [k, 0]));
  const eligible = [];
  for (const r of raws) { const why = await verify(r); if (why) skipped[why] += 1; else eligible.push(r); }
  const skippedTotal = Object.values(skipped).reduce((a, b) => a + b, 0);
  log(`legacy raw selfies found: ${raws.length}`);
  log(`eligible to move (sheet verified, no pointer names the raw): ${eligible.length}`);
  log(`skipped: ${skippedTotal}${skippedTotal ? ` (${Object.entries(skipped).filter(([, n]) => n).map(([k, n]) => `${SKIP_LABELS[k]} ${n}`).join(' · ')})` : ''}`);

  if (args.preflight || args.apply) {
    const bad = await deps.preflight(eligible[0]?.o.key ?? null);
    if (bad) { log(`preflight FAILED: ${line(bad.stage, bad)}`); log('nothing was moved.'); return { code: 1 }; }
    log('preflight ok: the public bucket is readable and the quarantine bucket is writable.');
    if (args.preflight) return { code: 0 };
  }
  if (!args.apply) { log('DRY RUN: nothing was changed. Add --apply to move them (you will be asked to type a confirmation first).'); return { code: 0 }; }

  const batch = eligible.slice(0, args.limit);
  if (!batch.length) { log('nothing to move.'); return { code: 0 }; }
  const word = `MOVE ${batch.length}`;
  if (!(await deps.confirm(`Move ${batch.length} legacy raw selfie(s) from the PUBLIC bucket to the PRIVATE quarantine bucket (copy, then delete the public original; nothing is deleted outright).`, word))) { log('aborted: nothing was changed.'); return { code: 1 }; }

  let moved = 0; let consecutive = 0; let stopped = false;
  const recheckSkips = Object.fromEntries(Object.keys(SKIP_LABELS).map((k) => [k, 0]));
  const failures = new Map();
  for (const r of batch) {
    const why = await verify(r);                       // right before the move: things may have changed since the plan
    if (why) { recheckSkips[why] += 1; continue; }
    let res;
    try { res = await deps.move(r.o.key); } catch (e) { res = { status: 'failed', stage: 'move', ...safeErrInfo(e) }; }
    if (res.status === 'moved') { moved += 1; consecutive = 0; continue; }
    const KNOWN_STAGES = ['copy', 'copy-source-read', 'copy-dest-write', 'delete-source', 'key-guard'];
    const reason = res.status === 'not-configured' ? 'stage=config reason=quarantine bucket not set' : line(KNOWN_STAGES.includes(res.stage) ? res.stage : 'move', { cls: safeClass(res.cls), http: Number.isInteger(res.http) ? res.http : null });
    failures.set(reason, (failures.get(reason) ?? 0) + 1);
    if (res.status === 'not-configured' || ++consecutive >= STOP_AFTER_FAILURES) { stopped = true; break; }
  }
  const failed = [...failures.values()].reduce((a, b) => a + b, 0);
  const reSkipped = Object.values(recheckSkips).reduce((a, b) => a + b, 0);
  log(`moved: ${moved} · failed: ${failed} · skipped at re-check: ${reSkipped}${reSkipped ? ` (${Object.entries(recheckSkips).filter(([, n]) => n).map(([k, n]) => `${SKIP_LABELS[k]} ${n}`).join(' · ')})` : ''}`);
  for (const [reason, n] of failures) log(`  failed ×${n}: ${reason}`);
  if (stopped) log(`stopped early after ${STOP_AFTER_FAILURES} failures in a row (or a missing quarantine bucket); re-run to continue.`);
  log('Moved objects are in the private bucket (its own lifecycle rule expires them); nothing else was changed.');
  return { code: failed || stopped ? 1 : 0 };
}

const LABELS = {
  CLOUDFLARE_ACCOUNT_ID: ['Cloudflare Account ID', false], R2_BUCKET_NAME: ['Public bucket name', false], R2_QUARANTINE_BUCKET_NAME: ['Quarantine (private) bucket name', false],
  R2_ACCESS_KEY_ID: ['Access Key ID (hidden)', true], R2_SECRET_ACCESS_KEY: ['Secret Access Key (hidden)', true],
  UPSTASH_REDIS_REST_URL: ['Upstash REST URL', false], UPSTASH_REDIS_REST_TOKEN: ['Upstash READ-ONLY REST token (hidden)', true],
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) throw new StageError('config', args.error);
  const names = ['CLOUDFLARE_ACCOUNT_ID', 'R2_BUCKET_NAME', ...(args.apply || args.preflight ? ['R2_QUARANTINE_BUCKET_NAME'] : []), 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const need = names.filter((k) => !String(process.env[k] ?? '').trim());
  if (need.length && !process.stdin.isTTY) throw new StageError('config', `missing env ${need.join(', ')} (not a terminal, so it cannot ask: set them in the shell)`);
  if (need.length) {
    process.stderr.write(`Press Ctrl+C to cancel. ${args.apply ? 'APPLY mode: this MOVES objects after a typed confirmation.' : 'Dry run: nothing is changed.'}\n`);
    for (const name of need) { const v = await readValue({ input: process.stdin, output: process.stderr, label: LABELS[name][0], hidden: LABELS[name][1] }); if (v) process.env[name] = v.trim(); }
  }
  const missing = names.filter((k) => !String(process.env[k] ?? '').trim());
  if (missing.length) throw new StageError('config', `missing env ${missing.join(', ')} (nothing was entered)`);

  const jur = String(process.env.R2_JURISDICTION ?? '').trim().toLowerCase();
  if (jur && jur !== 'eu' && jur !== 'fedramp') throw new StageError('config', 'R2_JURISDICTION must be eu or fedramp (or unset)');
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL.trim(), token: process.env.UPSTASH_REDIS_REST_TOKEN.trim() });
  const { S3Client, ListObjectsV2Command, HeadObjectCommand, PutObjectCommand, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'auto', endpoint: r2Endpoint(process.env.CLOUDFLARE_ACCOUNT_ID.trim(), jur), credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID.trim(), secretAccessKey: process.env.R2_SECRET_ACCESS_KEY.trim() } });
  const Bucket = process.env.R2_BUCKET_NAME.trim();
  const { quarantineLegacyRaw } = await import('../lib/quarantine.js');
  const deps = {
    async listPublic() {
      const out = []; let ContinuationToken;
      do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: 'characters/', ContinuationToken }));
        for (const o of res.Contents || []) out.push({ key: o.Key, size: o.Size });
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
    async headPublic(Key) {
      try { const h = await s3.send(new HeadObjectCommand({ Bucket, Key })); return { exists: true, size: Number(h.ContentLength) || 0 }; }
      catch (e) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return { exists: false, size: 0 }; throw e; }
    },
    async pointer(id) { const raw = await redis.get(`character:${id}`); return raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null; },
    async preflight(firstKey) {
      const fail = (stage, e) => ({ stage, ...safeErrInfo(e) });
      try {
        await s3.send(new ListObjectsV2Command({ Bucket, Prefix: 'characters/', MaxKeys: 1 }));
        if (firstKey) await s3.send(new HeadObjectCommand({ Bucket, Key: firstKey }));
      } catch (e) { return fail('public-read', e); }
      const QBucket = process.env.R2_QUARANTINE_BUCKET_NAME.trim();
      const marker = `preflight/legacy-raw-selfie-preflight-${crypto.randomUUID()}.txt`;
      try { await s3.send(new PutObjectCommand({ Bucket: QBucket, Key: marker, Body: 'preflight marker - safe to delete', ContentType: 'text/plain' })); }
      catch (e) { return fail('quarantine-write', e); }
      try { await s3.send(new DeleteObjectCommand({ Bucket: QBucket, Key: marker })); }
      catch (e) { return fail('quarantine-cleanup', e); }
      return null;
    },
    move: (key) => quarantineLegacyRaw(key),
    async confirm(plan, word) {
      if (!process.stdin.isTTY) { console.log('Refusing to run without an interactive terminal.'); return false; }
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ans = await rl.question(`\n${plan}\nType "${word}" to continue: `);
      rl.close();
      return ans.trim() === word;
    },
  };
  const { code } = await run({ argv: process.argv.slice(2), deps });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`quarantine-legacy-raw-selfies: ${e instanceof StageError ? describeFailure(e) : `stage=run reason=unexpected error ${formatSafeErr(safeErrInfo(e))}`}`); process.exit(1); });
}
