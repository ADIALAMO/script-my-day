import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitBold } from '../utils/script-markup.js';

test('bold markers become bold segments and the asterisks never reach the screen', () => {
  assert.deepEqual(splitBold('**CHARACTERS:**\nME (30)'), [{ text: 'CHARACTERS:', bold: true }, { text: '\nME (30)', bold: false }]);
  assert.deepEqual(splitBold('a **ADAM:** hi'), [{ text: 'a ', bold: false }, { text: 'ADAM:', bold: true }, { text: ' hi', bold: false }]);
});
test('an unclosed marker while typing bolds the rest; no segment contains "**"; empty input is safe', () => {
  assert.deepEqual(splitBold('x **CHAR'), [{ text: 'x ', bold: false }, { text: 'CHAR', bold: true }]);
  for (const t of ['**', '****', 'a**b**c**d', '*a* *b* *c', 'x *']) assert.ok(splitBold(t).every((s) => !s.text.includes('**')));
  assert.deepEqual(splitBold(undefined), []);
  assert.deepEqual(splitBold('a * b'), [{ text: 'a * b', bold: false }]);
  assert.deepEqual(splitBold('walking *her* now'), [{ text: 'walking ', bold: false }, { text: 'her', bold: false, italic: true }, { text: ' now', bold: false }]);
});
test('the script view renders through splitBold (not the raw string)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../components/ScriptOutput.jsx', import.meta.url), 'utf8');
  assert.match(src, /splitBold\(currentDisplayText\)/);
});
