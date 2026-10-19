import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const { FLAGS_KEY, DEBUG_ALLOWED, parseStored, resolveFlags, readEffectiveFlags, _resetFlagsMemo } = await import('../utils/variant-flags.js');

const fakeWin = ({ search = '', stored = null, throwing = false } = {}) => {
  const m = stored === null ? {} : { [FLAGS_KEY]: stored };
  return {
    location: { search },
    localStorage: throwing
      ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
      : { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m },
  };
};

test('default: no flag in the URL and nothing stored = NOT off, NOT debug (the new default for everyone)', () => {
  const r = resolveFlags({ search: '' });
  assert.deepEqual(r.flags, { off: false, debug: false }); assert.equal(r.source, 'none'); assert.equal(r.store, null); assert.equal(r.clear, false);
  assert.deepEqual(resolveFlags({ search: '?ref=abc&checkout=success' }).flags, { off: false, debug: false });
  // the preview-comparison flags are gone: they change nothing
  for (const q of ['?scriptbox=1', '?scriptbox=1&rootscroll=1&contain=1', '?rootscroll=1']) assert.deepEqual(resolveFlags({ search: q }).flags, { off: false, debug: false }, q);
});

test('?variant=off is the escape hatch: stored, sticky across loads, undone by ?variant=on; ?debug=1 / 0 independent and merged', () => {
  const off = resolveFlags({ search: '?variant=off' });
  assert.deepEqual(off.flags, { off: true, debug: false }); assert.equal(off.source, 'url'); assert.deepEqual(off.store, { off: 1, debug: 0 });
  const sticky = resolveFlags({ search: '', stored: JSON.stringify(off.store) });
  assert.deepEqual(sticky.flags, { off: true, debug: false }); assert.equal(sticky.source, 'stored');
  const on = resolveFlags({ search: '?variant=on', stored: JSON.stringify(off.store) });
  assert.deepEqual(on.flags, { off: false, debug: false }); assert.equal(on.clear, true);
  // ?debug=1 keeps a stored off, ?debug=0 turns only debug off
  const dbg = resolveFlags({ search: '?debug=1', stored: JSON.stringify({ off: 1, debug: 0 }) });
  assert.deepEqual(dbg.flags, { off: true, debug: true }); assert.deepEqual(dbg.store, { off: 1, debug: 1 });
  const dbgOff = resolveFlags({ search: '?debug=0', stored: JSON.stringify({ off: 0, debug: 1 }) });
  assert.deepEqual(dbgOff.flags, { off: false, debug: false }); assert.equal(dbgOff.clear, true);
  assert.deepEqual(resolveFlags({ search: '?variant=off&debug=1' }).store, { off: 1, debug: 1 });
  assert.deepEqual(resolveFlags({ search: '?variant=maybe' }).flags, { off: false, debug: false });   // anything else is ignored
});

test('stored values: old preview sets and garbage are ignored, never "off" by accident', () => {
  for (const bad of [null, '', 'garbage', '{', '[]', 'null', '{"off":0,"debug":0}', '{"off":"yes"}']) assert.equal(parseStored(bad), null, String(bad));
  assert.equal(parseStored(JSON.stringify({ scriptbox: 1, rootscroll: 1, contain: 1, debug: 0 })), null);     // an old variant set from the preview
  assert.deepEqual(parseStored(JSON.stringify({ scriptbox: 1, rootscroll: 1, contain: 0, debug: 1 })), { off: false, debug: true });
  assert.deepEqual(parseStored('{"off":true}'), { off: true, debug: false });
  assert.equal(resolveFlags({ search: '', stored: '{"scriptbox":1,"rootscroll":1,"contain":1,"debug":0}' }).flags.off, false);
});

test('browser layer: persists off / debug, survives a reload without the query, ?variant=on clears, tolerates blocked storage', () => {
  _resetFlagsMemo();
  // in this (production-like) test env NEXT_PUBLIC_SCROLL_DEBUG is unset: ?debug=1 is IGNORED, only `off` persists
  const w1 = fakeWin({ search: '?variant=off&debug=1' });
  assert.deepEqual(readEffectiveFlags(w1).flags, { off: true, debug: false });
  assert.equal(w1.localStorage._m[FLAGS_KEY], JSON.stringify({ off: 1, debug: 0 }));
  _resetFlagsMemo();
  const w2 = fakeWin({ search: '', stored: w1.localStorage._m[FLAGS_KEY] });
  const r2 = readEffectiveFlags(w2);
  assert.deepEqual(r2.flags, { off: true, debug: false }); assert.equal(r2.source, 'stored');
  assert.equal(readEffectiveFlags(w2), r2, 'resolved once per page load');
  _resetFlagsMemo();
  const w3 = fakeWin({ search: '?variant=on&debug=0', stored: w1.localStorage._m[FLAGS_KEY] });
  assert.deepEqual(readEffectiveFlags(w3).flags, { off: false, debug: false }); assert.ok(!(FLAGS_KEY in w3.localStorage._m));
  _resetFlagsMemo();
  assert.equal(readEffectiveFlags(fakeWin({ search: '?variant=off', throwing: true })).flags.off, true);   // blocked storage: the URL still works for this load
  _resetFlagsMemo();
  assert.equal(readEffectiveFlags(fakeWin({ search: '', throwing: true })).flags.off, false);
  _resetFlagsMemo();
  assert.deepEqual(readEffectiveFlags(null).flags, { off: false, debug: false });
  _resetFlagsMemo();
});

test('the inline _document script decides the scroll model exactly like resolveFlags().flags.off (URL, stored, ?variant=on)', () => {
  const doc = read('pages/_document.js');
  const snippet = doc.slice(doc.indexOf('var legacy = false;'), doc.indexOf('if (!legacy) {'));
  assert.ok(snippet.includes('ls_variant_flags'));
  const decide = (search, stored) => new Function('location', 'localStorage', `${snippet}; return legacy;`)({ search }, { getItem: () => stored });
  const table = [
    ['', null], ['?variant=off', null], ['?variant=on', null], ['?debug=1', null], ['?scriptbox=1&rootscroll=1', null],
    ['', JSON.stringify({ off: 1, debug: 0 })], ['', JSON.stringify({ off: 0, debug: 1 })], ['?variant=on', JSON.stringify({ off: 1, debug: 0 })],
    ['?variant=off', JSON.stringify({ off: 0, debug: 1 })], ['?debug=1', JSON.stringify({ off: 1, debug: 0 })], ['', 'garbage'], ['', JSON.stringify({ scriptbox: 1, rootscroll: 1, contain: 1 })],
  ];
  for (const [search, stored] of table) assert.equal(decide(search, stored), resolveFlags({ search, stored }).flags.off, `${search || '(none)'} / ${stored}`);
});

test('_document: the document is the DEFAULT page scroller; the legacy model only behind the flag; the splash CSS is still there for the first paint', () => {
  const doc = read('pages/_document.js');
  const a = doc.indexOf('if (!legacy) {');
  const def = doc.slice(a, doc.indexOf('} else {', a));
  assert.match(def, /document\.documentElement\.style\.overflow = 'visible'/);
  assert.match(def, /document\.documentElement\.style\.height = 'auto'/);
  assert.match(def, /document\.body\.style\.height = 'auto'/);
  assert.match(def, /document\.body\.style\.overflow = 'hidden auto'/);                  // the body's overflow propagates to the viewport: body.style.overflow='hidden' locks keep working
  const legacyBranch = doc.slice(doc.indexOf('} else {', a), doc.indexOf('}\n              }\n              if (document.readyState'));
  assert.match(legacyBranch, /document\.body\.style\.overflow = 'auto'/);
  assert.match(legacyBranch, /document\.documentElement\.style\.overflow = 'auto'/);
  assert.match(doc, /html, body \{[^}]*height: 100%;[^}]*overflow: hidden;/);            // splash first paint unchanged
  // every scroll lock restores what it found (it finds 'hidden auto' now), none of them depends on which element scrolls
  for (const f of ['pages/index.js', 'components/HistoryPanel.jsx', 'components/MovieReelModal.jsx', 'components/CharacterModal.jsx', 'components/ScriptOutput.jsx']) {
    const src = read(f);
    assert.match(src, /const prev = document\.body\.style\.overflow;\s*document\.body\.style\.overflow = 'hidden';\s*return \(\) => \{ document\.body\.style\.overflow = prev; \};/, f);
  }
});

test('consumers read the EFFECTIVE flags, never raw location.search', () => {
  assert.match(read('components/ScriptOutput.jsx'), /useState\(\(\) => readEffectiveFlags\(\)\.flags\.off\)/);
  const idx = read('pages/index.js');
  assert.match(idx, /readEffectiveFlags\(\)\.flags\.debug/);
  assert.ok(!/window\.location\.search/.test(idx.slice(idx.indexOf('const [debugScroll'), idx.indexOf('const [debugScroll') + 400)));
});

// ── the debug overlay is NOT switchable by a visitor (production) ──────────────────────────────────────────────────────────────────────────

test('production: DEBUG_ALLOWED is false unless the OWNER builds with NEXT_PUBLIC_SCROLL_DEBUG=true', () => {
  assert.equal(process.env.NEXT_PUBLIC_SCROLL_DEBUG, undefined);
  assert.equal(DEBUG_ALLOWED, false);
});

test('resolveFlags(allowDebug:false): ?debug=1 and a stored {debug:1} never turn the overlay on; the stale bit is cleaned; ?variant=off still works', () => {
  assert.deepEqual(resolveFlags({ search: '?debug=1', allowDebug: false }).flags, { off: false, debug: false });
  assert.equal(resolveFlags({ search: '?debug=1', allowDebug: false }).store, null);
  const stale = resolveFlags({ search: '', stored: JSON.stringify({ off: 0, debug: 1 }), allowDebug: false });
  assert.deepEqual(stale.flags, { off: false, debug: false }); assert.equal(stale.clear, true, 'a leftover {"off":0,"debug":1} is removed from localStorage');
  const keepOff = resolveFlags({ search: '', stored: JSON.stringify({ off: 1, debug: 1 }), allowDebug: false });
  assert.deepEqual(keepOff.flags, { off: true, debug: false }); assert.deepEqual(keepOff.store, { off: 1, debug: 0 });
  assert.deepEqual(resolveFlags({ search: '?variant=off&debug=1', allowDebug: false }).store, { off: 1, debug: 0 });
  // the owner's build keeps the old behaviour
  assert.deepEqual(resolveFlags({ search: '?debug=1', allowDebug: true }).flags, { off: false, debug: true });
});

test('browser layer: a visitor who sets localStorage {debug:1} (or ?debug=1) gets no overlay and the key is cleaned on load', () => {
  _resetFlagsMemo();
  const w = fakeWin({ search: '?debug=1', stored: JSON.stringify({ off: 0, debug: 1 }) });
  assert.equal(readEffectiveFlags(w).flags.debug, false);
  assert.ok(!(FLAGS_KEY in w.localStorage._m), 'the stored debug flag is removed');
  _resetFlagsMemo();
});

test('source: the overlay is not even bundled without the owner env var; documented in .env.example', () => {
  const idx = read('pages/index.js');
  assert.match(idx, /process\.env\.NEXT_PUBLIC_SCROLL_DEBUG === 'true' \? dynamic/);
  assert.match(idx, /\{ScrollDebug && debugScroll && <ScrollDebug \/>\}/);
  assert.match(read('.env.example'), /NEXT_PUBLIC_SCROLL_DEBUG/);
  assert.match(read('next.config.js'), /NEXT_PUBLIC_SCROLL_DEBUG: process\.env\.NEXT_PUBLIC_SCROLL_DEBUG === 'true' \? 'true' : 'false'/);   // inlined, so the build can drop the chunk
});
