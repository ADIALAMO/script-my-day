import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPolicyRoutingError } from '../lib/policy-routing.js';
import { isContentRefusal } from '../lib/content-safety.js';

const POLICY = 'No endpoints found matching your data policy (Free model training). Configure: https://openrouter.ai/settings/privacy';

test('isPolicyRoutingError: only a 404 whose text is the data-policy routing failure', () => {
  assert.equal(isPolicyRoutingError(404, `{"error":{"message":"${POLICY}","code":404}}`), true);
  assert.equal(isPolicyRoutingError(404, 'no endpoints found MATCHING your DATA POLICY'), true);
  for (const [status, text] of [[404, 'model not found'], [404, ''], [404, null], [403, POLICY], [429, POLICY], [500, POLICY], [null, POLICY]]) assert.equal(isPolicyRoutingError(status, text), false, `${status} ${text}`);
});

test('isContentRefusal: a data-policy 404 is a TECHNICAL failure — also a variant that names "safety" or "moderation" — while real refusals still are refusals', () => {
  for (const text of [POLICY, 'No endpoints found matching your data policy (Safety retention).', 'OpenRouter 404: No endpoints found matching your data policy (moderation required)', 'No endpoints found that can handle the requested parameters']) {
    assert.equal(isContentRefusal(new Error(`OpenRouter 404: ${text}`)), false, text);
  }
  for (const text of ['OpenRouter 400: content_policy_violation', 'Cloudflare AI 400: {"errors":[{"code":8007,"message":"AiError: Input prompt contains NSFW content"}]}', 'xAI 403: request flagged by moderation', 'x-ai/grok 422: unsafe content']) {
    assert.equal(isContentRefusal(new Error(text)), true, text);
  }
  assert.equal(isContentRefusal(Object.assign(new Error('x'), { contentRefusal: true })), true);
});
