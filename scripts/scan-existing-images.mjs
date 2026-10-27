#!/usr/bin/env node
/**
 * ONE-TIME scan of images that were stored BEFORE the output check existed (panels/, posters/ in the public bucket — or a local folder such as
 * public/gallery). MANUAL ONLY: nothing here is scheduled or automatic.
 *
 * It lists the objects, classifies each one with the SAME strict checkers the app uses (the paid NVIDIA Nemotron on DeepInfra with data_collection deny — about $0.00015 per image; optionally the paid Gemini
 * Flash-Lite fallback via OpenRouter) and writes a results file of KEYS + VERDICTS only. Image bytes are held in memory for one request and are
 * never written anywhere or printed. The default run is a DRY RUN: it prints counts and the keys classified unsafe. Moving anything is a
 * separate, explicit step (--quarantine-from) with a typed confirmation, and it only MOVES (copy to the private bucket, then delete the public
 * original) — it never deletes an image outright.
 *
 *   node scripts/scan-existing-images.mjs --count-only [--prefix panels/] [--since ISO]      object count + bytes, no downloads, no model calls
 *   node scripts/scan-existing-images.mjs [--route free|paid|auto] [--since ISO] [--until ISO] [--prefix panels/] [--limit N] [--concurrency 3]
 *                                         [--max-paid-usd 1] [--out scan-results.json]        DRY RUN scan (resumable: re-run with the same --out)
 *   node scripts/scan-existing-images.mjs --dir public/gallery [--route …] [--out …]          scan local image files instead of R2
 *   node scripts/scan-existing-images.mjs --recheck-from first.json --out second.json [--route paid] [--include-unreadable] [--max-paid-usd 1] [--limit N]
 *                                                                                              SECOND OPINION on ONLY the entries a previous run marked "unsafe"
 *                                                                                              (default route paid; results go to a DIFFERENT file, the first stays untouched)
 *   node scripts/scan-existing-images.mjs --quarantine-from scan-results.json [--include-unreadable]
 *                                                                                              typed-confirmation move of the "unsafe" keys
 *
 * --route: free = Nemotron only (technical failures are retried with backoff, then recorded "unavailable" and retried on the next run);
 *          auto = Nemotron, and the paid fallback for technical failures / unreadable replies (spend capped by --max-paid-usd);
 *          paid = the paid fallback only (faster, ≈ $0.00012 per image).
 * Environment (names only; use hidden prompts — see docs-private/content-report.md):
 *   OPENROUTER_API_KEY                                       scan
 *   CLOUDFLARE_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET_NAME      listing / downloading from R2
 *   R2_QUARANTINE_BUCKET_NAME UPSTASH_REDIS_REST_URL UPSTASH_REDIS_REST_TOKEN      only for --quarantine-from
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { pathToFileURL } from 'node:url';
import { safeErrInfo, safeClass, formatSafeErr, printableError } from '../lib/safe-error.js';

// A results file is just JSON: whatever names a key must be a generated panel / poster (R2) or a plain relative path inside --dir (local).
const R2_SCOPE = /^(panels|posters)\//;
const inR2Scope = (k) => typeof k === 'string' && R2_SCOPE.test(k) && !k.includes('..');
const inLocalScope = (k) => typeof k === 'string' && k.length > 0 && !k.startsWith('/') && !k.includes('..') && !path.isAbsolute(k);

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const MAX_BYTES = 3 * 1024 * 1024;
const FINAL = new Set(['safe', 'unsafe', 'skipped']);   // a re-run does not redo these; "unreadable" / "unavailable" are retried
const COST_PER_PAID_CALL = 0.00015;                     // upper bound, same figure as lib/budget.js CHECK_COST_USD

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (argv, name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const has = (argv, name) => argv.includes(`--${name}`);

export function sniffMime(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

/** Runs `worker` over `items` with at most `n` in flight. */
async function pool(items, n, worker) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length || 1)) }, async () => {
    while (i < items.length) { const item = items[i++]; await worker(item); }
  }));
}

/**
 * @param {object} deps  r2 { list(prefix), get(key) }, fileio { read, write, exists, walk, readBytes }, classify(dataUri, {route, paid}) → {verdict, via},
 *                       headPublic, quarantine, redis, confirm, log, now
 * @returns {Promise<{code:number, summary?:object}>}
 */
export async function run({ argv, deps }) {
  const { r2, fileio, classify, log = console.log, now = Date.now } = deps;
  const out = arg(argv, 'out', 'scan-results.json');
  if (has(argv, 'recheck-from') && (has(argv, 'count-only') || has(argv, 'quarantine-from'))) { log('--recheck-from cannot be combined with --count-only or --quarantine-from'); return { code: 2 }; }

  // ── quarantine step (separate, typed confirmation) ─────────────────────────────────────────────────────────────
  if (has(argv, 'quarantine-from')) {
    const file = arg(argv, 'quarantine-from');
    if (!file || !fileio.exists(file)) { log(`results file not found: ${file}`); return { code: 2 }; }
    const results = JSON.parse(fileio.read(file));
    if (results.local) { log('this results file came from a local --dir scan: there is nothing to move in R2'); return { code: 2 }; }
    const verdicts = has(argv, 'include-unreadable') ? ['unsafe', 'unreadable'] : ['unsafe'];
    const keys = Object.entries(results.entries || {}).filter(([, v]) => verdicts.includes(v.v)).map(([k]) => k);
    // A results file is just a JSON file: never trust it. Only generated panels / posters can be moved — any other key (characters/, anything else, a
    // traversal) makes the WHOLE file refused, so a tampered or wrong file cannot reach selfies or other objects.
    const outOfScope = keys.filter((k) => !/^(panels|posters)\//.test(k) || k.includes('..'));
    if (outOfScope.length) { log(`refused: ${outOfScope.length} key(s) in ${file} are not under panels/ or posters/ — nothing was moved`); return { code: 2 }; }
    log(`${keys.length} object(s) selected (${verdicts.join(' + ')}) from ${file}`);
    if (!keys.length) return { code: 0 };
    if (!(await deps.confirm(`Move ${keys.length} object(s) from the PUBLIC bucket to the private quarantine bucket and mark them hidden. Nothing is deleted outright.`, `QUARANTINE ${keys.length} OBJECTS`))) { log('aborted'); return { code: 1 }; }
    let moved = 0; let missing = 0; const failed = [];   // failed: [{ stage, cls, http }] — a reason only, never the key / message / bucket
    for (const key of keys) {
      let stage = 'head';
      try {
        if (!(await deps.headPublic(key))) { missing += 1; continue; }
        stage = 'move';
        const q = await deps.quarantine(key);
        if (q.status === 'moved') {
          moved += 1;
          stage = 'redis-mark';
          await deps.redis.set(`report:hidden:${key}`, JSON.stringify({ at: Math.floor(now() / 1000), via: 'scan', n: 0 }), { ex: 400 * 24 * 60 * 60 });
        } else if (q.status === 'not-configured') { log('R2_QUARANTINE_BUCKET_NAME is not set — nothing was moved'); return { code: 2 }; }
        else failed.push({ stage: ['copy', 'delete-original', 'key-guard'].includes(q.stage) ? q.stage : 'move', cls: safeClass(q.cls), http: Number.isInteger(q.http) ? q.http : null });
      } catch (e) { failed.push({ stage, ...safeErrInfo(e) }); }
    }
    log(`moved ${moved}, already gone ${missing}, failed ${failed.length}`);
    const reasons = new Map();
    for (const f of failed) { const r = `stage=${f.stage} ${formatSafeErr(f)}`; reasons.set(r, (reasons.get(r) || 0) + 1); }
    for (const [r, n] of reasons) log(`  failed ×${n}: ${r}`);
    if (failed.some((f) => f.stage === 'redis-mark')) log('  note: redis-mark failures were already MOVED to the private bucket; only the hidden mark is missing');
    if (failed.some((f) => f.stage === 'delete-original')) log('  note: delete-original failures: a copy exists in the private bucket but the ORIGINAL IS STILL PUBLIC');
    return { code: failed.length ? 1 : 0, summary: { moved, missing, failed: failed.length } };
  }

  // ── second opinion: re-check ONLY the entries a previous run marked unsafe ─────────────────────────────────────────
  const recheckFile = arg(argv, 'recheck-from');
  let firstOpinion = null;       // key → the verdict the first run recorded
  let recheckLocal = false;
  if (has(argv, 'recheck-from')) {
    if (!recheckFile || !fileio.exists(recheckFile)) { log(`results file not found: ${recheckFile}`); return { code: 2 }; }
    // The second opinion lives in its OWN file: the first verdicts must stay exactly as they are.
    if (!has(argv, 'out') || !arg(argv, 'out') || path.resolve(out) === path.resolve(recheckFile)) { log('--out is required for --recheck-from and must be a DIFFERENT file than --recheck-from (the first results are never overwritten)'); return { code: 2 }; }
    // An existing --out is only ever RESUMED when it is the second-opinion file of this very input; any other results file is never touched.
    if (fileio.exists(out)) {
      let prev = null; try { prev = JSON.parse(fileio.read(out)); } catch { /* not JSON */ }
      if (!prev || prev.recheckOf !== recheckFile) { log(`refused: ${out} already exists and is not the second-opinion file of ${recheckFile} — choose a new --out`); return { code: 2 }; }
    }
    const first = JSON.parse(fileio.read(recheckFile));
    recheckLocal = first.local === true;
    if (recheckLocal && !arg(argv, 'dir')) { log('that results file came from a local --dir scan: pass the same --dir so the files can be read'); return { code: 2 }; }
    if (!recheckLocal && arg(argv, 'dir')) { log('that results file is from an R2 scan: do not pass --dir'); return { code: 2 }; }
    const wanted = has(argv, 'include-unreadable') ? ['unsafe', 'unreadable'] : ['unsafe'];
    const picked = Object.entries(first.entries || {}).filter(([, v]) => wanted.includes(v.v));
    const bad = picked.filter(([k]) => !(recheckLocal ? inLocalScope(k) : inR2Scope(k)));
    if (bad.length) { log(`refused: ${bad.length} key(s) in ${recheckFile} are outside the allowed scope (${recheckLocal ? 'a relative path inside --dir' : 'panels/ or posters/'}) — nothing was read or sent`); return { code: 2 }; }
    firstOpinion = Object.fromEntries(picked.map(([k, v]) => [k, v.v]));
    log(`${picked.length} entr${picked.length === 1 ? 'y' : 'ies'} marked ${wanted.join(' / ')} in ${recheckFile} will get a second opinion`);
  }

  // ── listing ───────────────────────────────────────────────────────────────────────────────────────────────────────
  const since = arg(argv, 'since') ? Date.parse(arg(argv, 'since')) : -Infinity;
  const until = arg(argv, 'until') ? Date.parse(arg(argv, 'until')) : Infinity;
  const limit = parseInt(arg(argv, 'limit', '0'), 10) || Infinity;
  const dir = arg(argv, 'dir');
  const prefixes = arg(argv, 'prefix') ? [arg(argv, 'prefix')] : ['panels/', 'posters/'];
  let objects = [];
  if (firstOpinion) {
    // no listing at all: only the flagged keys are fetched (R2 GetObject / local read)
    objects = Object.keys(firstOpinion).map((key) => ({ key, size: 0, lastModified: new Date(now()) }));
  } else if (dir) {
    for (const f of fileio.walk(dir)) if (IMAGE_EXT.test(f.rel)) objects.push({ key: f.rel, size: f.size, lastModified: f.mtime });
  } else {
    for (const p of prefixes) for (const o of await r2.list(p)) objects.push(o);
  }
  objects = objects.filter((o) => { const t = new Date(o.lastModified).getTime(); return t >= since && t <= until && IMAGE_EXT.test(o.key); });

  if (has(argv, 'count-only')) {
    const bytes = objects.reduce((n, o) => n + (o.size || 0), 0);
    const byPrefix = {};
    for (const o of objects) { const p = o.key.split('/')[0]; byPrefix[p] = (byPrefix[p] || 0) + 1; }
    log(`${objects.length} object(s), ${(bytes / 1048576).toFixed(1)} MB${Object.keys(byPrefix).length ? ` — ${Object.entries(byPrefix).map(([p, n]) => `${p}: ${n}`).join(', ')}` : ''}`);
    log(`estimate if every image used the paid route: ≈ $${(objects.length * COST_PER_PAID_CALL).toFixed(2)} (the Nemotron route costs about $0.00015 per image too)`);
    return { code: 0, summary: { objects: objects.length, bytes } };
  }

  // ── scan (dry run) ─────────────────────────────────────────────────────────────────────────────────────────────
  const route = arg(argv, 'route', firstOpinion ? 'paid' : 'free');   // a second opinion defaults to the PAID model (a different model than the free first pass)
  if (!['free', 'paid', 'auto'].includes(route)) { log('--route must be free, paid or auto'); return { code: 2 }; }
  const concurrency = Math.min(8, parseInt(arg(argv, 'concurrency', '3'), 10) || 3);
  const maxPaid = parseFloat(arg(argv, 'max-paid-usd', '1'));
  const state = { version: 1, route, local: Boolean(dir), startedAt: new Date(now()).toISOString(), entries: {}, ...(firstOpinion ? { recheckOf: recheckFile } : {}) };
  if (fileio.exists(out)) { const prev = JSON.parse(fileio.read(out)); state.entries = prev.entries || {}; log(`resuming from ${out}: ${Object.keys(state.entries).length} key(s) already recorded`); }

  const todo = objects.filter((o) => !FINAL.has(state.entries[o.key]?.v)).slice(0, limit === Infinity ? undefined : limit);
  log(`${objects.length} object(s) in scope, ${todo.length} to scan (route ${route}, concurrency ${concurrency})`);
  const paid = { calls: 0, allow() { return this.calls * COST_PER_PAID_CALL < maxPaid; }, used() { this.calls += 1; } };
  let sinceWrite = 0;
  const flush = () => fileio.write(out, JSON.stringify(state));

  await pool(todo, concurrency, async (o) => {
    let entry;
    try {
      if ((o.size || 0) > MAX_BYTES) entry = { v: 'skipped', why: 'too-large' };
      else {
        const bytes = dir ? fileio.readBytes(path.join(dir, o.key)) : await r2.get(o.key);
        const mime = sniffMime(bytes);
        if (!mime) entry = { v: 'skipped', why: 'not-an-image' };
        else if (bytes.length > MAX_BYTES) entry = { v: 'skipped', why: 'too-large' };
        else {
          const r = await classify(`data:${mime};base64,${bytes.toString('base64')}`, { route, paid });
          entry = { v: r.verdict, via: r.via };
        }
      }
    } catch { entry = { v: 'unavailable', why: 'read-error' }; }
    state.entries[o.key] = { ...entry, ...(firstOpinion ? { firstOpinion: firstOpinion[o.key] } : {}), at: now() };
    if (++sinceWrite >= 25) { sinceWrite = 0; flush(); }
  });
  flush();

  const counts = { safe: 0, unsafe: 0, unreadable: 0, unavailable: 0, skipped: 0 };
  for (const o of objects) { const v = state.entries[o.key]?.v; if (v in counts) counts[v] += 1; }
  const unsafe = objects.filter((o) => state.entries[o.key]?.v === 'unsafe').map((o) => o.key);
  const unreadable = objects.filter((o) => state.entries[o.key]?.v === 'unreadable').map((o) => o.key);
  log('\nDRY RUN — nothing was moved or deleted.');
  log(`safe ${counts.safe} · unsafe ${counts.unsafe} · unreadable ${counts.unreadable} · unavailable ${counts.unavailable} · skipped ${counts.skipped}`);
  if (paid.calls) log(`paid fallback calls: ${paid.calls} (≈ $${(paid.calls * COST_PER_PAID_CALL).toFixed(4)})`);
  if (unsafe.length) { log('\nclassified UNSAFE (keys only):'); for (const k of unsafe) log(`  ${k}`); }
  if (unreadable.length) { log('\nUNREADABLE verdicts (keys only; review manually or re-run with --route auto/paid):'); for (const k of unreadable) log(`  ${k}`); }
  if (counts.unavailable) log(`\n${counts.unavailable} key(s) could not be classified — run the same command again to retry them.`);
  let second = null;
  if (firstOpinion) {
    const cleared = objects.filter((o) => state.entries[o.key]?.v === 'safe').map((o) => o.key);
    second = { checked: objects.length, confirmed: counts.unsafe, cleared: cleared.length, undecided: counts.unreadable + counts.unavailable + counts.skipped };
    log(`\nSECOND OPINION (route ${route}) on ${second.checked} image(s) the first pass called unsafe: confirmed unsafe ${second.confirmed} · cleared (second says safe) ${second.cleared} · undecided ${second.undecided}`);
    if (cleared.length) { log('\nthe second opinion says SAFE (first said unsafe) — keys only:'); for (const k of cleared) log(`  ${k}`); }
    log('the first results file was not modified.');
  }
  log(`\nresults (keys + verdicts only): ${out}`);
  return { code: 0, summary: { ...counts, paidCalls: paid.calls, ...(second ? { second } : {}) } };
}

// ── real wiring ────────────────────────────────────────────────────────────────────────────────────────────────────────
async function main() {
  const argv = process.argv.slice(2);
  const fileio = {
    exists: (f) => fs.existsSync(f), read: (f) => fs.readFileSync(f, 'utf8'), write: (f, d) => fs.writeFileSync(f, d), readBytes: (f) => fs.readFileSync(f),
    walk: (root) => { const res = []; (function go(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) go(p); else { const st = fs.statSync(p); res.push({ rel: path.relative(root, p), size: st.size, mtime: st.mtime }); } } })(root); return res; },
  };
  const confirm = async (plan, word) => {
    if (!process.stdin.isTTY) { console.log('Refusing to run without an interactive terminal.'); return false; }
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const ans = await rl.question(`\n${plan}\nType "${word}" to continue: `);
    rl.close();
    return ans.trim() === word;
  };

  if (has(argv, 'quarantine-from')) {
    const need = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_QUARANTINE_BUCKET_NAME', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
    const missing = need.filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`missing environment: ${missing.join(', ')}`);
    const { Redis } = await import('@upstash/redis');
    const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
    const { quarantineObject, headPublicObject } = await import('../lib/quarantine.js');
    const { code } = await run({ argv, deps: { fileio, confirm, redis, headPublic: async (k) => (await headPublicObject(k)).exists, quarantine: (k) => quarantineObject(k) } });
    process.exit(code);
  }

  // scan / count: no Redis is touched — the lib imports a stub client instead of reading UPSTASH_* (so a shell that happens to have them is safe)
  globalThis._redisClient = {};
  const dir = arg(argv, 'dir');
  const countOnly = has(argv, 'count-only');
  let r2 = null; let classify = null;
  if (!dir) {
    const need = ['CLOUDFLARE_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
    const missing = need.filter((k) => !process.env[k]);
    if (missing.length) throw new Error(`missing environment: ${missing.join(', ')}`);
    const { S3Client, ListObjectsV2Command, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({ region: 'auto', endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY } });
    r2 = {
      async list(Prefix) {
        const keys = []; let ContinuationToken;
        do {
          const res = await s3.send(new ListObjectsV2Command({ Bucket: process.env.R2_BUCKET_NAME, Prefix, ContinuationToken }));
          for (const o of res.Contents || []) keys.push({ key: o.Key, size: o.Size, lastModified: o.LastModified });
          ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
        } while (ContinuationToken);
        return keys;
      },
      async get(Key) { const res = await s3.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key })); return Buffer.from(await res.Body.transformToByteArray()); },
    };
  }
  if (!countOnly) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is not set');
    const { callNemotron, callFallback } = await import('../lib/image-check.js');
    classify = async (dataUri, { route, paid }) => {
      const askPaid = async () => {
        if (!paid.allow()) return { verdict: 'unavailable', via: 'paid-cap' };
        paid.used();
        const r = await callFallback(dataUri, 30000);
        if (r.kind === 'verdict') return { verdict: r.verdict === 'unknown' ? 'unreadable' : r.verdict, via: 'fallback' };
        return { verdict: 'unavailable', via: 'fallback' };
      };
      if (route === 'paid') return askPaid();
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await callNemotron(dataUri, 20000);
        if (r.kind === 'verdict') {
          if (r.verdict === 'safe' || r.verdict === 'unsafe') return { verdict: r.verdict, via: 'nemotron' };
          return route === 'auto' ? askPaid() : { verdict: 'unreadable', via: 'nemotron' };
        }
        await sleep(2000 * 2 ** attempt);   // 429 / 5xx / timeout: back off, then try again
      }
      return route === 'auto' ? askPaid() : { verdict: 'unavailable', via: 'nemotron' };
    };
  }
  const { code } = await run({ argv, deps: { r2, fileio, classify, confirm } });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`scan-existing-images: ${printableError(e)}`); process.exit(1); });
}
