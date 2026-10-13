import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scriptWindowMostlyVisible, scriptWindowDirection, shouldShowGoToScript, GO_TO_SCRIPT_LABEL, GO_TO_SCRIPT_ARIA, GO_TO_SCRIPT_MIN_PX } from '../utils/go-to-script.js';

const R = (top, height) => ({ top, bottom: top + height, height });
const VH = 800; const NAV = 80;

test('mostly visible: 60% of the window inside the area below the navbar, or the visible part fills half of that area', () => {
  assert.equal(scriptWindowMostlyVisible({ rect: R(100, 500), navH: NAV, vh: VH }), true);
  assert.equal(scriptWindowMostlyVisible({ rect: R(700, 500), navH: NAV, vh: VH }), false, 'only 100 px of 500 shown');
  assert.equal(scriptWindowMostlyVisible({ rect: R(400, 500), navH: NAV, vh: VH }), true, '400 of 500 shown');
  assert.equal(scriptWindowMostlyVisible({ rect: R(530, 500), navH: NAV, vh: VH }), false, '270 of 500 (54%) is not enough');
  assert.equal(scriptWindowMostlyVisible({ rect: R(-230, 650), navH: NAV, vh: VH }), false, 'the mis-landing measured before the fix: top 230 px above the page, 150 px under the navbar');
  assert.equal(scriptWindowMostlyVisible({ rect: R(-100, 650), navH: NAV, vh: VH }), true, '470 of 650 shown below the navbar');
  assert.equal(scriptWindowMostlyVisible({ rect: R(NAV, 2000), navH: NAV, vh: VH }), true, 'a window taller than the screen: filling the area counts');
  assert.equal(scriptWindowMostlyVisible({ rect: R(1000, 500), navH: NAV, vh: VH }), false);
});

test('a hidden / zero-size / unknown window is never "visible"', () => {
  assert.equal(scriptWindowMostlyVisible({ rect: R(100, 0), navH: NAV, vh: VH }), false);
  assert.equal(scriptWindowMostlyVisible({ rect: null, navH: NAV, vh: VH }), false);
  assert.equal(scriptWindowMostlyVisible({ rect: R(100, 500), navH: NAV, vh: 0 }), false);
});

test('direction: above the visible area → up, otherwise down', () => {
  assert.equal(scriptWindowDirection({ rect: R(-700, 500), navH: NAV }), 'up');
  assert.equal(scriptWindowDirection({ rect: R(900, 500), navH: NAV }), 'down');
});

test('shown only after typing started, until the window was seen; never while visible, busy or under an overlay', () => {
  const base = { typingStarted: true, seen: false, visible: false, busy: false, overlay: false };
  assert.equal(shouldShowGoToScript(base), true);
  assert.equal(shouldShowGoToScript({ ...base, typingStarted: false }), false, 'before the typewriter starts');
  assert.equal(shouldShowGoToScript({ ...base, visible: true }), false);
  assert.equal(shouldShowGoToScript({ ...base, seen: true }), false, 'once seen it does not come back for this script');
  assert.equal(shouldShowGoToScript({ ...base, busy: true }), false, 'poster / comic generation');
  assert.equal(shouldShowGoToScript({ ...base, overlay: true }), false, 'modal / lightbox / history / tour');
});

test('copy exists in he and en, has no price / plan words, and the touch target is at least 44 px', () => {
  for (const o of [GO_TO_SCRIPT_LABEL, GO_TO_SCRIPT_ARIA]) { assert.ok(o.he && /[֐-׿]/.test(o.he)); assert.ok(o.en && /^[\x20-\x7E]+$/.test(o.en)); }
  assert.doesNotMatch(JSON.stringify([GO_TO_SCRIPT_LABEL, GO_TO_SCRIPT_ARIA]), /\$|pro\b|price|plan|upgrade|subscri|premium|פרו|מחיר|שדרג|מנוי/i);
  assert.ok(GO_TO_SCRIPT_MIN_PX >= 44);
});

test('wiring: the button is fixed (no layout), uses the shared scroll helper, reads both languages, and the old stale scrollIntoView on the output wrapper is gone', () => {
  const comp = readFileSync(new URL('../components/GoToScriptButton.jsx', import.meta.url), 'utf8');
  assert.match(comp, /fixed end-4/); assert.match(comp, /scrollToScriptWindow\(\)/); assert.match(comp, /minHeight: GO_TO_SCRIPT_MIN_PX/);
  assert.doesNotMatch(comp, /overflow-y-auto|overflow-auto|overscroll-behavior/, 'no scroller of its own');
  const idx = readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(idx, /scriptOutputRef/); assert.match(idx, /scrollToScriptWindow\(\{ settle: true \}\)/);
  const anchor = readFileSync(new URL('../utils/scroll-to-anchor.js', import.meta.url), 'utf8');
  assert.match(anchor, /prefers-reduced-motion/); assert.match(anchor, /safe-area-inset-top/);
});
