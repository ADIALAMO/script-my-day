// Remembers which images the user reported, so they stay hidden. Image URLs (our R2 links) and hashes persist in localStorage; a
// freshly generated image that is still only a data: URI is remembered for this session in memory (it is far too big to persist).
// Every storage access is wrapped: private windows / blocked storage must never break the UI.
const LS_KEY = 'lifescript_reported';
const MAX = 300;
const mem = new Set();

function readPersisted() {
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage.getItem(LS_KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string') : [];
  } catch { return []; }
}

/** true when this exact URL / data URI was reported on this device */
export function isReported(src) {
  if (!src || typeof src !== 'string') return false;
  if (mem.has(src)) return true;
  return !src.startsWith('data:') && readPersisted().includes(src);
}

/** remember reported sources (URLs persist; data URIs only for this session) */
export function markReported(sources = []) {
  const persist = [];
  for (const s of sources) {
    if (typeof s !== 'string' || !s) continue;
    mem.add(s);
    if (!s.startsWith('data:')) persist.push(s);
  }
  if (!persist.length) return;
  try {
    const next = [...new Set([...readPersisted(), ...persist])].slice(-MAX);
    window.localStorage.setItem(LS_KEY, JSON.stringify(next));
  } catch { /* storage unavailable — the in-memory copy still hides it for this session */ }
}

/** the gallery refs ('poster:49', 'reel:reel-action-4') the user reported on this device (stored as 'gallery:<ref>') */
export function reportedGalleryRefs() {
  const out = new Set();
  const take = (s) => { if (typeof s === 'string' && s.startsWith('gallery:')) out.add(s.slice('gallery:'.length)); };
  mem.forEach(take);
  readPersisted().forEach(take);
  return out;
}

/** a short, stable, NON-reversible fingerprint of a script's text (djb2) — only used to keep a reported script hidden on this device; never sent anywhere */
export function scriptKey(text) {
  const t = typeof text === 'string' ? text : '';
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) | 0;
  return `script:${(h >>> 0).toString(36)}:${t.length}`;
}
export const isScriptReported = (text) => !!text && isReported(scriptKey(text));
export const markScriptReported = (text) => { if (text) markReported([scriptKey(text)]); };
