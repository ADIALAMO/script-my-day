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

test('contrast floor: no white text below /45, no gray-600/700 text, no text below 10px (admin page excluded)', () => {
  assert.deepEqual(offenders(/(?<![\w-])(?:[a-z-]+:)*text-white\/(?:[0-9]|[1-3][0-9]|4[0-4])\b/g), []);
  assert.deepEqual(offenders(/(?:text|placeholder)-gray-(?:600|700)\b/g), []);
  assert.deepEqual(offenders(/placeholder(?:-|:text-)white\/(?:[0-9]|[1-3][0-9]|4[0-4])\b/g), []);
  assert.deepEqual(offenders(/text-\[(?:[0-9]|[0-9]\.[0-9]+)px\]/g, ['components/PosterRenderer.jsx']), []);
  assert.deepEqual(offenders(/fontSize: '(?:[0-9]|[0-9]\.[0-9]+)px'/g), []);
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
  assert.match(idx, /<h2 className="text-\[#d4a373\] text-\[10px\] font-black tracking-\[0\.5em\] uppercase opacity-60">/);
  assert.match(idx, /<h2 className="text-\[#d4a373\] font-black text-\[10px\] tracking-\[0\.3em\] uppercase">/);
  assert.match(readFileSync(path.join(ROOT, 'components/ScriptForm.jsx'), 'utf8'), /<h2 className="text-\[#d4a373\] font-black text-xs mb-6/);
  assert.doesNotMatch(strip(readFileSync(path.join(ROOT, 'components/PosterRenderer.jsx'), 'utf8')), /<h1/);
});
