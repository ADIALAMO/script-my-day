/**
 * Lifecycle helpers for "Star Yourself" objects in the PUBLIC bucket (characters/<owner>/<uuid>-raw|sheet.<ext>).
 *
 *   deleteRawSelfie(key)         the raw photo exists only to feed the sheet generator; it is deleted after EVERY attempt, success or not. Three tries; if the
 *                                delete still fails the object is marked hidden (report:hidden:<key> — the daily sweep then moves it to the private bucket) and the owner
 *                                of the app is alerted. Never throws.
 *   deletePreviousCharacter(id, pointer, keep)   after a re-upload has stored the new sheet AND written the new pointer: deletes the objects the OLD pointer named,
 *                                only those inside the caller's own scope and never a key in `keep`. One try each; a failure is logged (class/http only) and ignored.
 *   removeCharacterObjects(id)   the owner's "remove my character": deletes every object under the caller's own HMAC folder plus the objects their pointer names
 *                                (only keys that are in the caller's own folder), then the Redis pointer. Throws when something could not be deleted (the pointer is
 *                                kept so the user can retry).
 */
import redis from './redis.js';
import { deleteObject, listKeys, keyFromPublicUrl } from './blob-store.js';
import { ownerSegment } from './upload-image.js';
import { CHARACTER_KEY, characterOwnerSegment, isOwnLegacyCharacterKey } from './object-scope.js';
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

/**
 * "Remove my character": deletes EVERYTHING of the caller's own Star Yourself objects, then the pointer, and says honestly what happened.
 *   current format   every object under characters/<caller's HMAC owner>/ (+ what the pointer names, only inside that folder)
 *   legacy format    characters/<id>-(raw|sheet)-<stamp>.jpg whose embedded id EQUALS the caller's identifier exactly (listed by the "characters/<id>-" prefix, then filtered
 *                    by an exact comparison — "u:abc" never matches "u:abcd-…", "u:abc-def-…" or "xu:abc-…"; a pointer naming someone else's key is ignored)
 * The pointer is ALWAYS removed (the app stops offering / using the character at once); objects are found by listing, not by the pointer, so a repeat call can finish what a failed
 * delete left behind. Objects that could not be deleted are marked hidden (the app never uses them again).
 * @returns {Promise<{ status: 'removed'|'partial'|'nothing-found', matched: number, deleted: number, failed: number, partial: boolean }>}
 *   removed        at least one object matched and every one was deleted
 *   partial        some objects could not be deleted (their count is in `failed`)
 *   nothing-found  no stored object matched (already removed, or never stored): NOT reported as a full success
 * Throws only when the pointer itself could not be removed (the caller answers a retryable error).
 */
export async function removeCharacterObjects(identifier) {
  const owner = ownerSegment(identifier);
  const keys = new Set();
  const consider = (k) => {
    if (typeof k !== 'string') return;
    if (CHARACTER_KEY.test(k) && characterOwnerSegment(k) === owner) keys.add(k);   // current format, the caller's own folder only
    else if (isOwnLegacyCharacterKey(k, identifier)) keys.add(k);                  // legacy format, exact embedded id only
  };
  for (const k of await listKeys(`characters/${owner}/`)) consider(k);
  for (const k of await listKeys(`characters/${identifier}-`)) consider(k);          // prefix is only a listing hint; `consider` makes the exact decision
  // The pointer is NOT consulted for keys: only objects that really exist (found by the listings) are matched, so "nothing found" is reported truthfully and a pointer
  // naming someone else's object (or a stale one) can never widen what is deleted.
  let deleted = 0; const stuck = [];
  for (const k of keys) {
    try { await deleteObject(k); deleted += 1; } catch { stuck.push(k); }
  }
  for (const k of stuck) await markHiddenForCleanup(k, 'owner-removal');
  await redis.del(`character:${identifier}`);                                            // throws → the route answers a retryable error
  const matched = keys.size; const failed = stuck.length;
  const status = matched === 0 ? 'nothing-found' : failed ? 'partial' : 'removed';
  return { status, matched, deleted, failed, partial: status !== 'removed' };
}

/**
 * Replace flow cleanup. `previous` is the pointer that existed BEFORE the new one was written (string or parsed object). Keys come from the pointer's URLs but are only
 * deleted when they are provably the caller's: current format = exact HMAC owner folder match, legacy format = exact embedded-id match. Anything else (another user's key,
 * a foreign URL, junk) is ignored, as is every key in `keep` (the newly written objects). Never throws; a failed delete leaves the object for the daily sweep / "Remove my character".
 * @returns {Promise<{ deleted: number, failed: number }>}
 */
export async function deletePreviousCharacter(identifier, previous, keep = []) {
  let data = previous;
  try { if (typeof data === 'string') data = JSON.parse(data); } catch { return { deleted: 0, failed: 0 }; }
  if (!data || typeof data !== 'object') return { deleted: 0, failed: 0 };
  const owner = ownerSegment(identifier);
  const keepSet = new Set(keep);
  const keys = new Set();
  for (const url of [data.url, data.styledUrl]) {
    const k = keyFromPublicUrl(url);
    if (!k || keepSet.has(k)) continue;
    if ((CHARACTER_KEY.test(k) && characterOwnerSegment(k) === owner) || isOwnLegacyCharacterKey(k, identifier)) keys.add(k);
  }
  let deleted = 0; let failed = 0;
  for (const k of keys) {
    try { await deleteObject(k); deleted += 1; } catch (e) {
      failed += 1;
      console.warn(`⚠️ previous character object could not be deleted (${formatSafeErr(safeErrInfo(e))}); left for the daily sweep / "Remove my character"`);
    }
  }
  return { deleted, failed };
}
