#!/usr/bin/env node
/**
 * One-time backfill: give the guest lifetime-poster counters (usage:poster:lifetime:<ip>) written BEFORE the 90-day
 * expiry existed a TTL. Those keys have no expiry, so an IP / IPv6 /64 would otherwise stay in Redis until the guest
 * returns (new keys get their TTL on first use — see lib/poster-quota.js).
 *
 *   node scripts/backfill-guest-ttl.js              # DRY RUN (default): counts keys, changes nothing
 *   node scripts/backfill-guest-ttl.js --execute    # EXPIRE <GUEST_RETENTION.ipDays * 86400> on keys that have no TTL
 *
 * Only keys WITHOUT a TTL are touched (keys that already expire are left alone, so re-running is safe and a guest who
 * is active keeps the refreshed clock). The days come from config/limits.js (GUEST_IP_RETENTION_DAYS, default 90).
 * Needs UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN. Prints counts and a few masked sample keys, never full IPs.
 */
import { pathToFileURL } from 'node:url';
import { GUEST_RETENTION } from '../config/limits.js';

const PATTERN = 'usage:poster:lifetime:*';
const PREFIX = 'usage:poster:lifetime:';
export const maskKey = (k) => { const id = k.slice(PREFIX.length); return `${PREFIX}${id.slice(0, 4)}…(${id.length} chars)`; };

async function scanAll(redis, match) {
  const out = []; let cursor = '0';
  do {
    const res = await redis.scan(cursor, { match, count: 500 });
    cursor = String(res[0]); out.push(...(res[1] || []));
  } while (cursor !== '0');
  return [...new Set(out)];
}

/** @returns {{scanned:number, withoutTtl:number, updated:number, errors:string[]}} */
export async function backfill({ redis, execute = false, days = GUEST_RETENTION.ipDays, out = console.log }) {
  const ttlSec = Math.floor(days * 86400);
  const keys = (await scanAll(redis, PATTERN)).filter((k) => k.startsWith(PREFIX));
  const without = [];
  for (const k of keys) {
    const ttl = Number(await redis.ttl(k));
    if (ttl === -1) without.push(k);                    // -1 = key exists, no expiry; -2 = gone; >=0 = already expires
  }
  const res = { scanned: keys.length, withoutTtl: without.length, updated: 0, errors: [] };
  out(`Found ${res.scanned} guest poster keys; ${res.withoutTtl} have NO expiry (${res.scanned - res.withoutTtl} already expire).`);
  without.slice(0, 5).forEach((k) => out(`  e.g. ${maskKey(k)}`));
  if (!execute) { out(`DRY RUN — nothing changed. --execute would set EXPIRE ${ttlSec}s (${days} days) on ${res.withoutTtl} keys.`); return res; }
  for (const k of without) {
    try {
      const ttl = Number(await redis.ttl(k));
      if (ttl !== -1) continue;                         // changed meanwhile (guest came back and got a TTL, or it expired)
      await redis.expire(k, ttlSec); res.updated++;
    } catch (e) { res.errors.push(`${maskKey(k)}: ${e.message}`); }
  }
  out(`Done: ${res.updated} keys now expire in ${days} days; ${res.errors.length} errors.`);
  res.errors.forEach((e) => out(`  ERROR ${e}`));
  return res;
}

async function main() {
  const execute = process.argv.includes('--execute');
  const unknown = process.argv.slice(2).filter((a) => a !== '--execute');
  if (unknown.length) throw new Error(`Unknown argument: ${unknown[0]}`);
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) throw new Error('UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set.');
  const { Redis } = await import('@upstash/redis');
  const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: process.env.UPSTASH_REDIS_REST_TOKEN });
  const r = await backfill({ redis, execute });
  process.exit(r.errors.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error(`Error: ${e.message}`); process.exit(1); });
}
