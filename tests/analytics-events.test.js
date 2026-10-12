// Analytics events (Vercel Analytics track() and Google Analytics gtag('event', …)) must carry only fixed values:
// never text the user typed (producer name, journal) nor text derived from the script (film title), and never raw exception text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const files = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(js|jsx)$/.test(name)) files.push(p);
  }
};
for (const d of ['components', 'hooks', 'pages', 'utils']) walk(path.join(ROOT, d));

// every  track('Name', { … })  and  gtag('event', 'name', { … })  with a flat object literal
const CALL = /(?:\btrack\(\s*'[^']+'|\bgtag\(\s*'event'\s*,\s*'[^']+')\s*,\s*\{([^{}]*)\}/g;
const events = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(CALL)) events.push({ file: path.relative(ROOT, f), body: m[1] });
}

test('the scan finds the analytics events of the app (guards the scanner itself)', () => {
  assert.ok(events.length >= 20, `only ${events.length} events found`);
  assert.ok(events.some((e) => /method/.test(e.body)));
});

test('no analytics event carries a producer name, a film/poster title or journal/script text', () => {
  for (const e of events) {
    assert.doesNotMatch(e.body, /\b(title|posterTitle|producer\w*|journal\w*|entry|scriptText|text)\b\s*[:,}]|\b(title|producer|posterTitle|producerName)\s*:/, `${e.file}: ${e.body.trim().slice(0, 120)}`);
  }
});

test('script_error never sends raw exception text: error_message is a known error code or "other"', () => {
  const src = readFileSync(path.join(ROOT, 'pages/index.js'), 'utf8');
  assert.doesNotMatch(src, /error_message:\s*err\.message/);
  assert.match(src, /error_message:\s*Object\.values\(CODES\)\.includes\(err\.message\) \? err\.message : 'other'/);
});
