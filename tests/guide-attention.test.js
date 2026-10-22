import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GUIDE_SEEN_KEY, hasSeenGuide, markGuideSeen, shouldAttract } from '../utils/guide-attention.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the effect stops for good after one press (per-browser flag) and survives blocked storage', () => {
  const s = mem();
  assert.equal(hasSeenGuide(s), false); markGuideSeen(s); assert.equal(hasSeenGuide(s), true); assert.equal(s.getItem(GUIDE_SEEN_KEY), 'true');
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(hasSeenGuide(bad), false); assert.doesNotThrow(() => markGuideSeen(bad));
});

test('it runs only while it can help: not after the first press, not during a tour, not disabled, not with the menu open', () => {
  assert.equal(shouldAttract({ seen: false }), true);
  assert.equal(shouldAttract({ seen: true }), false);
  assert.equal(shouldAttract({ seen: false, tourRunning: true }), false);
  assert.equal(shouldAttract({ seen: false, disabled: true }), false);
  assert.equal(shouldAttract({ seen: false, menuOpen: true }), false);
});

test('Navbar: flag read after mount (default "seen" so SSR renders no animation), the press marks it, the tour state is passed from the page', () => {
  const nav = read('components/Navbar.jsx');
  assert.match(nav, /useState\(true\);\s*\/\/ true until the stored flag has been read/);
  assert.match(nav, /useEffect\(\(\) => \{ setGuideSeen\(hasSeenGuide\(\)\); \}, \[\]\)/);
  assert.match(nav, /markGuideSeen\(\); setGuideSeen\(true\);/);
  assert.match(nav, /tour-button--attention/);
  assert.match(read('pages/index.js'), /tourRunning=\{tour\.running\}/);
});

test('CSS: the requested keyframes, a stop on :focus-visible and :disabled, and reduced motion = no animation (static ring)', () => {
  const css = read('styles/globals.css');
  assert.match(css, /@keyframes tour-glow-pulse[\s\S]*?rgba\(212, 163, 115, 0\.6\)/);
  assert.match(css, /@keyframes tour-bounce[\s\S]*?scale\(1\.08\)/);
  assert.match(css, /\.tour-button--attention \{\s*animation: tour-glow-pulse 2s ease-in-out infinite, tour-bounce 4s ease-in-out infinite;/);
  assert.match(css, /\.tour-button--attention:focus-visible,\s*\.tour-button--attention:disabled \{\s*animation: none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.tour-button--attention \{\s*animation: none;/);
});
