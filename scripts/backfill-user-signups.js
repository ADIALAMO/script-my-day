/**
 * One-time backfill for the /api/admin/users signup index.
 *
 * stats:users:all (a Redis sorted set, score = signup unix-ms) only starts
 * filling in going forward, from the moment lib/auth.js's signIn event was
 * updated to write it. Every user who signed up before that has no entry —
 * this script finds them and adds one.
 *
 * Source of truth for "who has ever signed up": SCAN MATCH 'user:email:*'.
 * This is deliberately NOT `SCAN MATCH 'user:*'` — the NextAuth Upstash
 * adapter's userKeyPrefix is the bare string "user:", which every other key
 * type in this app also starts with (user:tier:, user:email:, user:account:,
 * user:stripe_customer:, user:tier_source:, user:signup_provider:,
 * user:last_active:, …). `user:email:*` is the one prefix that's actually
 * scoped to exactly one key per signed-up account, with no collisions.
 *
 * Each discovered user is added with ZADD ... NX (score 0, "before tracking
 * started" sentinel — see pairsFromFlatZRange in pages/api/admin/users.js).
 * NX means "only if not already present" — safe to re-run any number of
 * times, and safe even if it races with a real new signup: it will never
 * overwrite an already-recorded real timestamp.
 *
 * Their signup PROVIDER (Google vs email) is deliberately left unset, and
 * shows in the admin dashboard as "Unknown" — matching the precedent already
 * shipped for pre-existing Pro grants in lib/pro-source.js. Recovering it
 * from the NextAuth account-linking chain (user:account:by-user-id:<id>) was
 * considered and explicitly deferred — see the plan discussion — since that
 * chain only reflects the *most recently linked* provider for a user who has
 * signed in with more than one method, which would be a silently-wrong
 * "Unknown is more honest than a guess" tradeoff for v1.
 *
 * Usage:
 *   node scripts/backfill-user-signups.js            # dry run — reports only
 *   node scripts/backfill-user-signups.js --apply     # actually writes
 *
 * Reads UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN from the process
 * environment, falling back to .env.local / .env in the project root (same
 * convention as scripts/test-redis.mjs) — so this can be pointed at
 * production by exporting the production values before running it, or by
 * temporarily using a .env.local that has them.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Redis } from '@upstash/redis';

function readEnvVar(name, filePath) {
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(new RegExp(`^${name}\\s*=\\s*["']?(.+?)["']?\\s*$`));
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

function resolveEnv(name) {
  return (
    process.env[name] ||
    readEnvVar(name, resolve(process.cwd(), '.env.local')) ||
    readEnvVar(name, resolve(process.cwd(), '.env'))
  );
}

const url   = resolveEnv('UPSTASH_REDIS_REST_URL');
const token = resolveEnv('UPSTASH_REDIS_REST_TOKEN');

if (!url || !token) {
  console.error('\n❌  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not found in env, .env.local, or .env\n');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');
const redis = new Redis({ url, token });

console.log('\n══════════════════════════════════════════════════════════');
console.log(`  Backfilling stats:users:all  ${APPLY ? '(APPLYING WRITES)' : '(DRY RUN — pass --apply to write)'}`);
console.log('══════════════════════════════════════════════════════════\n');

let cursor = '0';
let scanned = 0;
let added = 0;
let alreadyIndexed = 0;
let batchNum = 0;

do {
  const [nextCursor, keys] = await redis.scan(cursor, { match: 'user:email:*', count: 500 });
  cursor = nextCursor;
  batchNum += 1;

  if (keys.length > 0) {
    const userIds = await redis.mget(...keys);
    scanned += userIds.length;

    for (let i = 0; i < userIds.length; i++) {
      const raw = userIds[i];
      if (!raw) continue; // shouldn't happen, but don't crash the run on one bad key
      const userId = typeof raw === 'object' ? (raw.id ?? String(raw)) : String(raw);

      if (!APPLY) {
        // Dry run: check without writing, so the report reflects reality.
        const existing = await redis.zscore('stats:users:all', userId);
        if (existing !== null) alreadyIndexed++;
        else added++; // "would add"
        continue;
      }

      const result = await redis.zadd('stats:users:all', { nx: true, score: 0, member: userId });
      // ZADD returns the number of NEW elements added (0 if NX skipped it
      // because the member already existed — i.e. it already had a real score).
      if (result > 0) added++;
      else alreadyIndexed++;
    }
  }

  console.log(`  Batch ${batchNum}: scanned ${keys.length} keys (cursor now ${cursor === '0' ? 'DONE' : cursor})`);
} while (cursor !== '0');

console.log('\n──────────────────────────────────────────────────────────');
console.log(`  Total user:email:* keys scanned : ${scanned}`);
console.log(`  ${APPLY ? 'Added to index' : 'Would add'}                    : ${added}`);
console.log(`  Already indexed (skipped)        : ${alreadyIndexed}`);
console.log('──────────────────────────────────────────────────────────');
if (!APPLY) {
  console.log('\n  This was a dry run — no writes were made. Re-run with --apply to write.\n');
} else {
  console.log('\n  Done. Backfilled users show signupProvider: null ("Unknown") and');
  console.log('  signupAt: null ("before tracking started") in /api/admin/users.\n');
}
