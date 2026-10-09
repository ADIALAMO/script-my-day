import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODES, getMsg } from '../lib/messages.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args) => { try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 20e6 }); } catch { return ''; } };

// Codes that are deliberately internal (never shown to a user as text). Keep this list EMPTY unless there is a reason.
const NO_TEXT_NEEDED = new Set([]);

/** every `CODES.NAME` referenced anywhere in application code, plus `code: 'NAME'` string literals that equal a known code */
function usedCodes() {
  const files = git(['grep', '-lE', 'CODES\\.|code: ?[\'"]', '--', 'pages', 'lib', 'hooks', 'components', 'utils', ':!lib/messages.js']).split('\n').filter(Boolean);
  const used = new Map();
  const names = new Set(Object.keys(CODES));
  const values = new Set(Object.values(CODES));
  for (const f of files) {
    const src = git(['show', `:${f}`]) || '';        // staged/committed content; falls back below for untracked
    const text = src || execFileSync('cat', [path.join(ROOT, f)], { encoding: 'utf8' });
    for (const m of text.matchAll(/CODES\.([A-Z_]+)/g)) if (names.has(m[1])) (used.get(CODES[m[1]]) ?? used.set(CODES[m[1]], new Set()).get(CODES[m[1]])).add(f);
    for (const m of text.matchAll(/code:\s*['"]([A-Z_]+)['"]/g)) if (values.has(m[1])) (used.get(m[1]) ?? used.set(m[1], new Set()).get(m[1])).add(f);
  }
  return used;
}

test('the scan finds the codes the application really uses (guards the scanner itself)', () => {
  const used = usedCodes();
  for (const c of ['QUOTA_SCRIPT', 'QUOTA_SHEET', 'IMAGE_BUDGET_REACHED', 'IDENTITY_BUDGET_REACHED', 'COMIC_SESSION_EXPIRED']) assert.ok(used.has(c), `scanner missed ${c}`);
  assert.ok(used.size >= 20, `only ${used.size} codes found`);
});

test('EVERY message code used in the code has a non-empty text in BOTH English and Hebrew (no raw code strings reach users)', () => {
  const missing = [];
  for (const [code, files] of usedCodes()) {
    if (NO_TEXT_NEEDED.has(code)) continue;
    for (const lang of ['en', 'he']) {
      const t = getMsg(code, lang);
      if (!t || t === code || t.trim().length < 8) missing.push(`${code}/${lang} (used in ${[...files].join(', ')})`);
    }
    if (getMsg(code, 'he') === getMsg(code, 'en')) missing.push(`${code}: Hebrew text equals English`);
  }
  assert.deepEqual(missing, [], `message codes without proper bilingual text:\n${missing.join('\n')}`);
});

test('every code defined in CODES also has a text (a defined-but-unused code is a regression waiting to happen)', () => {
  const missing = Object.values(CODES).filter((c) => getMsg(c, 'en') === c || getMsg(c, 'he') === c);
  assert.deepEqual(missing, []);
});

test('placeholders in messages are either filled or replaced by a clean fallback (no raw "{limit}" ever shown)', () => {
  for (const c of Object.values(CODES)) for (const lang of ['en', 'he']) assert.ok(!/\{\w+\}/.test(getMsg(c, lang)), `${c}/${lang}`);
});
