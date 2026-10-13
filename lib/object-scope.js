/**
 * Which R2 objects the moderation tooling (report → quarantine, daily sweep) may touch. ONE definition, shared by lib/report.js,
 * lib/quarantine.js and lib/report-sweep.js so they can never drift apart.
 *
 *   panels/ and posters/   generated images (any key shape, legacy included)
 *   characters/<owner>/<uuid>-(raw|sheet).<ext>   the CURRENT key shape of a "Star Yourself" upload (lib/upload-image.js buildCharacterKeys).
 *       Legacy character keys (characters/u:<id>-…, characters/<id>-raw-<stamp>.jpg) carry a user id and are deliberately NOT in scope:
 *       they are handled by hand (scripts/takedown-object.mjs, scripts/delete-user-data.js).
 * Anything else (traversal, other prefixes, junk) is out of scope — nothing is ever moved or deleted for it.
 */
export const CHARACTER_KEY = /^characters\/([0-9a-f]{32})\/([0-9a-f-]{36})-(raw|sheet)\.(png|jpg|webp)$/;
const GENERATED_PREFIX = /^(panels|posters)\//;
const MAX_KEY_LEN = 300;

/**
 * LEGACY Star Yourself keys (written until 2026-10-09): characters/<id>-(raw|sheet)-<stamp>.jpg where <id> is the uploader's identifier (u:<user id>).
 * NOT part of the moderation scope above (they embed a user id → manual tooling only); this parser exists so "Remove my character" can delete a caller's OWN legacy
 * objects. Ownership is an EXACT comparison of the embedded id with the caller's identifier — never a prefix match.
 */
const LEGACY_CHARACTER_KEY = /^characters\/([^/]+?)-(raw|sheet)-(\d+)\.jpg$/;
export function parseLegacyCharacterKey(key) {
  const m = typeof key === 'string' && key.length <= MAX_KEY_LEN && !key.includes('..') ? LEGACY_CHARACTER_KEY.exec(key) : null;
  return m ? { id: m[1], kind: m[2], stamp: m[3] } : null;
}
/** true only when `key` is a legacy character object whose embedded id is EXACTLY `identifier` */
export const isOwnLegacyCharacterKey = (key, identifier) => typeof identifier === 'string' && identifier !== '' && parseLegacyCharacterKey(key)?.id === identifier;

export const isCharacterKey = (key) => typeof key === 'string' && key.length <= MAX_KEY_LEN && CHARACTER_KEY.test(key);

/** owner segment (HMAC hex) of a current-format character key, or null */
export function characterOwnerSegment(key) {
  const m = typeof key === 'string' ? CHARACTER_KEY.exec(key) : null;
  return m ? m[1] : null;
}

/** true when the moderation tooling may move / sweep this object */
export const isModeratedKey = (key) =>
  typeof key === 'string' && key.length <= MAX_KEY_LEN && !key.includes('..') && (GENERATED_PREFIX.test(key) || CHARACTER_KEY.test(key));
