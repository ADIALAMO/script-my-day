#!/usr/bin/env node
/**
 * Delete (or, by default, only LIST) everything stored for one user: Redis keys and R2 objects.
 *
 *   node scripts/delete-user-data.js --email someone@example.com              # dry run (default): prints the plan
 *   node scripts/delete-user-data.js --user <userId>                          # same, by NextAuth user id
 *   node scripts/delete-user-data.js --email … --execute                      # prints the exact keys/objects, asks you to
 *                                                                             # type the confirmation, then deletes
 *   --allow-admin            required to touch an admin account (tier 'admin' or an ADMIN_EMAILS address)
 *   --include-deletion-log   also delete the audit record of the user's own deletion request (kept by default)
 *
 * Needs: UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN and, for R2, CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID,
 * R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME and OBJECT_KEY_SECRET (without it only legacy-format objects can be found).
 * Never prints secrets. See docs-private/delete-user-data.md.
 *
 * What it derives (from the code, see the list in buildPlan):
 *   Redis  every key containing the user id (usage:* quotas of all periods, comic, identity incl. lifetime/bonus,
 *          character:*, referral:*, user:tier*, user:stripe_customer, user:last_active, user:signup_provider, signup:fresh…),
 *          every key containing the e-mail (user:email:*, user:token:* verification tokens, waitlist:*, rate-limit keys),
 *          the NextAuth account/session records reached through user:account:by-user-id / user:session:by-user-id,
 *          the user's own referral code, and the membership in stats:pro:members / stats:users:all.
 *   R2     characters|posters|panels/<HMAC owner>/…, the legacy sha256 owner folders, legacy characters/u:<id>-*,
 *          and every object URL recorded in the character:<id> pointer.
 */
import { pathToFileURL } from 'node:url';
import readline from 'node:readline/promises';
import { ownerSegment, legacyOwnerSegment } from '../lib/upload-image.js';
import { keyFromPublicUrl } from '../lib/blob-store.js';

const esc = (s) => String(s).replace(/[\\*?[\]]/g, '\\$&');
const AUDIT_PREFIX = 'deletion-request:';

async function scanAll(redis, pattern) {
  const out = new Set();
  let cursor = '0';
  do {
    const res = await redis.scan(cursor, { match: pattern, count: 500 });
    cursor = String(res[0]);
    for (const k of res[1] || []) out.add(k);
  } while (cursor !== '0');
  return [...out];
}
const asString = (v) => (typeof v === 'string' ? v : v == null ? null : String(v));
const asObject = (v) => { if (!v) return null; if (typeof v === 'object') return v; try { return JSON.parse(v); } catch { return null; } };

export function adminEmails(env = process.env) {
  return String(env.ADMIN_EMAILS || '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
}

/**
 * Builds the deletion plan WITHOUT changing anything.
 * @param {{redis:any, r2?:{list:(prefix:string)=>Promise<string[]>}|null, userId?:string, email?:string,
 *          includeDeletionLog?:boolean, env?:object, warn?:(m:string)=>void}} o
 */
export async function buildPlan({ redis, r2 = null, userId, email, includeDeletionLog = false, env = process.env, warn = console.warn }) {
  let id = userId || null;
  let mail = email ? String(email).trim().toLowerCase() : null;
  const notes = [];

  if (!id && mail) id = asString(await redis.get(`user:email:${mail}`));
  if (id && !mail) mail = asObject(await redis.get(`user:${id}`))?.email?.toLowerCase?.() || null;
  if (!id) throw new Error(`No user found for ${mail || '(nothing given)'} — pass --user <id> if you know the id.`);
  const record = asObject(await redis.get(`user:${id}`));
  if (!record) notes.push('No NextAuth user record (user:<id>) — deleting leftovers only.');

  const tierValue = asString(await redis.get(`user:tier:${id}`));
  const isAdmin = tierValue === 'admin' || (mail && adminEmails(env).includes(mail));

  // ── Redis keys ────────────────────────────────────────────────────────────────────
  const keys = new Set();
  for (const k of await scanAll(redis, `*${esc(id)}*`)) keys.add(k);            // every key that embeds the user id
  if (mail) {
    keys.add(`user:email:${mail}`);
    for (const k of await scanAll(redis, `*${esc(mail)}*`)) keys.add(k);        // verification tokens, waitlist, rate limits
  }
  const accountKey = asString(await redis.get(`user:account:by-user-id:${id}`));   // NextAuth adapter indirections
  if (accountKey) keys.add(accountKey);
  const sessionKey = asString(await redis.get(`user:session:by-user-id:${id}`));
  if (sessionKey) keys.add(sessionKey);
  const code = asString(await redis.get(`referral:codeof:u:${id}`));               // reverse lookup of the user's invite code
  if (code) keys.add(`referral:code:${code}`);
  if (!includeDeletionLog) for (const k of [...keys]) if (k.startsWith(AUDIT_PREFIX)) keys.delete(k);
  for (const k of [...keys]) if (!k || k.length === 0) keys.delete(k);

  const setOps = [];
  if (await redis.sismember('stats:pro:members', id)) setOps.push({ cmd: 'srem', key: 'stats:pro:members', member: id });
  if ((await redis.zscore('stats:users:all', id)) !== null && (await redis.zscore('stats:users:all', id)) !== undefined) setOps.push({ cmd: 'zrem', key: 'stats:users:all', member: id });

  // ── R2 objects ────────────────────────────────────────────────────────────────────
  const objects = new Set();
  const pointer = asObject(await redis.get(`character:u:${id}`));
  for (const u of [pointer?.url, pointer?.styledUrl]) { const k = keyFromPublicUrl(u); if (k) objects.add(k); }
  if (r2) {
    const ident = `u:${id}`;
    const prefixes = [`characters/u:${id}-`, `posters/${legacyOwnerSegment(ident)}/`, `panels/${legacyOwnerSegment(ident)}/`];
    if (env.OBJECT_KEY_SECRET) {
      const owner = ownerSegment(ident);
      prefixes.push(`characters/${owner}/`, `posters/${owner}/`, `panels/${owner}/`);
    } else {
      notes.push('OBJECT_KEY_SECRET is not set: objects stored under the HMAC owner folder CANNOT be found (legacy ones can).');
    }
    for (const p of prefixes) for (const k of await r2.list(p)) objects.add(k);
  } else {
    notes.push('R2 is not configured: only objects recorded in the character pointer are listed.');
  }

  return { userId: id, email: mail, isAdmin, tier: tierValue, redisKeys: [...keys].sort(), setOps, objects: [...objects].sort(), notes };
}

export function formatPlan(plan) {
  const L = [];
  L.push(`User: ${plan.userId}${plan.email ? `  <${plan.email}>` : ''}   tier: ${plan.tier || 'free'}${plan.isAdmin ? '   *** ADMIN ***' : ''}`);
  L.push(`\nRedis keys (${plan.redisKeys.length}):`); plan.redisKeys.forEach((k) => L.push(`  DEL   ${k}`));
  L.push(`\nRedis set memberships (${plan.setOps.length}):`); plan.setOps.forEach((o) => L.push(`  ${o.cmd.toUpperCase()}  ${o.key}  ${o.member}`));
  L.push(`\nR2 objects (${plan.objects.length}):`); plan.objects.forEach((k) => L.push(`  DELETE ${k}`));
  if (plan.notes.length) { L.push('\nNotes:'); plan.notes.forEach((n) => L.push(`  - ${n}`)); }
  return L.join('\n');
}

/** Executes a plan. Never throws for a single failing item; returns the counts and the errors. */
export async function executePlan({ redis, r2, plan }) {
  const result = { redisDeleted: 0, setOpsDone: 0, objectsDeleted: 0, errors: [] };
  for (let i = 0; i < plan.redisKeys.length; i += 100) {
    const chunk = plan.redisKeys.slice(i, i + 100);
    try { result.redisDeleted += Number(await redis.del(...chunk)) || 0; }
    catch (e) { result.errors.push(`redis del [${chunk[0]}…]: ${e.message}`); }
  }
  for (const op of plan.setOps) {
    try { await (op.cmd === 'srem' ? redis.srem(op.key, op.member) : redis.zrem(op.key, op.member)); result.setOpsDone++; }
    catch (e) { result.errors.push(`${op.cmd} ${op.key}: ${e.message}`); }
  }
  for (const k of plan.objects) {
    try { await r2.del(k); result.objectsDeleted++; }
    catch (e) { result.errors.push(`r2 delete ${k}: ${e.message}`); }
  }
  return result;
}

export function parseArgs(argv) {
  const a = { execute: false, allowAdmin: false, includeDeletionLog: false, user: null, email: null };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--execute') a.execute = true;
    else if (t === '--allow-admin') a.allowAdmin = true;
    else if (t === '--include-deletion-log') a.includeDeletionLog = true;
    else if (t === '--user') a.user = argv[++i];
    else if (t === '--email') a.email = argv[++i];
    else throw new Error(`Unknown argument: ${t}`);
  }
  if (!a.user && !a.email) throw new Error('Give --user <id> or --email <address>.');
  return a;
}

/**
 * The whole run, with every side effect injected (tests use mocks). Returns { code, plan?, result? }.
 * @param {{argv:string[], redis:any, r2?:any, confirm:(plan:object)=>Promise<boolean>, out?:(s:string)=>void, env?:object}} d
 */
export async function run({ argv, redis, r2 = null, confirm, out = console.log, env = process.env }) {
  const args = parseArgs(argv);
  const plan = await buildPlan({ redis, r2, userId: args.user, email: args.email, includeDeletionLog: args.includeDeletionLog, env });
  out(formatPlan(plan));
  if (plan.isAdmin && !args.allowAdmin) {
    out('\nREFUSED: this is an admin account. Re-run with --allow-admin if you really mean it.');
    return { code: 3, plan };
  }
  if (!args.execute) {
    out('\nDRY RUN — nothing was changed. Add --execute to delete.');
    return { code: 0, plan };
  }
  if (!(await confirm(plan))) { out('\nAborted — nothing was changed.'); return { code: 2, plan }; }
  const result = await executePlan({ redis, r2, plan });
  out(`\nDone: ${result.redisDeleted} Redis keys deleted, ${result.setOpsDone} set memberships removed, ${result.objectsDeleted} R2 objects deleted, ${result.errors.length} errors.`);
  result.errors.forEach((e) => out(`  ERROR ${e}`));
  return { code: result.errors.length ? 1 : 0, plan, result };
}

// ── CLI wiring (real clients) ──────────────────────────────────────────────────────────
async function main() {
  const { Redis } = await import('@upstash/redis');
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.');
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });

  let r2 = null;
  const { CLOUDFLARE_ACCOUNT_ID: acc, R2_ACCESS_KEY_ID: ak, R2_SECRET_ACCESS_KEY: sk, R2_BUCKET_NAME: Bucket } = process.env;
  if (acc && ak && sk && Bucket) {
    const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: 'auto', endpoint: `https://${acc}.r2.cloudflarestorage.com`, credentials: { accessKeyId: ak, secretAccessKey: sk } });
    r2 = {
      async list(Prefix) {
        const keys = []; let ContinuationToken;
        do {
          const res = await s3.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }));
          for (const o of res.Contents || []) keys.push(o.Key);
          ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (ContinuationToken);
        return keys;
      },
      async del(Key) { await s3.send(new DeleteObjectCommand({ Bucket, Key })); },
    };
  }

  const confirm = async (plan) => {
    if (!process.stdin.isTTY) { console.log('Refusing to delete without an interactive terminal.'); return false; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const word = `DELETE ${plan.userId}`;
    const ans = await rl.question(`\nThe exact keys and objects above will be deleted PERMANENTLY.\nType "${word}" to continue: `);
    rl.close();
    return ans.trim() === word;
  };
  const { code } = await run({ argv: process.argv.slice(2), redis, r2, confirm });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
}
