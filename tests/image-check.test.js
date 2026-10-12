import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNemotronVerdict, parseFallbackVerdict, imageHash, NEMOTRON_SLUG, FALLBACK_SLUG, NEMOTRON_MAX_TOKENS, reasoningOption } from '../lib/image-check.js';
import { checkBudgetUsd, checkMaxCalls, CHECK_COST_USD } from '../lib/budget.js';

// Pinned format (NVIDIA model card / NIM reference): "User Safety: safe|unsafe", optional "Response Safety: …", optional "Safety Categories: …"
test('parseNemotronVerdict — table-driven', () => {
  const T = [
    // accepted shapes
    ['User Safety: safe', 'safe'],
    ['User Safety: safe\n', 'safe'],
    ['  User Safety: Safe  ', 'safe'],
    ['User Safety: safe\nResponse Safety: safe', 'safe'],
    ['User Safety: safe\nSafety Categories: None', 'safe'],
    ['User Safety: safe\r\nSafety Categories: ', 'safe'],
    ['User Safety: unsafe', 'unsafe'],
    ['User Safety: unsafe\nSafety Categories: Sexual', 'unsafe'],
    ['User Safety: unsafe\nResponse Safety: unsafe\nSafety Categories: Criminal Planning/Confessions', 'unsafe'],
    ['User Safety: safe\nResponse Safety: unsafe', 'unsafe'],
    // everything else is UNKNOWN (and therefore rejected)
    ['not safe', 'unknown'],
    ['safe', 'unknown'],
    ['unsafe', 'unknown'],
    ['I cannot confirm this is safe', 'unknown'],
    ['cannot confirm this is safe', 'unknown'],
    ['User Safety: not safe', 'unknown'],
    ['User Safety: safe-ish', 'unknown'],
    ['User Safety: safe\nUser Safety: unsafe', 'unknown'],
    ['User Safety: safe unsafe', 'unknown'],
    ['User Safety: safe\nSafety Categories: Sexual', 'unknown'],   // categories on a safe verdict contradict
    ['User Safety: safe\nSomething else: x', 'unknown'],
    ['Response Safety: safe', 'unknown'],                          // required field missing
    ['User Safety:', 'unknown'],
    ['user_safety: safe', 'unknown'],
    ['{"User Safety": "safe"}', 'unknown'],
    ['The image is safe.\nUser Safety: safe', 'unknown'],
    ['', 'unknown'],
    ['   \n  ', 'unknown'],
    [undefined, 'unknown'], [null, 'unknown'], [42, 'unknown'], [{}, 'unknown'], [['User Safety: safe'], 'unknown'],
  ];
  for (const [input, want] of T) assert.equal(parseNemotronVerdict(input), want, JSON.stringify(input));
});

// The four REAL raw replies recorded by the format probe on the free route (2026-10-12) — the parser is pinned to them.
test('parseNemotronVerdict — pinned to the four real raw replies', () => {
  const REAL = [
    ['User Safety: safe', 'safe'],
    ['User Safety: safe\nResponse Safety: safe', 'safe'],
    ['User Safety: unsafe\nSafety Categories: Sexual', 'unsafe'],
    ['User Safety: unsafe\nResponse Safety: unsafe\nSafety Categories: Illegal Activity, Other, Needs Caution', 'unsafe'],
  ];
  for (const [raw, want] of REAL) assert.equal(parseNemotronVerdict(raw), want, JSON.stringify(raw));
});

test('parseFallbackVerdict (Gemini via OpenRouter) — exact {"verdict": …} only; any refusal is unsafe and wins over the text', () => {
  const ok = (content, extra = {}) => ({ choices: [{ finish_reason: 'stop', message: { content }, ...extra }] });
  assert.equal(parseFallbackVerdict(ok('{"verdict":"safe"}')), 'safe');
  assert.equal(parseFallbackVerdict(ok('{"verdict":"unsafe"}')), 'unsafe');
  assert.equal(parseFallbackVerdict(ok(' {"verdict": "safe"} ')), 'safe');
  for (const bad of ['safe', '{"verdict":"maybe"}', '{"verdict":"safe","note":"x"}', '{"result":"safe"}', '[]', '"safe"', 'null', '', '{"verdict":["safe"]}', '{"verdict":"Safe"}', null, 42]) {
    assert.equal(parseFallbackVerdict(ok(bad)), 'unknown', String(bad));
  }
  assert.equal(parseFallbackVerdict({ choices: [{ finish_reason: 'content_filter', message: { content: null } }] }), 'unsafe');
  assert.equal(parseFallbackVerdict({ choices: [{ finish_reason: 'stop', native_finish_reason: 'IMAGE_SAFETY', message: { content: null } }] }), 'unsafe');
  assert.equal(parseFallbackVerdict({ choices: [{ finish_reason: 'stop', native_finish_reason: 'SAFETY', message: { content: '{"verdict":"safe"}' } }] }), 'unsafe', 'a native SAFETY reason wins over a "safe" text');
  assert.equal(parseFallbackVerdict({ choices: [{ message: { content: '{"verdict":"safe"}', refusal: 'I cannot assist' } }] }), 'unsafe');
  assert.equal(parseFallbackVerdict({}), 'unknown');
  assert.equal(parseFallbackVerdict(null), 'unknown');
  assert.equal(parseFallbackVerdict({ choices: [] }), 'unknown');
});

test('imageHash is the SHA-256 of the DECODED bytes, independent of the claimed MIME type', () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal(imageHash(`data:image/png;base64,${b64}`), imageHash(`data:image/jpeg;base64,${b64}`));
  assert.match(imageHash(`data:image/png;base64,${b64}`), /^[0-9a-f]{64}$/);
  assert.equal(imageHash('https://example.com/x.png'), null);
  assert.equal(imageHash(undefined), null);
});

test('pinned slugs and request defaults', () => {
  assert.equal(NEMOTRON_SLUG, 'nvidia/nemotron-3.5-content-safety:free');
  assert.equal(FALLBACK_SLUG, 'google/gemini-2.5-flash-lite');
  assert.equal(NEMOTRON_MAX_TOKENS, 512);
  const keep = process.env.IMAGE_CHECK_REASONING_EFFORT;
  try {
    delete process.env.IMAGE_CHECK_REASONING_EFFORT; assert.deepEqual(reasoningOption(), { reasoning: { effort: 'none' } });
    process.env.IMAGE_CHECK_REASONING_EFFORT = 'low'; assert.deepEqual(reasoningOption(), { reasoning: { effort: 'low' } });
    process.env.IMAGE_CHECK_REASONING_EFFORT = 'bogus'; assert.deepEqual(reasoningOption(), { reasoning: { effort: 'none' } });
    process.env.IMAGE_CHECK_REASONING_EFFORT = 'off'; assert.deepEqual(reasoningOption(), {});
  } finally { if (keep === undefined) delete process.env.IMAGE_CHECK_REASONING_EFFORT; else process.env.IMAGE_CHECK_REASONING_EFFORT = keep; }
});

test('paid-checker budget math: default $0.50/day, 0 switches the fallback off, junk falls back to the default', () => {
  const keep = process.env.DAILY_CHECK_BUDGET;
  try {
    delete process.env.DAILY_CHECK_BUDGET; assert.equal(checkBudgetUsd(), 0.5); assert.equal(checkMaxCalls(), Math.floor(0.5 / CHECK_COST_USD));
    process.env.DAILY_CHECK_BUDGET = '0'; assert.equal(checkMaxCalls(), 0);
    process.env.DAILY_CHECK_BUDGET = '0.0003'; assert.equal(checkMaxCalls(), 2);
    process.env.DAILY_CHECK_BUDGET = 'abc'; assert.equal(checkBudgetUsd(), 0.5);
    process.env.DAILY_CHECK_BUDGET = '-1'; assert.equal(checkBudgetUsd(), 0.5);
  } finally { if (keep === undefined) delete process.env.DAILY_CHECK_BUDGET; else process.env.DAILY_CHECK_BUDGET = keep; }
});
