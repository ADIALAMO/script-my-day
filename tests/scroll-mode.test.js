import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const { COARSE_QUERY, TOUCH_BOX_HEIGHT, scriptWindowMode, isTouchBox, skipPageAutoScroll, scriptWindowClasses, scriptFrameRadius } = await import('../utils/scroll-mode.js');
const { createRateCounter, pageScroller, verdict, explainScriptBox } = await import('../utils/scroll-debug.js');

test('DEFAULT: the script window with its own inner scroll on touch AND desktop; only ?variant=off (touch) restores the legacy page flow', () => {
  assert.equal(COARSE_QUERY, '(pointer: coarse)');
  assert.equal(scriptWindowMode({ coarsePointer: false }), 'inner');
  assert.equal(scriptWindowMode({ coarsePointer: true }), 'inner');
  assert.equal(scriptWindowMode({ coarsePointer: true, off: false }), 'inner');
  assert.equal(scriptWindowMode({ coarsePointer: true, off: true }), 'page');
  assert.equal(scriptWindowMode({ coarsePointer: false, off: true }), 'inner');          // desktop always keeps its window
  assert.equal(isTouchBox({ coarsePointer: true }), true);
  assert.equal(isTouchBox({ coarsePointer: true, off: true }), false);
  assert.equal(isTouchBox({ coarsePointer: false }), false);
});

test('touch box: height min(60svh, 520px) — svh (stable while the Safari toolbar collapses), never vh/dvh; one height, one inner scroller, auto overscroll', () => {
  assert.equal(TOUCH_BOX_HEIGHT, 'min(60svh, 520px)');
  assert.ok(!/dvh|\bvh\b/.test(TOUCH_BOX_HEIGHT));
  const t = scriptWindowClasses('inner', { touch: true });
  assert.match(t, /overflow-y-auto/); assert.match(t, /overscroll-y-auto/); assert.match(t, /\[scrollbar-gutter:stable\]/);
  assert.ok(!/overscroll-y-contain/.test(t), 'no contain: a swipe starting in the box must be able to scroll the page');
  assert.ok(!/md:h-\[650px\]/.test(t), 'the touch box has one height, not the desktop md height');
  const d = scriptWindowClasses('inner');
  assert.match(d, /h-\[500px\] md:h-\[650px\]/);                                            // desktop window unchanged
  const legacy = scriptWindowClasses('page');
  assert.ok(!/(^|\s)h-\[|overflow|custom-scrollbar|overscroll|max-h/.test(legacy), legacy);  // legacy page flow: no height, overflow or scrollbar styling
  assert.equal(scriptFrameRadius('inner'), 'rounded-[2rem] md:rounded-[3.5rem]');
});

test('the page never scrolls itself with the touch window: the index auto-scroll to the script is skipped there only', () => {
  assert.equal(skipPageAutoScroll({ coarsePointer: true }), true);
  assert.equal(skipPageAutoScroll({ coarsePointer: true, off: true }), false);
  assert.equal(skipPageAutoScroll({ coarsePointer: false }), false);
  assert.match(read('pages/index.js'), /if \(skipPageAutoScroll\(\{ coarsePointer: coarse, off: readEffectiveFlags\(\)\.flags\.off \}\)\) return;/);
  const out = read('components/ScriptOutput.jsx');
  const box = out.slice(out.indexOf('data-script-scroller'), out.indexOf('data-script-scroller') + 900);
  assert.ok(!/window\.scrollTo|scrollIntoView/.test(box));
  const tw = read('hooks/useTypewriter.js');
  assert.ok(!/window\.scroll|scrollIntoView/.test(tw), 'the typewriter only ever scrolls the box itself');
});

test('the script window obeys the rule: handlers write refs only, follow only while not touching, one inner scroller', () => {
  const out = read('components/ScriptOutput.jsx');
  assert.match(out, /const windowMode = scriptWindowMode\(\{ coarsePointer, off: legacyOff \}\)/);
  assert.match(out, /followTyping: innerScroll/);
  assert.match(out, /className=\{scriptWindowClasses\(windowMode, \{ touch: touchBox \}\)\}/);
  assert.match(out, /style=\{touchBox \? \{ height: TOUCH_BOX_HEIGHT \} : undefined\}/);
  assert.match(out, /\.\.\.\(innerScroll \? \{ onWheel: pauseAutoScroll, onTouchStart: pauseAutoScroll, onPointerDown: pauseAutoScroll, onTouchEnd: handleScrollPosition, onPointerUp: handleScrollPosition, onScroll: handleScrollPosition \} : \{\}\)/);
  const tw = read('hooks/useTypewriter.js');
  assert.match(tw, /followTyping && i > 15 && scrollRef\.current && !isAutoScrollPaused\.current/);
  const h = tw.slice(tw.indexOf('const handleScrollPosition'), tw.indexOf('return { displayText'));
  assert.ok(!/set[A-Z]\w*\(|requestAnimationFrame/.test(h), h);
  const pause = tw.slice(tw.indexOf('const pauseAutoScroll'), tw.indexOf('const pauseAutoScroll') + 200);
  assert.ok(!/set[A-Z]\w*\(|requestAnimationFrame/.test(pause));
});

test('dead variant code is gone: no A / C variants, no ?scriptbox / ?rootscroll / ?contain anywhere', () => {
  for (const f of ['utils/scroll-mode.js', 'utils/variant-flags.js', 'utils/scroll-debug.js', 'components/ScriptOutput.jsx', 'components/ScrollDebug.jsx', 'pages/index.js', 'pages/_document.js']) {
    const src = read(f);
    assert.ok(!/scriptbox|rootscroll|parseScriptVariant|variantId|variantLabel|scriptFrameGutter|overscroll-y-contain|contain=1/.test(src.replace(/rootscroll\/scriptbox/g, '')), f);
  }
});

test('the next-step pill keeps its box (no layout shift while the user scrolls) — it only toggles what is inside', () => {
  const src = read('components/NextStepButton.jsx');
  assert.match(src, /PILL_BOX_PX = 44/);
  assert.match(src, /style=\{\{ height: PILL_BOX_PX \}\}/);
  assert.match(src, /\{!targetSeen && <button/);
  assert.ok(!/if \(!show \|\| targetSeen\) return null/.test(src));
});

test('rate counter: events per second over a sliding window', () => {
  let t = 1_000_000;
  const c = createRateCounter({ windowMs: 1000, now: () => t });
  assert.equal(c.rate(), 0);
  for (let i = 0; i < 30; i++) { c.hit(); t += 16; }
  assert.equal(c.rate(), 30);
  t += 600; assert.ok(c.rate() < 30);
  t += 2000; assert.equal(c.rate(), 0);
  c.hit(); assert.equal(c.rate(), 1);
  c.reset(); assert.equal(c.rate(), 0);
  const half = createRateCounter({ windowMs: 500, now: () => t });
  half.hit(); half.hit(); assert.equal(half.rate(), 4);
});

test('page scroller detection: the BODY scrolling inside the viewport (window.scrollY stays 0) is told apart from normal document scrolling', () => {
  assert.equal(pageScroller({ docScrollHeight: 664, docClientHeight: 664, bodyScrollHeight: 3632, bodyClientHeight: 664 }), 'body');
  assert.equal(pageScroller({ docScrollHeight: 3632, docClientHeight: 664, bodyScrollHeight: 3632, bodyClientHeight: 3632 }), 'document');
  assert.equal(pageScroller({ docScrollHeight: 664, docClientHeight: 664, bodyScrollHeight: 664, bodyClientHeight: 664 }), 'none');
  assert.equal(pageScroller({ docScrollHeight: 665, docClientHeight: 664, bodyScrollHeight: 664, bodyClientHeight: 664 }), 'none');
  assert.match(verdict({ scroller: 'document', innerMode: 'inner', variant: 'default' }), /^default \| page scroller: document \| script box: INNER scroll$/);
  assert.match(verdict({ scroller: 'body', innerMode: 'page', variant: 'off' }), /LEGACY.*BODY.*page flow/);
});

test('overlay explains the script box: mounted or not, and why it is the legacy page flow', () => {
  assert.match(explainScriptBox({ mounted: false }), /not mounted: no script on screen yet/);
  assert.match(explainScriptBox({ mounted: true, mode: 'inner', coarse: true }), /INNER window \(touch default\)/);
  assert.match(explainScriptBox({ mounted: true, mode: 'inner', coarse: false }), /desktop default/);
  const off = explainScriptBox({ mounted: true, mode: 'page', coarse: true, off: true, source: 'stored' });
  assert.match(off, /legacy PAGE FLOW: \?variant=off is set \(flags source: stored\)/); assert.match(off, /\?variant=on/);
  assert.match(explainScriptBox({ mounted: true, mode: 'page', coarse: true, off: false }), /unexpected/);
  const dbg = read('components/ScrollDebug.jsx');
  for (const k of ['location.search', 'stored flags (ls_variant_flags)', 'resolved flags | source', 'hover:none=', 'pointer:coarse=', 'passive: true']) assert.ok(dbg.includes(k), k);
  assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|gtag|scrollTo\(|scrollBy\(|scrollTop\s*=|\.style\.\w+\s*=/.test(dbg), 'the overlay never writes to the page or the network');
  assert.match(read('pages/index.js'), /const ScrollDebug = dynamic\(\(\) => import\('\.\.\/components\/ScrollDebug'\), \{ ssr: false \}\)/);
  assert.match(read('pages/index.js'), /setDebugScroll\(readEffectiveFlags\(\)\.flags\.debug\)/);
});

test('Tailwind scans utils/: class lists built in pure helpers (scriptWindowClasses) must exist in the CSS', () => {
  assert.match(read('tailwind.config.js'), /"\.\/utils\/\*\*\/\*\.\{js,ts,jsx,tsx\}"/);
  const src = read('utils/scroll-mode.js');
  for (const cls of ['md:h-[650px]', 'overscroll-y-auto', 'custom-scrollbar', '[scrollbar-gutter:stable]']) assert.ok(src.includes(cls), cls);
});
