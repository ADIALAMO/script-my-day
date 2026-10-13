#!/usr/bin/env node
/**
 * Manual takedown tool for generated images (reports, abuse, a screenshot you were sent). Never run by the app.
 *
 *   node scripts/takedown-object.mjs quarantine <key|url>          move public bucket → PRIVATE quarantine bucket + mark hidden
 *   node scripts/takedown-object.mjs restore <key>                 move quarantine → public bucket, clear the hidden mark and the reporter set
 *   node scripts/takedown-object.mjs delete <key>                  PERMANENT delete (from whichever bucket holds it)
 *   node scripts/takedown-object.mjs list-recent --since <ISO> [--until <ISO>] [--prefix panels/]
 *                                                                  key, size, last-modified ONLY (no content) — to find an object by time
 *   node scripts/takedown-object.mjs sweep [--apply]               list reported (hidden) images that are STILL in the public bucket; with --apply (typed
 *                                                                  confirmation) move them to quarantine — the same job the daily cron does
 *   node scripts/takedown-object.mjs owner <identifier>            list one owner's objects (identifier as stored: "u:<userId>" or the guest IP)
 *
 * quarantine / restore / delete print the plan and ask you to type a confirmation word; without an interactive terminal they refuse.
 * Environment (names only, set them with hidden prompts — see docs-private/content-report.md):
 *   CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME R2_QUARANTINE_BUCKET_NAME R2_PUBLIC_URL
 *   UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN        (owner also needs OBJECT_KEY_SECRET to compute the owner segment)
 */
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { sweepHidden, scanHiddenKeys } from '../lib/report-sweep.js';
import { isCharacterKey } from '../lib/object-scope.js';

const REPORTABLE = /^(panels|posters)\/[A-Za-z0-9_./-]{1,180}\.(png|jpg|webp)$/;
const HIDDEN_TTL = 400 * 24 * 60 * 60;

export function keyFromArg(arg, publicBase) {
  const a = String(arg || '').trim();
  if (!a) return null;
  const base = String(publicBase || '').replace(/\/$/, '');
  const key = base && a.startsWith(`${base}/`) ? decodeURIComponent(a.slice(base.length + 1).split(/[?#]/)[0]) : a;
  return (REPORTABLE.test(key) || isCharacterKey(key)) && !key.includes('..') ? key : null;
}

/**
 * @param {{ argv: string[], redis: any, r2: { head(bucket,key):Promise<boolean>, copy(fromBucket,toBucket,key):Promise<void>, del(bucket,key):Promise<void>, list(bucket,prefix):Promise<{key:string,size:number,lastModified:Date}[]> },
 *           confirm: (plan:string, word:string)=>Promise<boolean>, log?: (s:string)=>void, publicBase?: string, ownerSegment?: (id:string)=>string, now?: ()=>number }} deps
 * @returns {Promise<{code:number}>}
 */
export async function run({ argv, redis, r2, confirm, log = console.log, publicBase = '', ownerSegment, now = Date.now }) {
  const [cmd, ...rest] = argv;
  const flag = (name) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined; };

  if (cmd === 'list-recent') {
    const since = Date.parse(flag('since')); const until = flag('until') ? Date.parse(flag('until')) : Infinity;
    if (!Number.isFinite(since)) { log('list-recent needs --since <ISO date>'); return { code: 2 }; }
    const prefixes = flag('prefix') ? [flag('prefix')] : ['panels/', 'posters/'];
    let n = 0;
    for (const prefix of prefixes) for (const o of await r2.list('public', prefix)) {
      const t = new Date(o.lastModified).getTime();
      if (t >= since && t <= until) { log(`${o.key}\t${o.size}\t${new Date(t).toISOString()}`); n++; }
    }
    log(`${n} object(s)`); return { code: 0 };
  }

  if (cmd === 'owner') {
    if (!rest[0] || !ownerSegment) { log('owner needs an identifier (and OBJECT_KEY_SECRET in the environment)'); return { code: 2 }; }
    const seg = ownerSegment(rest[0]);
    let n = 0;
    for (const kind of ['panels', 'posters']) for (const o of await r2.list('public', `${kind}/${seg}/`)) { log(`${o.key}\t${o.size}\t${new Date(o.lastModified).toISOString()}`); n++; }
    log(`${n} object(s) for that owner`); return { code: 0 };
  }

  if (cmd === 'sweep') {
    const keys = await redis.scanHidden(5000);
    const found = await sweepHidden({ keys, headPublic: (k) => r2.head('public', k), apply: false });
    log(`${found.examined} hidden item(s) checked; ${found.stillPublic.length} still in the PUBLIC bucket`);
    for (const k of found.stillPublic) log(`  still public: ${k}`);
    if (!rest.includes('--apply')) { if (found.stillPublic.length) log('dry run — add --apply to move them to quarantine'); return { code: 0 }; }
    if (!found.stillPublic.length) return { code: 0 };
    if (!(await confirm(`Move ${found.stillPublic.length} reported object(s) from the PUBLIC bucket to the private quarantine bucket.`, `SWEEP ${found.stillPublic.length}`))) { log('aborted'); return { code: 1 }; }
    let moved = 0; const failed = [];
    for (const k of found.stillPublic) {
      try { await r2.copy('public', 'quarantine', k); await r2.del('public', k); moved += 1; } catch (e) { failed.push(k); log(`  failed: ${k} (${e.message})`); }
    }
    log(`moved ${moved}, failed ${failed.length}`);
    return { code: failed.length ? 1 : 0 };
  }

  if (!['quarantine', 'restore', 'delete'].includes(cmd)) { log('usage: quarantine <key|url> | restore <key> | delete <key> | sweep [--apply] | list-recent --since <ISO> | owner <identifier>'); return { code: 2 }; }
  const key = keyFromArg(rest[0], publicBase);
  if (!key) { log('not a panels/, posters/ or current-format characters/ object key (or a URL under R2_PUBLIC_URL)'); return { code: 2 }; }

  if (cmd === 'quarantine') {
    if (!(await r2.head('public', key))) { log(`not found in the public bucket: ${key}`); return { code: 1 }; }
    if (!(await confirm(`Move ${key} from the PUBLIC bucket to the private quarantine bucket and hide it.`, `QUARANTINE ${key}`))) { log('aborted'); return { code: 1 }; }
    await r2.copy('public', 'quarantine', key);
    await r2.del('public', key);
    await redis.set(`report:hidden:${key}`, JSON.stringify({ at: Math.floor(now() / 1000), via: 'manual', n: 0 }), { ex: HIDDEN_TTL });
    log(`quarantined: ${key}`); return { code: 0 };
  }

  if (cmd === 'restore') {
    if (!(await r2.head('quarantine', key))) { log(`not found in the quarantine bucket: ${key}`); return { code: 1 }; }
    if (!(await confirm(`Move ${key} from quarantine BACK to the public bucket and un-hide it (it becomes publicly readable again).`, `RESTORE ${key}`))) { log('aborted'); return { code: 1 }; }
    await r2.copy('quarantine', 'public', key);
    await r2.del('quarantine', key);
    await redis.del(`report:hidden:${key}`);
    await redis.del(`report:who:${key}`);
    log(`restored: ${key}`); return { code: 0 };
  }

  // delete
  const where = (await r2.head('public', key)) ? 'public' : (await r2.head('quarantine', key)) ? 'quarantine' : null;
  if (!where) { log(`not found in either bucket: ${key}`); return { code: 1 }; }
  if (!(await confirm(`PERMANENTLY delete ${key} from the ${where} bucket. This cannot be undone.`, `DELETE ${key}`))) { log('aborted'); return { code: 1 }; }
  await r2.del(where, key);
  await redis.set(`report:hidden:${key}`, JSON.stringify({ at: Math.floor(now() / 1000), via: 'manual-delete', n: 0 }), { ex: HIDDEN_TTL });
  log(`deleted: ${key}`); return { code: 0 };
}

// ── CLI wiring (real clients) ──────────────────────────────────────────────────────────
async function main() {
  const need = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`missing environment: ${missing.join(', ')}`);
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  const { S3Client, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand, CopyObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
  const bucketOf = (w) => { const b = w === 'public' ? process.env.R2_BUCKET_NAME : process.env.R2_QUARANTINE_BUCKET_NAME; if (!b) throw new Error('R2_QUARANTINE_BUCKET_NAME is not set'); return b; };
  const enc = (key) => key.split('/').map(encodeURIComponent).join('/');
  const r2 = {
    async head(w, Key) { try { await s3.send(new HeadObjectCommand({ Bucket: bucketOf(w), Key })); return true; } catch (e) { if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return false; throw e; } },
    async copy(from, to, Key) { await s3.send(new CopyObjectCommand({ Bucket: bucketOf(to), Key, CopySource: `${bucketOf(from)}/${enc(Key)}`, MetadataDirective: 'COPY' })); },
    async del(w, Key) { await s3.send(new DeleteObjectCommand({ Bucket: bucketOf(w), Key })); },
    async list(w, Prefix) {
      const out = []; let ContinuationToken;
      do {
        const res = await s3.send(new ListObjectsV2Command({ Bucket: bucketOf(w), Prefix, ContinuationToken }));
        for (const o of res.Contents || []) out.push({ key: o.Key, size: o.Size, lastModified: o.LastModified });
        ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (ContinuationToken);
      return out;
    },
  };
  const confirm = async (plan, word) => {
    if (!process.stdin.isTTY) { console.log('Refusing to run without an interactive terminal.'); return false; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`\n${plan}\nType "${word}" to continue: `);
    rl.close();
    return ans.trim() === word;
  };
  let ownerSegment;
  if (process.argv[2] === 'owner') ownerSegment = (await import('../lib/upload-image.js')).ownerSegment;
  redis.scanHidden = (max) => scanHiddenKeys(redis, max);   // the sweep command needs SCAN; wire it onto the real client
  const { code } = await run({ argv: process.argv.slice(2), redis, r2, confirm, publicBase: process.env.R2_PUBLIC_URL, ownerSegment });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`takedown-object: ${e.message}`); process.exit(1); });
}
