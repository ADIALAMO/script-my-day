import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const { FLAGS_KEY, parseStored, resolveFlags, flagsToSearch, readEffectiveFlags, _resetFlagsMemo } = await import('../utils/variant-flags.js');
const { parseScriptVariant, variantId, scriptWindowMode } = await import('../utils/scroll-mode.js');
const { explainScriptBox } = await import('../utils/scroll-debug.js');

const fakeWin = ({ search = '', stored = null, throwing = false } = {}) => {
  const m = stored === null ? {} : { [FLAGS_KEY]: stored };
  return {
    location: { search },
    localStorage: throwing
      ? { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } }
      : { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: (k) => { delete m[k]; }, _m: m },
  };
};

test('resolve: URL flags win, are stored whole (absent = 0), and replace an older stored set', () => {
  const a = resolveFlags({ search: '?scriptbox=1' });
  assert.deepEqual(a.flags, { scriptbox: true, rootscroll: false, contain: false, debug: false });
  assert.equal(a.source, 'url');
  assert.deepEqual(a.store, { scriptbox: 1, rootscroll: 0, contain: 0, debug: 0 });
  // B after a stored C: contain must not survive
  const b = resolveFlags({ search: '?scriptbox=1&rootscroll=1', stored: JSON.stringify({ scriptbox: 1, rootscroll: 1, contain: 1, debug: 0 }) });
  assert.equal(variantId(parseScriptVariant(flagsToSearch(b.flags))), 'B');
  assert.deepEqual(b.store, { scriptbox: 1, rootscroll: 1, contain: 0, debug: 0 });
  // an explicit =0 turns a flag off
  const c = resolveFlags({ search: '?scriptbox=0&debug=1' });
  assert.deepEqual(c.flags, { scriptbox: false, rootscroll: false, contain: false, debug: true });
  assert.equal(resolveFlags({ search: '?foo=1&debug=1' }).source, 'url');
});

test('resolve: no flag in the URL = the STORED set (a redirect / bookmark that drops the query keeps the variant)', () => {
  const stored = JSON.stringify({ scriptbox: 1, rootscroll: 1, contain: 1, debug: 1 });
  const r = resolveFlags({ search: '', stored });
  assert.equal(r.source, 'stored'); assert.equal(r.store, null); assert.equal(r.clear, false);
  assert.equal(flagsToSearch(r.flags), '?scriptbox=1&rootscroll=1&contain=1&debug=1');
  assert.equal(variantId(parseScriptVariant(flagsToSearch(r.flags))), 'C');
  assert.equal(scriptWindowMode({ coarsePointer: true, search: flagsToSearch(r.flags) }), 'inner');
  assert.equal(resolveFlags({ search: '?checkout=success', stored }).source, 'stored');   // unrelated params do not hide the stored variant
});

test('resolve: ?variant=off clears everything (even with other flags in the same URL); unreadable / empty storage = default', () => {
  const stored = JSON.stringify({ scriptbox: 1, rootscroll: 1, contain: 0, debug: 0 });
  const off = resolveFlags({ search: '?variant=off', stored });
  assert.equal(off.clear, true); assert.equal(off.source, 'cleared'); assert.equal(flagsToSearch(off.flags), '');
  assert.equal(resolveFlags({ search: '?scriptbox=1&variant=off', stored }).clear, true);
  for (const bad of [null, '', 'garbage', '{', '[]', '{"scriptbox":0}', '{"scriptbox":"yes"}', 'null']) {
    const r = resolveFlags({ search: '', stored: bad });
    assert.equal(r.source, 'none', String(bad)); assert.equal(flagsToSearch(r.flags), '');
  }
  assert.equal(parseStored('{"scriptbox":true,"debug":1}').debug, true);
});

test('browser layer: stores on first sight, survives a reload without the query, is cleared by ?variant=off, tolerates blocked storage', () => {
  _resetFlagsMemo();
  const w1 = fakeWin({ search: '?scriptbox=1&rootscroll=1' });
  const r1 = readEffectiveFlags(w1);
  assert.equal(r1.effectiveSearch, '?scriptbox=1&rootscroll=1'); assert.equal(r1.source, 'url');
  assert.equal(w1.localStorage._m[FLAGS_KEY], JSON.stringify({ scriptbox: 1, rootscroll: 1, contain: 0, debug: 0 }));
  _resetFlagsMemo();                                                    // a reload / redirect that lost the query
  const w2 = fakeWin({ search: '', stored: w1.localStorage._m[FLAGS_KEY] });
  const r2 = readEffectiveFlags(w2);
  assert.equal(r2.effectiveSearch, '?scriptbox=1&rootscroll=1'); assert.equal(r2.source, 'stored');
  assert.equal(readEffectiveFlags(w2), r2, 'resolved once per page load');
  _resetFlagsMemo();
  const w3 = fakeWin({ search: '?variant=off', stored: w1.localStorage._m[FLAGS_KEY] });
  assert.equal(readEffectiveFlags(w3).effectiveSearch, ''); assert.ok(!(FLAGS_KEY in w3.localStorage._m));
  _resetFlagsMemo();
  const w4 = fakeWin({ search: '?scriptbox=1', throwing: true });
  assert.equal(readEffectiveFlags(w4).effectiveSearch, '?scriptbox=1');   // storage blocked: the URL still works for this page load
  _resetFlagsMemo();
  assert.equal(readEffectiveFlags(fakeWin({ search: '', throwing: true })).effectiveSearch, '');
  _resetFlagsMemo();
  assert.equal(readEffectiveFlags(null).effectiveSearch, '');
  _resetFlagsMemo();
});

test('the inline _document script decides rootscroll exactly like resolveFlags (URL, stored, ?variant=off)', () => {
  const doc = read('pages/_document.js');
  const snippet = doc.slice(doc.indexOf('var rootScroll = false;'), doc.indexOf('if (rootScroll) {'));
  assert.ok(snippet.includes('ls_variant_flags'));
  const decide = (search, stored) => {
    const m = stored === null ? {} : { ls_variant_flags: stored };
    const ls = { getItem: (k) => (k in m ? m[k] : null), removeItem: (k) => { delete m[k]; } };
    const rootScroll = new Function('location', 'localStorage', `${snippet}; return { rootScroll, m: arguments[2] };`)({ search }, ls, m);
    return { root: rootScroll.rootScroll, cleared: stored !== null && !('ls_variant_flags' in m) };
  };
  const stC = JSON.stringify({ scriptbox: 1, rootscroll: 1, contain: 1, debug: 0 });
  const stA = JSON.stringify({ scriptbox: 1, rootscroll: 0, contain: 0, debug: 0 });
  const table = [
    ['', null], ['?rootscroll=1', null], ['?scriptbox=1', null], ['?scriptbox=1&rootscroll=1&contain=1', null],
    ['', stC], ['', stA], ['?scriptbox=1', stC], ['?scriptbox=1&rootscroll=1', stA], ['?variant=off', stC], ['?checkout=success', stC], ['', 'garbage'],
  ];
  for (const [search, stored] of table) {
    const expected = resolveFlags({ search, stored }).flags.rootscroll;
    const got = decide(search, stored);
    assert.equal(got.root, expected, `${search || '(none)'} / ${stored ? stored.slice(0, 30) : stored}`);
    if (search.includes('variant=off')) assert.equal(got.cleared, true);
  }
});

test('consumers read the EFFECTIVE flags (URL or stored), never raw location.search', () => {
  const out = read('components/ScriptOutput.jsx');
  assert.match(out, /useState\(\(\) => readEffectiveFlags\(\)\.effectiveSearch\)/);
  assert.ok(!/useState\(\(\) => \(typeof window !== 'undefined' \? window\.location\.search/.test(out));
  const idx = read('pages/index.js');
  assert.match(idx, /isDebugRequested\(readEffectiveFlags\(\)\.effectiveSearch\)/);
  assert.match(idx, /search: readEffectiveFlags\(\)\.effectiveSearch/);
  assert.ok(!/window\.location\.search \}\)\) return/.test(idx));
});

test('overlay explains the script box: mounted or not, and why it is page flow', () => {
  assert.match(explainScriptBox({ mounted: false }), /not mounted: no script on screen yet/);
  assert.match(explainScriptBox({ mounted: true, mode: 'inner', coarse: true }), /INNER window \(touch variant/);
  assert.match(explainScriptBox({ mounted: true, mode: 'inner', coarse: false }), /desktop default/);
  const flowOff = explainScriptBox({ mounted: true, mode: 'page', coarse: true, scriptbox: false, source: 'none' });
  assert.match(flowOff, /PAGE FLOW: touch device and scriptbox flag is OFF \(flags source: none\)/);
  assert.match(flowOff, /\?scriptbox=1/);
  assert.match(explainScriptBox({ mounted: true, mode: 'page', coarse: false }), /unexpected/);
  const dbg = read('components/ScrollDebug.jsx');
  for (const k of ['location.search', 'stored flags (ls_variant_flags)', 'resolved variant | source', "hover:none=", "pointer:coarse="]) assert.ok(dbg.includes(k), k);
});
