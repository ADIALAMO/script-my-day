// Persistent debug / escape-hatch flags (pure resolution + a thin browser layer). Unit-tested in tests/variant-flags.test.js.
//
//   ?variant=off  -> the LEGACY scroll behaviour (touch: the script flows in the page; the old body page scroller). Stored, so it sticks across loads.
//   ?variant=on   -> undoes it.
//   ?debug=1 / ?debug=0 -> the scroll overlay (components/ScrollDebug.jsx). Stored too.
// Stored as JSON {off:0|1, debug:0|1} in localStorage `ls_variant_flags` (iOS home-screen web apps have their OWN localStorage). Nothing in the URL and
// nothing stored = the default (the script window + the document as page scroller). Older stored sets from the preview comparison are ignored.
export const FLAGS_KEY = 'ls_variant_flags';
const EMPTY = { off: false, debug: false };

const param = (search, name) => {
  const m = new RegExp(`(?:^|[?&])${name}=([^&#]*)`).exec(search || '');
  return m ? m[1] : null;
};

/** stored JSON -> flags (anything unreadable or without off / debug = nothing stored) */
export function parseStored(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return null;
    const flags = { off: o.off === 1 || o.off === true, debug: o.debug === 1 || o.debug === true };
    return flags.off || flags.debug ? flags : null;
  } catch { return null; }
}

/**
 * -> { flags: {off, debug}, source: 'url' | 'stored' | 'none', store: object | null, clear: boolean }
 * A flag in the URL overrides the stored value of THAT flag only (so `?debug=1` keeps a stored `off`); `store` = what to write (numbers 0/1), `clear` = remove it.
 */
export function resolveFlags({ search = '', stored = null } = {}) {
  const prev = parseStored(stored) || { ...EMPTY };
  const variant = param(search, 'variant');
  const debug = param(search, 'debug');
  const hasUrl = (variant === 'off' || variant === 'on') || debug === '1' || debug === '0';
  if (!hasUrl) return { flags: prev, source: parseStored(stored) ? 'stored' : 'none', store: null, clear: false };
  const flags = {
    off: variant === 'off' ? true : variant === 'on' ? false : prev.off,
    debug: debug === '1' ? true : debug === '0' ? false : prev.debug,
  };
  if (!flags.off && !flags.debug) return { flags, source: 'url', store: null, clear: true };
  return { flags, source: 'url', store: { off: flags.off ? 1 : 0, debug: flags.debug ? 1 : 0 }, clear: false };
}

let memo = null;

/** Browser layer: resolve once per page load (writes / clears localStorage, every access guarded) and return the flags + diagnostics. */
export function readEffectiveFlags(win = typeof window !== 'undefined' ? window : null) {
  if (memo && memo.win === win) return memo.value;
  if (!win) return { search: '', stored: null, source: 'none', flags: { ...EMPTY } };
  let storedRaw = null;
  try { storedRaw = win.localStorage.getItem(FLAGS_KEY); } catch { /* storage unavailable: URL only */ }
  const search = win.location?.search || '';
  const r = resolveFlags({ search, stored: storedRaw });
  try {
    if (r.clear) win.localStorage.removeItem(FLAGS_KEY);
    else if (r.store) win.localStorage.setItem(FLAGS_KEY, JSON.stringify(r.store));
  } catch { /* the in-memory result still holds for this page load */ }
  const value = { search, stored: storedRaw, source: r.source, flags: r.flags };
  memo = { win, value };
  return value;
}

/** test hook */
export function _resetFlagsMemo() { memo = null; }
