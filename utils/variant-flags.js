// Persistent preview-variant flags (pure resolution + a thin browser layer). Unit-tested in tests/variant-flags.test.js.
//
// ?scriptbox=1 / ?rootscroll=1 / ?contain=1 / ?debug=1 select the script-box preview variants (utils/scroll-mode.js). A query string does not survive
// everything (an auth / SSO redirect, a bookmark, a link without it), so when any of them is in the URL the set is STORED (localStorage `ls_variant_flags`)
// and read on every load; `?variant=off` clears it. No flag in the URL and nothing stored = the default (unchanged for everyone else).
export const FLAGS_KEY = 'ls_variant_flags';
export const FLAG_NAMES = ['scriptbox', 'rootscroll', 'contain', 'debug'];
const EMPTY = { scriptbox: false, rootscroll: false, contain: false, debug: false };

const param = (search, name) => {
  const m = new RegExp(`(?:^|[?&])${name}=([^&#]*)`).exec(search || '');
  return m ? m[1] : null;
};

/** stored JSON -> flags (anything unreadable = nothing stored) */
export function parseStored(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    const flags = { ...EMPTY };
    let any = false;
    for (const n of FLAG_NAMES) { if (o[n] === 1 || o[n] === true) { flags[n] = true; any = true; } }
    return any ? flags : null;
  } catch { return null; }
}

/**
 * -> { flags, source: 'url' | 'stored' | 'cleared' | 'none', store: object | null, clear: boolean }
 * `store` = what to write (numbers 0/1), `clear` = remove the stored value.
 */
export function resolveFlags({ search = '', stored = null } = {}) {
  if (param(search, 'variant') === 'off') return { flags: { ...EMPTY }, source: 'cleared', store: null, clear: true };
  const present = FLAG_NAMES.filter((n) => param(search, n) !== null);
  if (present.length) {
    const flags = { ...EMPTY };
    for (const n of present) flags[n] = param(search, n) === '1';
    return { flags, source: 'url', store: Object.fromEntries(FLAG_NAMES.map((n) => [n, flags[n] ? 1 : 0])), clear: false };
  }
  const s = parseStored(stored);
  return s ? { flags: s, source: 'stored', store: null, clear: false } : { flags: { ...EMPTY }, source: 'none', store: null, clear: false };
}

/** flags -> a search string the existing parsers understand ('?scriptbox=1&rootscroll=1') */
export function flagsToSearch(flags) {
  const parts = FLAG_NAMES.filter((n) => flags?.[n]).map((n) => `${n}=1`);
  return parts.length ? `?${parts.join('&')}` : '';
}

let memo = null;

/** Browser layer: resolve once per page load (writes / clears localStorage, every access guarded) and return the effective search + diagnostics. */
export function readEffectiveFlags(win = typeof window !== 'undefined' ? window : null) {
  if (memo && memo.win === win) return memo.value;
  if (!win) return { search: '', stored: null, source: 'none', flags: { ...EMPTY }, effectiveSearch: '' };
  let storedRaw = null;
  try { storedRaw = win.localStorage.getItem(FLAGS_KEY); } catch { /* storage unavailable: URL only */ }
  const search = win.location?.search || '';
  const r = resolveFlags({ search, stored: storedRaw });
  try {
    if (r.clear) win.localStorage.removeItem(FLAGS_KEY);
    else if (r.store) win.localStorage.setItem(FLAGS_KEY, JSON.stringify(r.store));
  } catch { /* the in-memory result still holds for this page load */ }
  const value = { search, stored: storedRaw, source: r.source, flags: r.flags, effectiveSearch: flagsToSearch(r.flags) };
  memo = { win, value };
  return value;
}

/** test hook */
export function _resetFlagsMemo() { memo = null; }
