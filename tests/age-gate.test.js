import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { needsAgeGate, rememberAge, hasConfirmedAge, AGE_KEY } from '../utils/age-gate.js';
import { AGE_GATE_COPY } from '../constants/age-gate-copy.js';

const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), has: (k) => m.has(k) }; };

test('only a settled guest who has not confirmed is asked; signed-in users and loading sessions never are', () => {
  const s = mem();
  assert.equal(needsAgeGate({ status: 'unauthenticated', storage: s }), true);
  assert.equal(needsAgeGate({ status: 'authenticated', storage: s }), false);
  assert.equal(needsAgeGate({ status: 'loading', storage: s }), false);
  rememberAge(s);
  assert.equal(hasConfirmedAge(s), true); assert.ok(s.has(AGE_KEY));
  assert.equal(needsAgeGate({ status: 'unauthenticated', storage: s }), false);
});
test('broken storage never throws (the question is just asked again)', () => {
  const bad = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.doesNotThrow(() => rememberAge(bad));
  assert.equal(needsAgeGate({ status: 'unauthenticated', storage: bad }), true);
});
test('copy: he + en for every string, gender-neutral Hebrew, a self-declaration (never "age verification", never under-18 wording)', () => {
  for (const [k, v] of Object.entries(AGE_GATE_COPY)) { assert.ok(v.he && v.en, k); }
  const all = JSON.stringify(AGE_GATE_COPY);
  assert.match(AGE_GATE_COPY.checkbox.he, /בן\/בת 18/);
  assert.match(AGE_GATE_COPY.body.en, /intended for adults aged 18 and over/);
  assert.doesNotMatch(all, /verif|אימות גיל|13|teen|family|Not 18|no problem|Pro\b/i);
});
test('index.js asks before the first guest script, remembers the answer, and Android Back closes the notice', () => {
  const src = readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8');
  assert.match(src, /needsAgeGate\(\{ status: sessionStatus \}\)/);
  assert.match(src, /rememberAge\(\);/);
  assert.match(src, /if \(s\.ageGateOpen\)\s+\{ setAgeGatePending\(null\)/);
  assert.match(src, /<AgeGateDialog open=\{!!ageGatePending\}/);
});
