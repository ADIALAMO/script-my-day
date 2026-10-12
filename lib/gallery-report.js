/**
 * Reports on the STATIC gallery (public/gallery/*, public/reels/*): these files ship with the app, they are not in R2, so there is nothing to
 * quarantine. A report hides the item on the reporter's device (utils/reported-store.js) and sends the owner a Telegram alert naming the file so it
 * can be removed with `git rm` in a deploy. Nothing is hidden globally and no Redis list is kept.
 *
 * A ref is `{ gallery: 'poster:<id>' }` or `{ gallery: 'reel:<id>' }`. It is only ever a LOOKUP KEY into the showcase lists below: the file path
 * is taken from the list, never from the client, so an unknown id, a path or a traversal string resolves to nothing.
 */
import { SHOWCASE_POSTERS, SHOWCASE_REELS } from '../constants/showcase.js';

const REF = /^(poster|reel):[A-Za-z0-9-]{1,40}$/;

/** the ref string for a showcase poster or reel id */
export const galleryRefId = (type, id) => `${type}:${id}`;

let _index = null;
function index() {
  if (_index) return _index;
  const m = new Map();
  for (const p of SHOWCASE_POSTERS) if (p?.src) m.set(galleryRefId('poster', p.id), { id: galleryRefId('poster', p.id), paths: [p.src] });          // text-only posters have no image
  for (const r of SHOWCASE_REELS) if (r?.src) m.set(galleryRefId('reel', r.id), { id: galleryRefId('reel', r.id), paths: [r.src, r.poster].filter(Boolean) });
  return (_index = m);
}

/** { id, paths } for a valid gallery ref, otherwise null (anything that is not a known showcase id) */
export function resolveGalleryRef(value) {
  if (typeof value !== 'string' || !REF.test(value)) return null;
  return index().get(value) ?? null;
}

/** the items whose gallery ref the user has reported (a Set of ref strings) are dropped */
export function filterVisibleGallery(items, type, reportedRefs) {
  if (!reportedRefs || !reportedRefs.size) return items;
  return items.filter((it) => !reportedRefs.has(galleryRefId(type, it.id)));
}
