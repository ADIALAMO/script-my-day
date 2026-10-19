import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../styles/globals.css', import.meta.url), 'utf8');

test('one shared :focus-visible ring covers links, buttons, fields and custom controls, and beats outline-none', () => {
  const m = css.match(/:where\(([^{]*)\):focus-visible \{([^}]*)\}/);
  assert.ok(m, 'shared focus-visible rule');
  for (const sel of ['a[href]', 'button', 'input', 'textarea', 'select', '[role="button"]', '[role="checkbox"]', '[role="radio"]']) assert.ok(m[1].includes(sel), sel);
  assert.match(m[2], /outline: 2px solid var\(--color-gold\) !important/);
  assert.match(m[2], /outline-offset: 2px !important/);
});
test('programmatic focus targets (tabindex=-1) are excluded and text fields get an inset ring', () => {
  assert.match(css, /\[tabindex\]:not\(\[tabindex="-1"\]\)/);
  assert.match(css, /:where\(input, textarea, select\):focus-visible \{\s*outline-offset: -2px !important;/);
});
test('it is keyboard-only: no plain :focus ring that a mouse click would trigger, and no global outline reset', () => {
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /(^|[\s,}])\*?:focus\s*\{[^}]*outline/m);
  assert.doesNotMatch(css.replace(/\/\*[\s\S]*?\*\//g, ''), /outline:\s*none(?!\s*!important[^;]*focus-visible)/);
});
