import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const walk = (d) => readdirSync(path.join(ROOT, d)).flatMap((f) => { const r = `${d}/${f}`; return statSync(path.join(ROOT, r)).isDirectory() ? (r === 'pages/api' ? [] : walk(r)) : [r]; });
const files = [...walk('components'), ...walk('pages')].filter((f) => /\.jsx?$/.test(f) && f !== 'pages/admin.js');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
// PosterRenderer.jsx is excluded from the SIZE rule only: its credit block is the generated poster's artwork (it is rasterised into the exported image), not UI text.
const offenders = (re, skip = []) => files.filter((f) => !skip.includes(f)).flatMap((f) => [...strip(readFileSync(path.join(ROOT, f), 'utf8')).matchAll(re)].map((m) => `${f}: ${m[0]}`));

test('contrast floor (measured: white >= /50, gold >= /75, gray text >= gray-400, amber/red/emerald alphas, inline rgba colours, 10px minimum; admin page excluded)', () => {
  const all = []; const chk = (list) => all.push(...list);   // every category is collected, so one run lists ALL offenders
  // white text: any variant below /50 (a hover state must also end up brighter than the base, so hover:/group-hover: values must be >= 60)
  chk(offenders(/(?<![\w-])(?:(?:[a-z-]+:)*)text-white\/(?:[0-9]|[1-4][0-9])\b(?!\.)/g).filter((x) => !/(?:hover|group-hover):text-white\/(?:[6-9][0-9]|100)\b/.test(x)));
  chk(offenders(/(?<![\w-])(?:[a-z-]+:)*text-white\/\[[0-9.]+\]/g));
  chk(offenders(/placeholder(?:-|:text-)white\/(?:[0-9]|[1-4][0-9])\b/g));
  // gold text (the brand colour only passes 4.5:1 from /75 up; a hover state must be brighter than the base)
  chk(offenders(/(?<![\w-])text-\[#d4a373\]\/(?:[0-9]|[1-6][0-9]|7[0-4])\b/g, ['components/PosterRenderer.jsx']));
  // other coloured text with an alpha
  chk(offenders(/(?<![\w-])text-amber-400\/(?:[0-9]|[1-5][0-9]|6[0-4])\b/g));
  chk(offenders(/(?<![\w-])text-amber-500\/(?:[0-9]|[1-5][0-9]|6[0-9])\b/g));
  chk(offenders(/(?<![\w-])text-red-400\/(?:[0-9]|[1-7][0-9]|8[0-4])\b/g));
  chk(offenders(/(?<![\w-])text-(?:red-300|emerald-400)\/(?:[0-9]|[1-5][0-9]|6[0-4])\b/g));
  // gray text: gray-500 is 4.16:1 on the page background (it failed the live check), 600/700 are far lower; alpha variants too
  chk(offenders(/(?:text|placeholder)-gray-(?:500|600|700)\b/g));
  // inline rgba colours (style={{ color: 'rgba(...)' }}): white >= 0.5, gold >= 0.75, red 248,113,113 >= 0.85
  // line based, so ternaries (color: cond ? 'rgba(...)' : 'rgba(...)') are covered too; background / border / shadow / fill lines are not text colours
  const bad = files.flatMap((f) => strip(readFileSync(path.join(ROOT, f), 'utf8')).split('\n').flatMap((line, i) => {
    if (!/(?<![\w-])color\s*:/.test(line) || /background|border|[sS]hadow|fill|stroke|gradient|outline/.test(line)) return [];
    return [...line.matchAll(/rgba\((\d+), *(\d+), *(\d+), *([0-9.]+)\)/g)].filter((m) => {
      const [r, g, b, a] = [+m[1], +m[2], +m[3], +m[4]];
      if (r === 255 && g === 255 && b === 255) return a < 0.5;
      if (r === 212 && g === 163 && b === 115) return a < 0.75;
      if (r === 248 && g === 113 && b === 113) return a < 0.85;
      return false;
    }).map((m) => `${f}:${i + 1}: ${m[0]}`);
  }));
  chk(bad);
  // a framer-motion opacity animation on a text label must not dim it below the floor either
  assert.doesNotMatch(strip(readFileSync(path.join(ROOT, 'pages/index.js'), 'utf8')), /opacity: active \? 1 : done \? 0\.6 : 0\.22/);
  // size: nothing below 10px (PosterRenderer.jsx: the credit block is the generated poster's artwork, rasterised into the export)
  chk(offenders(/text-\[(?:[0-9]|[0-9]\.[0-9]+)px\]/g, ['components/PosterRenderer.jsx']));
  chk(offenders(/fontSize: '(?:[0-9]|[0-9]\.[0-9]+)px'/g));
  assert.deepEqual(all, []);
});

test('the showcase text panels use the full accent colour for their sub-line and watermark (they were 40% / 21% alpha: 1.7:1)', () => {
  const idx = strip(readFileSync(path.join(ROOT, 'pages/index.js'), 'utf8'));
  assert.doesNotMatch(idx, /\$\{poster\.accent\}(?:66|35)`/);
  assert.match(idx, /style=\{\{ color: poster\.accent \}\}>\{poster\.textSub\}/);
});

test('system notices share ONE token set (gold) defined in globals.css; no component hardcodes the old red banner', () => {
  const css = readFileSync(path.join(ROOT, 'styles/globals.css'), 'utf8');
  for (const v of ['--notice-bg', '--notice-border', '--notice-text']) assert.ok(css.includes(v), v);
  for (const c of ['.system-notice ', '.system-notice-text', '.system-notice-btn']) assert.ok(css.includes(c), c);
  assert.deepEqual(offenders(/bg-red-500\/10 border border-red-500\/20/g), []);
  for (const f of ['components/UpgradeModal.jsx', 'components/WaitlistModal.jsx', 'components/ReferralModal.jsx', 'components/DataDeletionPage.jsx', 'components/ErrorMessage.jsx', 'components/ScriptOutput.jsx', 'pages/index.js']) {
    assert.match(readFileSync(path.join(ROOT, f), 'utf8'), /system-notice/, f);
  }
});

test('heading order: the three section labels are h2 (not h3/h4) and the poster title is not a second h1', () => {
  const idx = readFileSync(path.join(ROOT, 'pages/index.js'), 'utf8');
  assert.match(idx, /<h2 className="text-\[#d4a373\] text-\[10px\] font-black tracking-\[0\.5em\] uppercase">/);
  assert.match(idx, /<h2 className="text-\[#d4a373\] font-black text-\[10px\] tracking-\[0\.3em\] uppercase">/);
  assert.match(readFileSync(path.join(ROOT, 'components/ScriptForm.jsx'), 'utf8'), /<h2 className="text-\[#d4a373\] font-black text-xs mb-6/);
  assert.doesNotMatch(strip(readFileSync(path.join(ROOT, 'components/PosterRenderer.jsx'), 'utf8')), /<h1/);
});
