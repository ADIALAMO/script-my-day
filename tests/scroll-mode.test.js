import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const { COARSE_QUERY, scriptWindowMode, scriptWindowClasses, scriptFrameGutter, parseScriptVariant, variantId, variantLabel, isTouchBoxVariant, skipPageAutoScroll, TOUCH_BOX_HEIGHT } = await import('../utils/scroll-mode.js');
const { isDebugRequested, isRootScrollRequested, createRateCounter, pageScroller, verdict } = await import('../utils/scroll-debug.js');

test('script window mode: touch (coarse pointer) = page flow, precise pointer = inner window', () => {
  assert.equal(COARSE_QUERY, '(pointer: coarse)');
  assert.equal(scriptWindowMode({ coarsePointer: true }), 'page');
  assert.equal(scriptWindowMode({ coarsePointer: false }), 'inner');
  assert.equal(scriptWindowMode({}), 'inner');
});

test('page-flow container has NO height, overflow or scrollbar styling (no nested scroller on iOS); the inner window keeps its look', () => {
  const page = scriptWindowClasses('page');
  assert.ok(!/(^|\s)h-\[|overflow|custom-scrollbar|overscroll|max-h/.test(page), page);
  assert.match(page, /p-10 md:p-20/);
  const inner = scriptWindowClasses('inner');
  assert.match(inner, /h-\[500px\] md:h-\[650px\]/);
  assert.match(inner, /overflow-y-auto/);
  assert.match(inner, /custom-scrollbar/);
});

test('debug flags: ?debug=1 and ?rootscroll=1 are exact, position-independent, and never match look-alikes', () => {
  assert.equal(isDebugRequested('?debug=1'), true);
  assert.equal(isDebugRequested('?a=b&debug=1'), true);
  assert.equal(isDebugRequested('?debug=1&rootscroll=1'), true);
  assert.equal(isDebugRequested('?debug=10'), false);
  assert.equal(isDebugRequested('?nodebug=1'), false);
  assert.equal(isDebugRequested('?debug=0'), false);
  assert.equal(isDebugRequested(''), false);
  assert.equal(isDebugRequested(undefined), false);
  assert.equal(isRootScrollRequested('?rootscroll=1'), true);
  assert.equal(isRootScrollRequested('?debug=1&rootscroll=1'), true);
  assert.equal(isRootScrollRequested('?rootscroll=2'), false);
  assert.equal(isRootScrollRequested('?debug=1'), false);
});

test('rate counter: events per second over a sliding window', () => {
  let t = 1_000_000;
  const c = createRateCounter({ windowMs: 1000, now: () => t });
  assert.equal(c.rate(), 0);
  for (let i = 0; i < 30; i++) { c.hit(); t += 16; }       // ~60 Hz for half a second
  assert.equal(c.rate(), 30);
  t += 600; assert.ok(c.rate() < 30);                        // the oldest ones age out
  t += 2000; assert.equal(c.rate(), 0);
  c.hit(); assert.equal(c.rate(), 1);
  c.reset(); assert.equal(c.rate(), 0);
  const half = createRateCounter({ windowMs: 500, now: () => t });
  half.hit(); half.hit(); assert.equal(half.rate(), 4);      // 2 events in 0.5 s = 4/s
});

test('page scroller detection: the BODY scrolling inside the viewport (window.scrollY stays 0) is told apart from normal document scrolling', () => {
  // what the site measured on iPhone-sized WebKit and Chromium today: html 664/664, body 3632/664
  assert.equal(pageScroller({ docScrollHeight: 664, docClientHeight: 664, bodyScrollHeight: 3632, bodyClientHeight: 664 }), 'body');
  // the normal model: the document is taller than the viewport, the body grows with it
  assert.equal(pageScroller({ docScrollHeight: 3632, docClientHeight: 664, bodyScrollHeight: 3632, bodyClientHeight: 3632 }), 'document');
  assert.equal(pageScroller({ docScrollHeight: 664, docClientHeight: 664, bodyScrollHeight: 664, bodyClientHeight: 664 }), 'none');
  assert.equal(pageScroller({ docScrollHeight: 665, docClientHeight: 664, bodyScrollHeight: 664, bodyClientHeight: 664 }), 'none');   // 1 px rounding noise is not scrolling
  assert.match(verdict({ scroller: 'body', innerMode: 'inner' }), /BODY.*INNER/);
  assert.match(verdict({ scroller: 'document', innerMode: 'page' }), /document.*page flow/);
});

test('the script window obeys the iOS rule: touch default = page flow, no scroll handlers, no programmatic follow; the preview variants are opt-in', () => {
  const out = read('components/ScriptOutput.jsx');
  assert.match(out, /const windowMode = scriptWindowMode\(\{ coarsePointer, search: urlSearch \}\)/);
  assert.match(out, /followTyping: innerScroll/);
  assert.match(out, /className=\{scriptWindowClasses\(windowMode, \{ touch: touchBox, contain: touchBox && variant\.contain \}\)\}/);
  assert.match(out, /\.\.\.\(innerScroll \? \{ onWheel: pauseAutoScroll, onTouchStart: pauseAutoScroll, onPointerDown: pauseAutoScroll, onTouchEnd: handleScrollPosition, onPointerUp: handleScrollPosition, onScroll: handleScrollPosition \} : \{\}\)/);
  assert.match(out, /style=\{touchBox \? \{ height: TOUCH_BOX_HEIGHT \} : undefined\}/);
  assert.ok(!/className="h-\[500px\] md:h-\[650px\]/.test(out), 'the fixed-height window class is only reachable through scriptWindowClasses("inner")');
  const tw = read('hooks/useTypewriter.js');
  assert.match(tw, /followTyping && i > 15 && scrollRef\.current && !isAutoScrollPaused\.current/);
});

test('variants: ?scriptbox=1 = A, +rootscroll=1 = B, +contain=1 = C; exact flags only; default is untouched', () => {
  assert.deepEqual(parseScriptVariant('?scriptbox=1'), { scriptbox: true, rootscroll: false, contain: false });
  assert.deepEqual(parseScriptVariant('?scriptbox=1&rootscroll=1&contain=1'), { scriptbox: true, rootscroll: true, contain: true });
  assert.deepEqual(parseScriptVariant('?debug=1&contain=1&scriptbox=1'), { scriptbox: true, rootscroll: false, contain: true });
  assert.deepEqual(parseScriptVariant('?scriptbox=10&xrootscroll=1&contain=0'), { scriptbox: false, rootscroll: false, contain: false });
  assert.deepEqual(parseScriptVariant(''), { scriptbox: false, rootscroll: false, contain: false });
  assert.deepEqual(parseScriptVariant(undefined), { scriptbox: false, rootscroll: false, contain: false });
  assert.equal(variantId(parseScriptVariant('?scriptbox=1')), 'A');
  assert.equal(variantId(parseScriptVariant('?scriptbox=1&rootscroll=1')), 'B');
  assert.equal(variantId(parseScriptVariant('?scriptbox=1&rootscroll=1&contain=1')), 'C');
  assert.equal(variantId(parseScriptVariant('?scriptbox=1&contain=1')), 'custom');
  assert.equal(variantId(parseScriptVariant('?rootscroll=1&contain=1')), 'default');   // without scriptbox nothing changes the script window
  assert.match(variantLabel(parseScriptVariant('?scriptbox=1&rootscroll=1&contain=1')), /^C: box on \| scroller document \| overscroll contain$/);
  assert.match(variantLabel(parseScriptVariant('?scriptbox=1')), /^A: box on \| scroller body \| overscroll auto$/);
});

test('mode selection: desktop is ALWAYS the window; touch is page flow unless ?scriptbox=1', () => {
  assert.equal(scriptWindowMode({ coarsePointer: false, search: '' }), 'inner');
  assert.equal(scriptWindowMode({ coarsePointer: false, search: '?scriptbox=1' }), 'inner');
  assert.equal(scriptWindowMode({ coarsePointer: true, search: '' }), 'page');
  assert.equal(scriptWindowMode({ coarsePointer: true, search: '?rootscroll=1&contain=1' }), 'page');   // rootscroll / contain alone never bring the box back
  for (const q of ['?scriptbox=1', '?scriptbox=1&rootscroll=1', '?scriptbox=1&rootscroll=1&contain=1']) assert.equal(scriptWindowMode({ coarsePointer: true, search: q }), 'inner', q);
  assert.equal(isTouchBoxVariant({ coarsePointer: true, search: '?scriptbox=1' }), true);
  assert.equal(isTouchBoxVariant({ coarsePointer: false, search: '?scriptbox=1' }), false);
  assert.equal(isTouchBoxVariant({ coarsePointer: true, search: '' }), false);
});

test('touch box: height min(60svh, 520px) — svh (stable while the Safari toolbar collapses), never vh/dvh; contain only on request; gutters with contain', () => {
  assert.equal(TOUCH_BOX_HEIGHT, 'min(60svh, 520px)');
  assert.ok(!/dvh|\bvh\b/.test(TOUCH_BOX_HEIGHT));
  const a = scriptWindowClasses('inner', { touch: true });
  assert.match(a, /overflow-y-auto/); assert.match(a, /overscroll-y-auto/); assert.ok(!/overscroll-y-contain/.test(a));
  assert.ok(!/md:h-\[650px\]/.test(a), 'the touch box has one height, not the desktop md height');
  const c = scriptWindowClasses('inner', { touch: true, contain: true });
  assert.match(c, /overscroll-y-contain/); assert.ok(!/overscroll-y-auto/.test(c));
  assert.match(scriptWindowClasses('inner'), /h-\[500px\] md:h-\[650px\]/);               // desktop window unchanged
  assert.ok(!/contain/.test(scriptWindowClasses('inner')));
  assert.equal(scriptFrameGutter({ touch: true, contain: true }), 'mx-5 my-6');            // visible page gutters beside / above / below the box
  assert.equal(scriptFrameGutter({ touch: true, contain: false }), 'mx-2 md:mx-4');
  assert.equal(scriptFrameGutter({}), 'mx-2 md:mx-4');
});

test('the page never scrolls itself in a touch variant: the index auto-scroll to the script is skipped there only', () => {
  assert.equal(skipPageAutoScroll({ coarsePointer: true, search: '?scriptbox=1&rootscroll=1' }), true);
  assert.equal(skipPageAutoScroll({ coarsePointer: true, search: '' }), false);
  assert.equal(skipPageAutoScroll({ coarsePointer: false, search: '?scriptbox=1' }), false);
  assert.match(read('pages/index.js'), /if \(skipPageAutoScroll\(\{ coarsePointer: coarse, search: readEffectiveFlags\(\)\.effectiveSearch \}\)\) return;/);
  const out = read('components/ScriptOutput.jsx');
  const box = out.slice(out.indexOf('data-script-scroller'), out.indexOf('data-script-scroller') + 900);
  assert.ok(!/window\.scrollTo|scrollIntoView/.test(box));
  const tw = read('hooks/useTypewriter.js');
  assert.ok(!/window\.scroll|scrollIntoView/.test(tw), 'the typewriter only ever scrolls the box itself');
});

test('no state update or rAF on scroll in the box handlers: they only write refs', () => {
  const tw = read('hooks/useTypewriter.js');
  const h = tw.slice(tw.indexOf('const handleScrollPosition'), tw.indexOf('return { displayText'));
  assert.ok(!/setState|set[A-Z]\w*\(|requestAnimationFrame/.test(h), h);
  const pause = tw.slice(tw.indexOf('const pauseAutoScroll'), tw.indexOf('const pauseAutoScroll') + 200);
  assert.ok(!/set[A-Z]\w*\(|requestAnimationFrame/.test(pause));
});

test('the debug overlay shows the active variant and the box css', () => {
  const src = read('components/ScrollDebug.jsx');
  assert.match(src, /data-script-variant/);
  assert.match(src, /overscrollBehaviorY/);
  assert.match(src, /location\.search/);
  assert.match(verdict({ scroller: 'document', innerMode: 'inner', variant: 'B' }), /^variant B \|/);
});

test('the next-step pill keeps its box (no layout shift while the user scrolls) — it only toggles what is inside', () => {
  const src = read('components/NextStepButton.jsx');
  assert.match(src, /PILL_BOX_PX = 44/);
  assert.match(src, /style=\{\{ height: PILL_BOX_PX \}\}/);
  assert.match(src, /\{!targetSeen && <button/);
  assert.ok(!/if \(!show \|\| targetSeen\) return null/.test(src), 'hiding by returning null changed the page height under the finger');
});

test('root-scroll is an EXPERIMENT behind ?rootscroll=1: the default scroll model (and the modal scroll locks) are unchanged', () => {
  const doc = read('pages/_document.js');
  assert.match(doc, /rootscroll=1/);
  assert.match(doc, /else \{\s*document\.body\.style\.overflow = 'auto';\s*document\.documentElement\.style\.overflow = 'auto';/);   // default branch = the old behaviour
  assert.match(doc, /document\.body\.style\.overflow = 'hidden auto'/);                      // the flag branch keeps body overflow-based locks working
  assert.match(read('styles/globals.css'), /body \{[^}]*overflow-x: hidden/);                // globals untouched
});

test('debug overlay: passive listeners only, no network, no page writes', () => {
  const src = read('components/ScrollDebug.jsx');
  assert.match(src, /passive: true/);
  assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|gtag|scrollTo\(|scrollBy\(|scrollTop\s*=|\.style\.\w+\s*=/.test(src));
  const idx = read('pages/index.js');
  assert.match(idx, /const ScrollDebug = dynamic\(\(\) => import\('\.\.\/components\/ScrollDebug'\), \{ ssr: false \}\)/);
  assert.match(idx, /setDebugScroll\(isDebugRequested\(readEffectiveFlags\(\)\.effectiveSearch\)\)/);
});

test('Tailwind scans utils/: class lists built in pure helpers (scriptWindowClasses) must exist in the CSS (the md:h-[650px] desktop window and overscroll-y-contain were silently missing without it)', () => {
  const cfg = read('tailwind.config.js');
  assert.match(cfg, /"\.\/utils\/\*\*\/\*\.\{js,ts,jsx,tsx\}"/);
  const src = read('utils/scroll-mode.js');
  for (const cls of ['md:h-[650px]', 'overscroll-y-contain', 'overscroll-y-auto', 'custom-scrollbar']) assert.ok(src.includes(cls), cls);
});
