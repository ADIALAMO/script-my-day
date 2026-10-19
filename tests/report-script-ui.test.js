// "Report this script": client pieces — copy (he + en), the device-local hide, and the source pins that keep the text out of every request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const { REPORT_COPY, reportText } = await import('../constants/report-copy.js');
const { parseRef, REPORT_KINDS } = await import('../lib/report.js');

test('copy exists in he AND en for the script report (title, aria, intro, done, hidden tile, error); the intro says the text is not received', () => {
  for (const entry of [REPORT_COPY.title.script, REPORT_COPY.buttonAriaScript, REPORT_COPY.introScript, REPORT_COPY.doneScript, REPORT_COPY.hiddenScript, REPORT_COPY.errors.invalidScript]) {
    assert.ok(reportText(entry, 'en').length > 5); assert.match(reportText(entry, 'he'), /[א-ת]/);
  }
  assert.match(reportText(REPORT_COPY.introScript, 'en'), /We do not receive the text itself/); assert.match(reportText(REPORT_COPY.introScript, 'he'), /אנחנו לא מקבלים את הטקסט עצמו/);
  assert.doesNotMatch(reportText(REPORT_COPY.introScript, 'he') + reportText(REPORT_COPY.doneScript, 'he') + reportText(REPORT_COPY.hiddenScript, 'he'), /ספר |תוכל|שלך /, 'Hebrew stays gender-neutral');
});

test('parseRef: a script ref is only {genre from the genre list, lang he|en} — extra fields (text) are dropped, anything else is null', () => {
  assert.deepEqual(parseRef({ script: { genre: 'Drama', lang: 'he', text: 'SECRET' } }), { kind: 'script', genre: 'drama', lang: 'he' });
  assert.ok(REPORT_KINDS.includes('script'));
  for (const bad of [{ script: { genre: 'nope', lang: 'he' } }, { script: { genre: 'drama', lang: 'de' } }, { script: {} }, { script: 'drama' }, { script: { genre: '__proto__', lang: 'en' } }, { script: { genre: 'drama', lang: 'en' }, url: 'https://x' }]) assert.equal(parseRef(bad), null, JSON.stringify(bad));
});

test('device-local hide: scriptKey is stable, short and not the text; isScriptReported/markScriptReported round-trip without storage', async () => {
  const S = await import('../utils/reported-store.js');
  const text = 'INT. KITCHEN - NIGHT\nShe waits.';
  assert.equal(S.scriptKey(text), S.scriptKey(text)); assert.notEqual(S.scriptKey(text), S.scriptKey(`${text}!`));
  assert.ok(!S.scriptKey(text).includes('KITCHEN') && S.scriptKey(text).length < 40);
  assert.equal(S.isScriptReported(text), false); S.markScriptReported(text); assert.equal(S.isScriptReported(text), true);   // in-memory (no window in node)
  assert.equal(S.isScriptReported(''), false);
});

test('source: the request carries {genre, lang} only (never the script); ScriptOutput shows the control, hides + stops exporting a reported script, and stays out of the typing / editing states', () => {
  const hook = read('hooks/useReportContent.js');
  assert.match(hook, /refs\.push\(\{ script: \{ genre: scriptRef\.genre, lang: scriptRef\.lang \} \}\)/);
  const so = read('components/ScriptOutput.jsx');
  assert.match(so, /<ReportButton\s+kind="script" compact lang=\{lang\}/);
  assert.match(so, /scriptRef=\{\{ genre: String\(genre \|\| ''\)\.toLowerCase\(\), lang: isHebrew \? 'he' : 'en' \}\}/);
  assert.match(so, /\{!scriptReported && !isEditing && !isTyping && currentDisplayText\.length > 0 && \(/);
  assert.match(so, /markScriptReported\(script\); setScriptReported\(true\)/);
  assert.match(so, /\) : scriptReported \? \(/);                                  // the script view is replaced by the hidden tile
  assert.match(so, /\{!scriptReported && \(\s*<div ref=\{exportMenuRef\}/);       // no export / copy / print / share of the text once reported
  // the text itself is never passed to the report control
  const block = so.slice(so.indexOf('kind="script"'), so.indexOf('kind="script"') + 400);
  assert.doesNotMatch(block, /currentDisplayText|currentScriptText|cleanScript|script=\{/);
  const btn = read('components/ReportButton.jsx');
  assert.match(btn, /const isScript = kind === 'script'/); assert.match(btn, /REPORT_COPY\.introScript/);
});
