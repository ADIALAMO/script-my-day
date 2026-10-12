import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseNemotronVerdict, parseGeminiVerdict, imageHash, NEMOTRON_SLUG } from '../lib/image-check.js';
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

test('parseGeminiVerdict — exact {"verdict": …} only; any Gemini block on an image input is unsafe', () => {
  const ok = (text, extra = {}) => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra }] });
  assert.equal(parseGeminiVerdict(ok('{"verdict":"safe"}')), 'safe');
  assert.equal(parseGeminiVerdict(ok('{"verdict":"unsafe"}')), 'unsafe');
  assert.equal(parseGeminiVerdict(ok(' {"verdict": "safe"} ')), 'safe');
  for (const bad of ['safe', '{"verdict":"maybe"}', '{"verdict":"safe","note":"x"}', '{"result":"safe"}', '[]', '"safe"', 'null', '', '{"verdict":["safe"]}', '{"verdict":"Safe"}']) {
    assert.equal(parseGeminiVerdict(ok(bad)), 'unknown', bad);
  }
  assert.equal(parseGeminiVerdict({ promptFeedback: { blockReason: 'SAFETY' } }), 'unsafe');
  assert.equal(parseGeminiVerdict({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }), 'unsafe');
  assert.equal(parseGeminiVerdict({ promptFeedback: { blockReason: 'IMAGE_SAFETY' } }), 'unsafe');
  assert.equal(parseGeminiVerdict(ok('', { finishReason: 'SAFETY' })), 'unsafe');
  assert.equal(parseGeminiVerdict(ok('{"verdict":"safe"}', { finishReason: 'SAFETY' })), 'unsafe', 'a SAFETY finish reason wins over a "safe" text');
  assert.equal(parseGeminiVerdict({}), 'unknown');
  assert.equal(parseGeminiVerdict(null), 'unknown');
  assert.equal(parseGeminiVerdict({ candidates: [] }), 'unknown');
});

test('imageHash is the SHA-256 of the DECODED bytes, independent of the claimed MIME type', () => {
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  assert.equal(imageHash(`data:image/png;base64,${b64}`), imageHash(`data:image/jpeg;base64,${b64}`));
  assert.match(imageHash(`data:image/png;base64,${b64}`), /^[0-9a-f]{64}$/);
  assert.equal(imageHash('https://example.com/x.png'), null);
  assert.equal(imageHash(undefined), null);
});

test('the pinned model slug is the free Nemotron route', () => {
  assert.equal(NEMOTRON_SLUG, 'nvidia/nemotron-3.5-content-safety:free');
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
