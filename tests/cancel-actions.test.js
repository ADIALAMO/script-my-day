// Two cancel actions must never be on screen together: while a script is generated the ONLY cancel is ScriptForm's; the overwrite dialog has its own and is shown when no
// generation is running (the lock logic makes the two states exclusive); CinematicLoader's chip is for the storyboard phase only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScriptFlow } from '../utils/script-flow.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const idx = read('pages/index.js');
const loaderTag = (src, phase) => { const m = new RegExp(`<CinematicLoader[^>]*?phase="${phase}"[^>]*?/>`, 's').exec(src); assert.ok(m, `CinematicLoader phase=${phase} found`); return m[0]; };

test('script phase: the floating loader has NO cancel; ScriptForm keeps the one cancel (receives onCancel, shown only while loading)', () => {
  assert.doesNotMatch(loaderTag(idx, 'script'), /onCancel/);
  assert.match(idx, /<ScriptForm[\s\S]*?onCancel=\{handleCancelGeneration\}/);
  const form = read('components/ScriptForm.jsx');
  assert.match(form, /\{loading && onCancel && \(/);
  assert.equal((form.match(/onClick=\{onCancel\}/g) || []).length, 1, 'one cancel in the form');
});

test('storyboard phase keeps its own (single) cancel — there is no form cancel on that screen', () => {
  assert.match(loaderTag(read('components/ScriptOutput.jsx'), 'storyboard'), /onCancel=\{cancelStoryboard\}/);
});

test('the overwrite dialog keeps its Cancel, Escape, backdrop and Android Back handling', () => {
  const dlg = read('components/ConfirmReplaceDialog.jsx');
  assert.match(dlg, /onClick=\{onCancel\}[\s\S]*?replaceCopy\('cancel'/); assert.match(dlg, /e\.key === 'Escape'/); assert.match(dlg, /data-replace-backdrop[^>]*onClick=\{onCancel\}/);
  assert.match(idx, /if \(s\.replaceConfirming\)\s+\{ scriptFlow\.cancel\(\)/);
});

test('exclusive states: the dialog can only open while idle, a generation cannot start while it is open, so the generation cancel and the dialog cancel never coexist', () => {
  const flow = createScriptFlow({ onStart() {} });
  const cancelsVisible = () => { const s = flow.getState(); return { generation: s.phase === 'generating', dialog: s.confirming }; };
  assert.equal(flow.request('a', 'drama', { hasScript: true }), 'confirm');
  assert.deepEqual(cancelsVisible(), { generation: false, dialog: true });
  assert.equal(flow.request('b', 'drama'), 'ignored');                       // no generation behind an open dialog
  flow.confirm();
  assert.deepEqual(cancelsVisible(), { generation: true, dialog: false });   // continue closes the dialog before the generation cancel exists
  assert.equal(flow.request('c', 'drama', { hasScript: true }), 'ignored');  // no dialog on top of a running generation
  flow.scriptReady(); flow.outputTyping(true);
  assert.deepEqual(cancelsVisible(), { generation: false, dialog: false }, 'typing: no cancel at all (Skip is the control)');
});
