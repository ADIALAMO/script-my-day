// Tour flags. Storage can be missing or throw (private window, blocked data, WebView quirks), so every access is wrapped; in-memory copies
// keep the tour from re-prompting within the session when it cannot persist.
//  ls_tour_done_v1  — chapter 1 resolved (finished OR skipped). Kept from the first tour release.
//  ls_tour_ch_v1    — {done:[chapter ids finished], off:true once the user skipped}. Chapters 2-4 auto-run only for a user who FINISHED chapter 1
//                     in this version (done includes 1), never after a skip, once each.
export const TOUR_KEY = 'ls_tour_done_v1';
export const CHAPTERS_KEY = 'ls_tour_ch_v1';
let memDone = false;
let memChapters = { done: [], off: false };

function defaultStorage() {
  try { return typeof window !== 'undefined' ? window.localStorage : null; } catch { return null; }
}

export function isTourDone(storage = defaultStorage()) {
  if (memDone) return true;
  try { return !!storage && storage.getItem(TOUR_KEY) === '1'; } catch { return false; }
}

export function markTourDone(storage = defaultStorage()) {
  memDone = true;
  try { storage?.setItem(TOUR_KEY, '1'); } catch { /* the in-memory flag still holds for this session */ }
}

export function readChapters(storage = defaultStorage()) {
  let stored = { done: [], off: false };
  try {
    const raw = storage ? storage.getItem(CHAPTERS_KEY) : null;
    const p = raw ? JSON.parse(raw) : null;
    if (p && typeof p === 'object') stored = { done: Array.isArray(p.done) ? p.done.filter(Number.isInteger) : [], off: p.off === true };
  } catch { /* unreadable = empty */ }
  return { done: [...new Set([...stored.done, ...memChapters.done])], off: stored.off || memChapters.off };
}

function writeChapters(next, storage) {
  memChapters = next;
  try { storage?.setItem(CHAPTERS_KEY, JSON.stringify(next)); } catch { /* memory copy still holds */ }
}

export function markChapterDone(id, storage = defaultStorage()) {
  const cur = readChapters(storage);
  if (!cur.done.includes(id)) writeChapters({ ...cur, done: [...cur.done, id] }, storage);
}

/** Skip = permanent: no chapter auto-starts any more (the Guide menu still replays them) */
export function setAutoOff(storage = defaultStorage()) {
  writeChapters({ ...readChapters(storage), off: true }, storage);
}

/** test hook */
export function _resetTourMemory() { memDone = false; memChapters = { done: [], off: false }; }
