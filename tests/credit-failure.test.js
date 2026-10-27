import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCreditStatus, isKeyLimitBody, creditStatus, providerErrorMessage } from '../lib/credit-failure.js';

// OpenRouter's real answer for a key that hit its own limit (HTTP 403)
const REAL = '{"error":{"message":"Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/abc $0.00 of $0.00 used; does not reset.","code":403,"metadata":{"limit_source":"openrouter_key_limit","remedy_hint":"Raise or remove this API key\'s usage limit at https://openrouter.ai/settings/keys, or use a key without a limit.","scope":"key_limit","limit_usd":0,"spend_usd":0,"resets_at":null}}}';

test('isCreditStatus: 402 only', () => {
  for (const s of [402]) assert.equal(isCreditStatus(s), true);
  for (const s of [401, 403, 429, 500, 503, 408, null, undefined, '402']) assert.equal(isCreditStatus(s), false, String(s));
});

test('creditStatus: ONLY a 403 with the key-limit body becomes 402; everything else is returned unchanged', () => {
  assert.equal(creditStatus(403, REAL), 402);
  assert.equal(creditStatus(403, JSON.parse(REAL)), 402, 'a parsed object works too');
  assert.equal(creditStatus(403, '{"error":{"metadata":{"scope":"key_limit"}}}'), 402);
  assert.equal(creditStatus(403, '{"error":{"metadata":{"limit_source":"openrouter_key_limit"}}}'), 402);
  assert.equal(creditStatus(403, REAL.slice(0, 120) + '"scope":"key_limit"'), 402, 'cut-off JSON falls back to the marker match');
  // look-alikes and everything else keep their status
  for (const body of ['', null, undefined, 42, '<html>Forbidden</html>', '{"error":{"message":"Forbidden","code":403}}', '{"error":{"metadata":{"scope":"model_access"}}}',
    '{"error":{"message":"scope key_limit"}}', '{"metadata":{"scope":"key_limit"}}', '[]', '{"error":null}']) {
    assert.equal(creditStatus(403, body), 403, JSON.stringify(body));
  }
  for (const status of [400, 401, 402, 404, 429, 500, 503]) assert.equal(creditStatus(status, REAL), status, `status ${status} is never remapped`);
  assert.equal(isKeyLimitBody(REAL), true);
});

test('providerErrorMessage: unchanged text for every normal error; a key limit is thrown as 402 with a FIXED text (marker, no key URL)', () => {
  assert.equal(providerErrorMessage('OpenRouter', 500, 'x'.repeat(300)), `OpenRouter 500: ${'x'.repeat(150)}`);
  assert.equal(providerErrorMessage('OpenRouter', 403, '{"error":{"message":"Forbidden"}}'), 'OpenRouter 403: {"error":{"message":"Forbidden"}}');
  const m = providerErrorMessage('x-ai/grok-imagine-image-quality', 403, REAL);
  assert.match(m, /^x-ai\/grok-imagine-image-quality 402: \(key limit\)/); assert.ok(!/workspaces|settings\/keys|abc/.test(m));
});
