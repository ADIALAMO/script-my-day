/**
 * Sweep for reported ("hidden") images whose object is STILL in the public bucket — e.g. the quarantine copy failed after its inline retries, or
 * the private bucket was not configured at the time of the report. Used by the daily cron (pages/api/cron/sweep-hidden.js) and by
 * `scripts/takedown-object.mjs sweep`. It only ever MOVES objects (copy to the private bucket, then delete the public original — lib/quarantine.js);
 * it never deletes anything on its own and never touches an object that is not already marked hidden.
 */

const HIDDEN_PREFIX = 'report:hidden:';

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
  for (const key of keys) {
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
