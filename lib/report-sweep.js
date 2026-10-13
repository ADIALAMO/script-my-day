/**
 * Sweep for reported ("hidden") images whose object is STILL in the public bucket — e.g. the quarantine copy failed after its inline retries, or
 * the private bucket was not configured at the time of the report. Used by the daily cron (pages/api/cron/sweep-hidden.js) and by
 * `scripts/takedown-object.mjs sweep`. It only ever MOVES objects (copy to the private bucket, then delete the public original — lib/quarantine.js);
 * it never deletes anything on its own and never touches an object that is not already marked hidden.
 */

import { isModeratedKey } from './object-scope.js';

const HIDDEN_PREFIX = 'report:hidden:';
export const SWEEP_CURSOR_KEY = 'report:sweep:cursor';

/** only generated panels / posters and current-format Star Yourself objects are ever swept (lib/object-scope.js) — nothing else, even if a hidden mark somehow exists for it */
export const isSweepableKey = isModeratedKey;

/**
 * Object keys that currently have a hidden mark (hash-only marks `report:hidden:h:<sha256>` are skipped: they have no object yet).
 * @param {{ scan: (cursor: string|number, opts: {match: string, count: number}) => Promise<[string|number, string[]]> }} redis  (@upstash/redis shape)
 * @param {number} max   stop after this many keys
 */
export async function scanHiddenKeys(redis, max = 1000) {
  const keys = []; let cursor = 0;
  do {
    const [next, batch] = await redis.scan(cursor, { match: `${HIDDEN_PREFIX}*`, count: 200 });
    for (const k of batch || []) {
      const objectKey = String(k).slice(HIDDEN_PREFIX.length);
      if (!objectKey.startsWith('h:')) keys.push(objectKey);
      if (keys.length >= max) return keys;
    }
    cursor = next;
  } while (String(cursor) !== '0');
  return keys;
}

/**
 * @param {{ keys: string[], headPublic: (key:string)=>Promise<boolean>, quarantine?: (key:string)=>Promise<{status:string,error?:string}>, apply?: boolean,
 *           deadlineMs?: number, now?: ()=>number }} deps
 * @returns {Promise<{ examined: number, stillPublic: string[], moved: number, failed: string[], notConfigured: boolean, timedOut: boolean }>}
 *   apply=false → only reports which keys are still public (nothing is moved).
 */
export async function sweepHidden({ keys, headPublic, quarantine, apply = true, deadlineMs = Infinity, now = Date.now }) {
  const out = { examined: 0, stillPublic: [], moved: 0, failed: [], notConfigured: false, timedOut: false };
  const t0 = now();
  for (const key of keys.filter(isSweepableKey)) {
    if (now() - t0 > deadlineMs) { out.timedOut = true; break; }
    out.examined += 1;
    let isPublic = false;
    try { isPublic = await headPublic(key); } catch { continue; }   // an R2 error on one key must not stop the sweep (it is retried tomorrow)
    if (!isPublic) continue;
    out.stillPublic.push(key);
    if (!apply || !quarantine) continue;
    const q = await quarantine(key);
    if (q.status === 'moved') out.moved += 1;
    else if (q.status === 'not-configured') { out.notConfigured = true; break; }   // nothing can be moved without the private bucket: stop and report
    else out.failed.push(key);
  }
  return out;
}

/**
 * The daily cron's loop: walks `report:hidden:*` PAGE BY PAGE with a persisted SCAN cursor, so a long list is finished over several runs instead
 * of re-reading the same first page every day (hidden marks are kept for ~13 months). A page is fully processed before the cursor moves on; if the
 * deadline hits mid-page (or the private bucket is not configured) the cursor stays on that page and the next run redoes it (moves are idempotent).
 * @param {{ redis: {scan, get, set, del}, headPublic, quarantine, deadlineMs?: number, maxKeys?: number, now?: ()=>number }} deps
 * @returns {Promise<{ examined, stillPublic: string[], moved, failed: string[], notConfigured, timedOut, finished: boolean }>}
 */
export async function sweepPaged({ redis, headPublic, quarantine, deadlineMs = 45_000, maxKeys = 1000, now = Date.now }) {
  const agg = { examined: 0, stillPublic: [], moved: 0, failed: [], notConfigured: false, timedOut: false, finished: false };
  const t0 = now();
  let cursor = '0';
  try { cursor = String((await redis.get(SWEEP_CURSOR_KEY)) ?? '0'); } catch { cursor = '0'; }
  if (!/^\d+$/.test(cursor)) cursor = '0';
  while (true) {
    const [next, batch] = await redis.scan(cursor, { match: `${HIDDEN_PREFIX}*`, count: 200 });
    const keys = (batch || []).map((k) => String(k).slice(HIDDEN_PREFIX.length)).filter((k) => !k.startsWith('h:'));
    const r = await sweepHidden({ keys, headPublic, quarantine, apply: true, deadlineMs: Math.max(0, deadlineMs - (now() - t0)), now });
    agg.examined += r.examined; agg.stillPublic.push(...r.stillPublic); agg.moved += r.moved; agg.failed.push(...r.failed);
    if (r.timedOut || r.notConfigured) { agg.timedOut = r.timedOut; agg.notConfigured = r.notConfigured; break; }   // keep the cursor on this page
    cursor = String(next);
    if (cursor === '0') { agg.finished = true; break; }
    if (agg.examined >= maxKeys || now() - t0 > deadlineMs) { agg.timedOut = now() - t0 > deadlineMs; break; }
  }
  try {
    if (agg.finished) await redis.del(SWEEP_CURSOR_KEY);
    else await redis.set(SWEEP_CURSOR_KEY, cursor, { ex: 3 * 24 * 3600 });
  } catch { /* the next run simply starts from wherever the stored cursor is (or 0) */ }
  return agg;
}
