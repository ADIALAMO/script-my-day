#!/usr/bin/env node
/**
 * One-off: delete leftover payment-provider customer records (`user:stripe_customer:<userId>`). Billing is off, nothing reads them for a purpose.
 *
 *   node scripts/remove-orphan-stripe-customers.mjs                              DRY RUN (default): lists what would be deleted (masked), writes nothing
 *   node scripts/remove-orphan-stripe-customers.mjs --apply [--backup-dir DIR]   real delete after you type  DELETE <count>
 *   node scripts/remove-orphan-stripe-customers.mjs --rollback FILE [--apply]    put the deleted records back (SET only if the key is still missing)
 *
 * Cross-check per record (read-only): user:tier:<id>, user:tier_source:<id> and stats:pro:members. A record whose tier_source says `stripe`
 * is NEVER deleted by this script (that would be a real paid grant): it is reported and left alone. tier_source entries themselves are never
 * touched — they hold {source, by, at}, never a customer id, so nothing references the deleted key.
 *
 * Safety: dry run is the default; a JSON backup (mode 0600, holds the customer ids: keep it OUT of git) is written BEFORE the first delete and the run
 * stops if it cannot be written; each delete is a Lua COMPARE-AND-DELETE (only if the value is still what was read) and is read back.
 * Output: counts and masked ids only (user id first 4 chars, customer id never) — no key, value or email.
 * Credentials: shell env or hidden prompts: UPSTASH_REDIS_REST_URL and a READ-WRITE UPSTASH_REDIS_REST_TOKEN.
 */
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { safeErrInfo, formatSafeErr } from '../lib/safe-error.js';
import { StageError, readValue, describeFailure } from './list-leftover-raw-selfies.mjs';

export const PREFIX = 'user:stripe_customer:';
const DEFAULT_BACKUP_DIR = './stripe-customer-backups';
const STOP_AFTER_FAILURES = 3;

export const CAD_LUA = `local cur = redis.call('GET', KEYS[1])
if not cur then return 'missing' end
if cur ~= ARGV[1] then return 'changed' end
redis.call('DEL', KEYS[1])
return 'ok'`;

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

const mask = (id) => `${String(id).slice(0, 4)}…`;
const failLine = (stage, e) => `stage=${stage} ${formatSafeErr(safeErrInfo(e))}`;
function sourceOf(raw) {
  if (raw === null || raw === undefined) return 'none';
  try { const s = JSON.parse(raw)?.source; return typeof s === 'string' && /^[a-z]{1,16}$/.test(s) ? s : 'unreadable'; } catch { return 'unreadable'; }
}

/**
 * deps: scanKeys() -> keys; readRaw(key) -> string|null; isProMember(userId) -> boolean; casDelete(key, expectedRaw) -> 'ok'|'changed'|'missing';
 *       setIfMissing(key, raw) -> boolean; writeBackup(dir, runId, data); readBackup(file); newRunId(); confirm(plan, word); log
 */
export async function run({ argv, deps }) {
  const log = deps.log ?? console.log;
  const args = parseArgs(argv);
  if (args.error) { log(`remove-orphan-stripe-customers: ${args.error}`); return { code: 2 }; }
  if (args.rollback) return rollback({ args, deps, log });

  let keys;
  try { keys = (await deps.scanKeys()).filter((k) => String(k).startsWith(PREFIX)); } catch { throw new StageError('scan', 'could not scan Redis (check the URL and that the token is READ-WRITE)'); }
  const plans = []; const kept = []; let unreadable = 0; let gone = 0;
  for (const key of keys) {
    const userId = key.slice(PREFIX.length);
    let value; let tier; let srcRaw; let member;
    try { value = await deps.readRaw(key); tier = await deps.readRaw(`user:tier:${userId}`); srcRaw = await deps.readRaw(`user:tier_source:${userId}`); member = await deps.isProMember(userId); }
    catch { unreadable += 1; continue; }
    if (value === null || value === undefined) { gone += 1; continue; }
    const row = { key, userId, value, tier: tier || 'free', source: sourceOf(srcRaw), member: !!member };
    if (row.source === 'stripe') kept.push(row); else plans.push(row);
  }
  log(`customer-id records found: ${keys.length}`);
  for (const r of [...plans, ...kept]) log(`  user ${mask(r.userId)}  tier=${r.tier}  tier_source=${r.source}  in Pro set=${r.member ? 'yes' : 'no'}  -> ${r.source === 'stripe' ? 'KEEP (stripe-sourced grant)' : 'would delete'}`);
  log(`would delete: ${plans.length} · kept (tier_source = stripe): ${kept.length} · unreadable: ${unreadable} · already gone: ${gone}`);
  if (!args.apply) { log('DRY RUN: nothing was changed. Add --apply to delete them (a backup is written first and you will be asked to type a confirmation).'); return { code: 0, plans, kept }; }
  if (!plans.length) { log('nothing to delete.'); return { code: 0 }; }

  const runId = deps.newRunId();
  if (!(await deps.confirm(`Delete ${plans.length} payment-provider customer record(s). A backup is saved to ${path.join(args.backupDir, `stripe-customer-backup-${runId}.json`)} first.`, `DELETE ${plans.length}`))) {
    log('aborted: nothing was changed.'); return { code: 1 };
  }
  try { await deps.writeBackup(args.backupDir, runId, { runId, entries: plans.map((p) => ({ key: p.key, value: p.value })) }); }
  catch (e) { log(`aborted: the backup could not be written (${formatSafeErr(safeErrInfo(e))}). Nothing was changed.`); return { code: 1 }; }

  let deleted = 0; let changed = 0; let consecutive = 0; let stopped = false; const failures = new Map();
  for (const p of plans) {
    try {
      const r = await deps.casDelete(p.key, p.value);
      if (r !== 'ok') { changed += 1; continue; }
      if ((await deps.readRaw(p.key)) !== null) throw new Error('still present after delete');
      deleted += 1; consecutive = 0;
    } catch (e) {
      const k = failLine('delete', e); failures.set(k, (failures.get(k) ?? 0) + 1);
      if (++consecutive >= STOP_AFTER_FAILURES) { stopped = true; break; }
    }
  }
  const failed = [...failures.values()].reduce((a, b) => a + b, 0);
  log(`run id: ${runId}`);
  log(`deleted: ${deleted} · failed: ${failed} · changed meanwhile (left alone): ${changed}`);
  for (const [reason, n] of failures) log(`  failed ×${n}: ${reason}`);
  if (stopped) log(`stopped early after ${STOP_AFTER_FAILURES} failures in a row.`);
  log(`rollback: node scripts/remove-orphan-stripe-customers.mjs --rollback <backup file for run ${runId}> --apply`);
  return { code: failed || stopped ? 1 : 0, runId };
}

async function rollback({ args, deps, log }) {
  let backup;
  try { backup = await deps.readBackup(args.rollback); } catch { log('remove-orphan-stripe-customers: the backup file could not be read or is not valid JSON.'); return { code: 2 }; }
  const entries = Array.isArray(backup?.entries) ? backup.entries : null;
  if (!entries || entries.some((e) => typeof e?.key !== 'string' || typeof e?.value !== 'string' || !e.key.startsWith(PREFIX))) {
    log('remove-orphan-stripe-customers: the file is not a backup written by this script.'); return { code: 2 };
  }
  log(`entries in the backup: ${entries.length}`);
  if (!args.apply) { log('DRY RUN: nothing was changed. Add --apply to restore them.'); return { code: 0 }; }
  if (!(await deps.confirm(`Restore ${entries.length} customer record(s) (only where the key is still missing).`, `ROLLBACK ${entries.length}`))) { log('aborted: nothing was changed.'); return { code: 1 }; }
  let restored = 0; let present = 0; let failed = 0;
  for (const e of entries) { try { (await deps.setIfMissing(e.key, e.value)) ? restored++ : present++; } catch { failed++; } }
  log(`restored: ${restored} · already present (left alone): ${present} · failed: ${failed}`);
  return { code: failed ? 1 : 0 };
}

export function makeRedisDeps(redis) {
  return {
    async scanKeys() {
      const out = []; let cursor = '0';
      do {
        const [next, keys] = await redis.scan(cursor, { match: `${PREFIX}*`, count: 500 });
        for (const k of keys || []) out.push(String(k));
        cursor = String(next);
      } while (cursor !== '0');
      return out;
    },
    async readRaw(key) { const v = await redis.get(key); return v === null || v === undefined ? null : String(v); },
    async isProMember(userId) { return Number(await redis.sismember('stats:pro:members', userId)) === 1; },
    async casDelete(key, expectedRaw) { return String(await redis.eval(CAD_LUA, [key], [expectedRaw])); },
    async setIfMissing(key, raw) { return (await redis.set(key, raw, { nx: true })) === 'OK'; },
  };
}

export function makeFileDeps() {
  return {
    async writeBackup(dir, runId, data) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      const file = path.join(dir, `stripe-customer-backup-${runId}.json`);
      fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600, flag: 'wx' });
      fs.chmodSync(file, 0o600);
    },
    async readBackup(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); },
  };
}

const LABELS = { UPSTASH_REDIS_REST_URL: ['Upstash REST URL', false], UPSTASH_REDIS_REST_TOKEN: ['Upstash READ-WRITE REST token (hidden)', true] };

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) throw new StageError('config', args.error);
  const names = Object.keys(LABELS);
  const blank = (k) => !String(process.env[k] ?? '').trim();
  const need = names.filter(blank);
  if (need.length && !process.stdin.isTTY) throw new StageError('config', `missing env ${need.join(', ')} (not a terminal, so it cannot ask: set them in the shell)`);
  if (need.length) {
    process.stderr.write(`Press Ctrl+C to cancel. ${args.apply ? 'APPLY mode: this DELETES Redis records after a typed confirmation.' : 'Dry run: nothing is changed.'}\n`);
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
  main().catch((e) => { console.error(`remove-orphan-stripe-customers: ${e instanceof StageError ? describeFailure(e) : `stage=run reason=unexpected error ${formatSafeErr(safeErrInfo(e))}`}`); process.exit(1); });
}
