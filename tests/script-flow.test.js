// "Create script": lock window, overwrite confirmation, double tap, History. Drives the real controller (utils/script-flow.js) the way pages/index.js does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScriptFlow, AWAIT_OUTPUT_MS } from '../utils/script-flow.js';
import { nextFocusIndex } from '../utils/focus-trap.js';
import { REPLACE_SCRIPT_COPY, replaceCopy } from '../constants/replace-script-copy.js';

function harness() {
  const starts = []; const timers = [];
  const flow = createScriptFlow({
    onStart: (entry, genre) => starts.push([entry, genre]),
    schedule: (fn, ms) => { const t = { fn, ms, dead: false }; timers.push(t); return t; },
    cancelSchedule: (t) => { t.dead = true; },
  });
  return { flow, starts, timers, locked: () => flow.getState().locked, phase: () => flow.getState().phase };
}
// the happy path the page performs after a tap
const generated = (h) => { h.flow.scriptReady(); h.flow.outputTyping(true); };

test('first generation: no dialog, starts at once and is LOCKED synchronously', () => {
  const h = harness();
  assert.equal(h.flow.request('my day', 'drama', { hasScript: false }), 'started');
  assert.equal(h.locked(), true); assert.equal(h.phase(), 'generating'); assert.equal(h.flow.getState().confirming, false);
  assert.deepEqual(h.starts, [['my day', 'drama']]);
});

test('the lock lasts until the typewriter has FINISHED, not until the script arrived', () => {
  const h = harness();
  h.flow.request('a', 'drama'); assert.equal(h.locked(), true);
  h.flow.scriptReady(); assert.equal(h.locked(), true, 'script generated, not yet typing');
  h.flow.outputTyping(true); assert.equal(h.locked(), true, 'typing');
  h.flow.outputTyping(false); assert.equal(h.locked(), false, 'typing finished');
});

test('skipping the typing counts as finishing (the typewriter reports false)', () => {
  const h = harness(); h.flow.request('a', 'drama'); generated(h);
  h.flow.outputTyping(false);
  assert.equal(h.locked(), false);
});

test('a stale "typing ended" from the previous ScriptOutput (it unmounts while the new script arrives) does not unlock early', () => {
  const h = harness(); h.flow.request('a', 'drama');
  h.flow.outputTyping(false); assert.equal(h.locked(), true, 'while generating');
  h.flow.scriptReady(); h.flow.outputTyping(false); assert.equal(h.locked(), true, 'while waiting for the new output to start typing');
  h.flow.outputTyping(true); assert.equal(h.locked(), true);
});

test('errors, quota / auth prompt and abort unlock (the request ended without a script)', () => {
  for (const why of ['error', 'quota', 'abort']) {
    const h = harness(); h.flow.request('a', 'drama'); assert.equal(h.locked(), true, why);
    h.flow.generationEnded(); assert.equal(h.locked(), false, why);
    assert.equal(h.flow.request('b', 'drama'), 'started', `${why}: can try again`);
  }
});

test('generationEnded after a script arrived (the fetch\'s finally) does NOT unlock a script that is still typing', () => {
  const h = harness(); h.flow.request('a', 'drama'); h.flow.scriptReady(); h.flow.generationEnded();
  assert.equal(h.locked(), true); h.flow.outputTyping(true); h.flow.generationEnded(); assert.equal(h.locked(), true);
});

test('DOUBLE TAP: the second tap is ignored — one generation, one credit', () => {
  const h = harness();
  assert.equal(h.flow.request('a', 'drama'), 'started');
  assert.equal(h.flow.request('a', 'drama'), 'ignored');
  assert.equal(h.flow.request('a', 'drama', { hasScript: true }), 'ignored', 'not even a dialog while locked');
  assert.equal(h.starts.length, 1);
  h.flow.scriptReady(); assert.equal(h.flow.request('a', 'drama'), 'ignored'); assert.equal(h.starts.length, 1);
  h.flow.outputTyping(true); assert.equal(h.flow.request('a', 'drama'), 'ignored'); assert.equal(h.starts.length, 1);
});

test('existing script: the tap asks first — nothing is sent, nothing is locked', () => {
  const h = harness();
  assert.equal(h.flow.request('again', 'drama', { hasScript: true }), 'confirm');
  assert.equal(h.flow.getState().confirming, true); assert.equal(h.locked(), false); assert.equal(h.starts.length, 0);
});

test('dialog CANCEL: nothing changes, no request, no lock; a later tap asks again', () => {
  const h = harness(); h.flow.request('again', 'drama', { hasScript: true });
  assert.equal(h.flow.cancel(), true);
  assert.deepEqual([h.flow.getState().confirming, h.locked(), h.starts.length], [false, false, 0]);
  assert.equal(h.flow.request('again', 'drama', { hasScript: true }), 'confirm');
  assert.equal(h.flow.cancel(), true); assert.equal(h.flow.cancel(), false, 'a second Escape/Back is harmless');
});

test('dialog CONTINUE: generates exactly once with the entry from the tap, locks, closes the dialog; a double click on Continue does nothing more', () => {
  const h = harness(); h.flow.request('again', 'comedy', { hasScript: true });
  assert.equal(h.flow.confirm(), true);
  assert.deepEqual(h.starts, [['again', 'comedy']]); assert.equal(h.locked(), true); assert.equal(h.flow.getState().confirming, false);
  assert.equal(h.flow.confirm(), false); assert.equal(h.starts.length, 1);
});

test('taps are ignored while the dialog is open (no stacked dialogs, no second pending request)', () => {
  const h = harness(); h.flow.request('one', 'drama', { hasScript: true });
  assert.equal(h.flow.request('two', 'drama', { hasScript: true }), 'ignored'); assert.equal(h.flow.request('two', 'drama'), 'ignored');
  h.flow.confirm(); assert.deepEqual(h.starts, [['one', 'drama']]);
});

test('a script opened from History is never locked, and the next tap asks before replacing it', () => {
  const h = harness();
  h.flow.scriptReplaced(); assert.equal(h.locked(), false);
  h.flow.outputTyping(false);   // the instant output reports "not typing"
  assert.equal(h.locked(), false);
  assert.equal(h.flow.request('x', 'drama', { hasScript: true }), 'confirm');
});

test('opening History while a script is typing releases the lock; while the dialog is open it closes it', () => {
  const h = harness(); h.flow.request('a', 'drama'); generated(h); assert.equal(h.locked(), true);
  h.flow.scriptReplaced(); assert.equal(h.locked(), false);
  const g = harness(); g.flow.request('a', 'drama', { hasScript: true }); g.flow.scriptReplaced(); assert.equal(g.flow.getState().confirming, false);
});

test('ScriptOutput unmounting while typing (it reports false) unlocks', () => {
  const h = harness(); h.flow.request('a', 'drama'); generated(h); h.flow.outputTyping(false); assert.equal(h.locked(), false);
});

test('watchdog: if the output never starts typing the lock is released after AWAIT_OUTPUT_MS; a normal start cancels it', () => {
  const h = harness(); h.flow.request('a', 'drama'); h.flow.scriptReady();
  const t = h.timers.at(-1); assert.equal(t.ms, AWAIT_OUTPUT_MS);
  h.flow.outputTyping(true); assert.equal(t.dead, true, 'cancelled once typing started');
  const g = harness(); g.flow.request('a', 'drama'); g.flow.scriptReady(); g.timers.at(-1).fn();
  assert.equal(g.locked(), false);
});

test('subscribers get every change; unsubscribe stops them', () => {
  const h = harness(); const seen = []; const off = h.flow.subscribe((s) => seen.push(s.phase));
  h.flow.request('a', 'drama'); h.flow.scriptReady(); h.flow.outputTyping(true); off(); h.flow.outputTyping(false);
  assert.deepEqual(seen, ['generating', 'awaiting-output', 'typing']);
});

test('focus trap order: Tab / Shift+Tab cycle inside the dialog, focus from outside lands on the first / last control', () => {
  assert.equal(nextFocusIndex(2, 0, false), 1); assert.equal(nextFocusIndex(2, 1, false), 0);
  assert.equal(nextFocusIndex(2, 0, true), 1); assert.equal(nextFocusIndex(2, 1, true), 0);
  assert.equal(nextFocusIndex(2, -1, false), 0); assert.equal(nextFocusIndex(2, -1, true), 1);
  assert.equal(nextFocusIndex(0, -1), -1);
});

test('dialog copy: he + en for every string, says what is cleared and kept, no price / plan words', () => {
  for (const [k, v] of Object.entries(REPLACE_SCRIPT_COPY)) { assert.ok(/[֐-׿]/.test(v.he), `${k} he`); assert.ok(/^[\x20-\x7E…’]+$/.test(v.en), `${k} en`); }
  assert.match(replaceCopy('clears', 'en'), /script.*poster.*comic.*reel/i); assert.match(replaceCopy('keeps', 'en'), /History/); assert.match(replaceCopy('keeps', 'en'), /reel is not saved/i);
  assert.match(replaceCopy('clears', 'he'), /תסריט.*פוסטר.*קומיקס.*ריל/); assert.match(replaceCopy('keeps', 'he'), /היסטוריה/);
  assert.equal(replaceCopy('title', 'xx'), REPLACE_SCRIPT_COPY.title.en);
  assert.doesNotMatch(JSON.stringify(REPLACE_SCRIPT_COPY), /Stripe|\$\s?9|upgrade|שדרג|subscription|מנוי|\bPro\b|פרו\b|billing|חיוב|checkout|per month|לחודש|waitlist/i);
});

test('wiring in the page: sync lock before any request, dialog mounted, Android Back closes it, History releases, ScriptForm button disabled + aria-disabled', () => {
  const idx = readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8');
  assert.match(idx, /onSubmit=\{requestGenerate\}/); assert.match(idx, /locked=\{flowState\.locked\}/);
  assert.match(idx, /<ConfirmReplaceDialog open=\{flowState\.confirming\}/);
  assert.match(idx, /if \(s\.replaceConfirming\)\s+\{ scriptFlow\.cancel\(\)/);
  assert.match(idx, /scriptFlow\.scriptReplaced\(\)/); assert.match(idx, /scriptFlow\.scriptReady\(\)/); assert.match(idx, /setIsTypingGlobal=\{onOutputTyping\}/);
  assert.doesNotMatch(idx, /onSubmit=\{handleGenerateScript\}/);
  const form = readFileSync(new URL('../components/ScriptForm.jsx', import.meta.url), 'utf8');
  assert.match(form, /disabled=\{loading \|\| locked/); assert.match(form, /aria-disabled=/); assert.match(form, /if \(loading \|\| locked/);
  const dlg = readFileSync(new URL('../components/ConfirmReplaceDialog.jsx', import.meta.url), 'utf8');
  assert.doesNotMatch(dlg, /window\.confirm|overflow-y-auto|overflow-auto/); assert.match(dlg, /e\.key === 'Escape'/); assert.match(dlg, /role="alertdialog"/); assert.match(dlg, /minHeight: 44/);
});
