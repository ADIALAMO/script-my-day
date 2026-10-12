import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_SAFETY_RULE, GEMINI_SAFETY_SETTINGS, ContentRefusalError, geminiBlockReason, openRouterRefusal, isContentRefusal,
} from '../lib/content-safety.js';
import { SYSTEM_PROMPT } from '../lib/agent.js';
import { CODES, getMsg } from '../lib/messages.js';

test('isContentRefusal: Cloudflare 8007 NSFW and other safety wording are refusals', () => {
  assert.equal(isContentRefusal(new Error('Cloudflare AI 400: {"errors":[{"code":8007,"message":"AiError: Input prompt contains NSFW content"}]}')), true);
  assert.equal(isContentRefusal(new Error('OpenRouter 403: Input flagged by moderation')), true);
  assert.equal(isContentRefusal(new Error('google/gemini-2.5-flash-image 400: blocked, finishReason IMAGE_SAFETY')), true);
  assert.equal(isContentRefusal(new ContentRefusalError('x refused the content')), true);
});

test('isContentRefusal: technical failures are NOT refusals (they keep falling through to the next provider)', () => {
  for (const m of [
    'Cloudflare AI 500: mock failure', 'OpenRouter 429: rate limited', 'OpenRouter 503: upstream unavailable', 'HF 410: gone',
    'The operation was aborted', 'fetch failed', 'OPENROUTER_API_KEY not configured', 'Image fetch failed: HTTP 504',
    // Cloudflare's schema error (code 5006) contains "not allowed" and must stay a plain failure
    `Cloudflare AI 400: Additional or unevaluated properties '/seed' at '/' not allowed`,
    'OpenRouter 429: safety limits exceeded, retry later',   // a 429 is always technical, whatever the wording
  ]) assert.equal(isContentRefusal(new Error(m)), false, m);
  assert.equal(isContentRefusal(null), false);
});

test('geminiBlockReason reads promptFeedback and safety finish reasons only', () => {
  assert.equal(geminiBlockReason({ promptFeedback: { blockReason: 'SAFETY' } }), 'SAFETY');
  assert.equal(geminiBlockReason({ candidates: [{ finishReason: 'PROHIBITED_CONTENT' }] }), 'PROHIBITED_CONTENT');
  assert.equal(geminiBlockReason({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'ok' }] } }] }), null);
  assert.equal(geminiBlockReason({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), null);
  assert.equal(geminiBlockReason({}), null);
});

test('openRouterRefusal recognises content_filter, native safety reasons and a refusal field', () => {
  assert.equal(openRouterRefusal({ choices: [{ finish_reason: 'content_filter' }] }), true);
  assert.equal(openRouterRefusal({ choices: [{ finish_reason: 'stop', native_finish_reason: 'IMAGE_SAFETY' }] }), true);
  assert.equal(openRouterRefusal({ choices: [{ message: { refusal: 'I cannot help with that' } }] }), true);
  assert.equal(openRouterRefusal({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] }), false);
  assert.equal(openRouterRefusal({}), false);
});

test('Gemini safety settings: sexual content at medium-and-above, nothing left at the model default', () => {
  const by = Object.fromEntries(GEMINI_SAFETY_SETTINGS.map((s) => [s.category, s.threshold]));
  assert.equal(by.HARM_CATEGORY_SEXUALLY_EXPLICIT, 'BLOCK_MEDIUM_AND_ABOVE');
  for (const c of ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_DANGEROUS_CONTENT']) assert.ok(by[c], c);
});

test('the safety rule is positive prose and is part of the script system prompt', () => {
  assert.ok(SYSTEM_PROMPT.includes(CONTENT_SAFETY_RULE));
  assert.match(CONTENT_SAFETY_RULE, /fully clothed/);
  assert.match(CONTENT_SAFETY_RULE, /non-sexual/);
  assert.match(CONTENT_SAFETY_RULE, /adult characters/);
  assert.ok(!/\b(no|avoid|without|never)\b/i.test(CONTENT_SAFETY_RULE.replace(/^CONTENT SAFETY[^:]*:/, '')), 'phrased as what to show, not as a list of negations');
});

test('both new message codes exist in English and Hebrew', () => {
  for (const code of [CODES.CONTENT_BLOCKED, CODES.CONTENT_REFUSED]) {
    for (const lang of ['en', 'he']) assert.ok(getMsg(code, lang).length > 20, `${code}/${lang}`);
  }
  assert.match(getMsg(CODES.CONTENT_REFUSED, 'he'), /[א-ת]/);
});
