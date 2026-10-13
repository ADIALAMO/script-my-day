// First-run flag for the guided tour. Storage can be missing or throw (private window, blocked data, WebView quirks), so every access is
// wrapped; an in-memory flag keeps the tour from re-prompting within the session when it cannot persist.
export const TOUR_KEY = 'ls_tour_done_v1';
let memDone = false;

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

/** test hook */
export function _resetTourMemory() { memDone = false; }
