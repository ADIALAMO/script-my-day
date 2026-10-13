/**
 * Lifecycle helpers for "Star Yourself" objects in the PUBLIC bucket (characters/<owner>/<uuid>-raw|sheet.<ext>).
 *
 *   deleteRawSelfie(key)         the raw photo exists only to feed the sheet generator; it is deleted after EVERY attempt, success or not. Three tries; if the
 *                                delete still fails the object is marked hidden (report:hidden:<key> — the daily sweep then moves it to the private bucket) and the owner
 *                                of the app is alerted. Never throws.
 *   removeCharacterObjects(id)   the owner's "remove my character": deletes every object under the caller's own HMAC folder plus the objects their pointer names
 *                                (only keys that are in the caller's own folder), then the Redis pointer. Throws when something could not be deleted (the pointer is
 *                                kept so the user can retry).
 */
import redis from './redis.js';
import { deleteObject, keyFromPublicUrl, listKeys } from './blob-store.js';
import { ownerSegment } from './upload-image.js';
import { CHARACTER_KEY, characterOwnerSegment } from './object-scope.js';
import { markHiddenForCleanup } from './report.js';
import { alertOnce } from './alert-throttle.js';
import { safeErrInfo, formatSafeErr } from './safe-error.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @returns {Promise<'deleted'|'hidden'|'stuck'>} deleted = gone; hidden = delete failed but the object is marked for the sweep; stuck = neither worked */
export async function deleteRawSelfie(key, { attempts = 3, backoffMs = [150, 450] } = {}) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { await deleteObject(key); return 'deleted'; } catch (e) { last = e; }
    if (i < attempts - 1) await sleep(backoffMs[Math.min(i, backoffMs.length - 1)]);
  }
  const marked = await markHiddenForCleanup(key, 'raw-selfie-cleanup');
  console.error(`🛑 raw selfie could not be deleted after ${attempts} tries (${formatSafeErr(safeErrInfo(last))}); ${marked ? 'marked hidden for the daily sweep' : 'COULD NOT BE MARKED — remove it by hand'}`);
  try {
    await alertOnce(`raw-selfie-stuck:${String(key).slice(-40)}`,
      `🛑 *Raw selfie not deleted*\nKey: \`${String(key).replace(/[\`\\]/g, '')}\`\n${marked ? 'Marked hidden: the daily sweep moves it to the private bucket.' : '⚠️ Not marked — delete it by hand (scripts/takedown-object.mjs).'}`,
      { windowSec: 24 * 60 * 60 });
  } catch { /* the log line above is the fallback */ }
  return marked ? 'hidden' : 'stuck';
}

/** @returns {Promise<{ deleted: number }>} */
export async function removeCharacterObjects(identifier) {
  const owner = ownerSegment(identifier);
  const keys = new Set(await listKeys(`characters/${owner}/`));
  try {
    const raw = await redis.get(`character:${identifier}`);
    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    for (const u of [data?.url, data?.styledUrl]) {
      const k = keyFromPublicUrl(u);
      if (k && CHARACTER_KEY.test(k) && characterOwnerSegment(k) === owner) keys.add(k);   // only ever the caller's OWN folder
    }
  } catch { /* the folder listing above is authoritative */ }
  let deleted = 0; let failed = 0;
  for (const k of keys) {
    if (characterOwnerSegment(k) !== owner) continue;
    try { await deleteObject(k); deleted += 1; } catch { failed += 1; }
  }
  if (failed) throw new Error(`${failed} object(s) could not be deleted`);
  await redis.del(`character:${identifier}`);
  return { deleted };
}
