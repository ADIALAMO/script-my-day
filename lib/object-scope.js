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

export const isCharacterKey = (key) => typeof key === 'string' && key.length <= MAX_KEY_LEN && CHARACTER_KEY.test(key);

/** owner segment (HMAC hex) of a current-format character key, or null */
export function characterOwnerSegment(key) {
  const m = typeof key === 'string' ? CHARACTER_KEY.exec(key) : null;
  return m ? m[1] : null;
}

/** true when the moderation tooling may move / sweep this object */
export const isModeratedKey = (key) =>
  typeof key === 'string' && key.length <= MAX_KEY_LEN && !key.includes('..') && (GENERATED_PREFIX.test(key) || CHARACTER_KEY.test(key));
