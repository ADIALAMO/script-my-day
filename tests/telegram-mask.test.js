import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskEmail, escapeMarkdownV1 } from '../lib/telegram.js';

test('maskEmail keeps the first character and the domain', () => {
  assert.equal(maskEmail('adialamo@gmail.com'), 'a***@gmail.com');
  assert.equal(maskEmail('a@x.co.il'), 'a***@x.co.il');
  assert.equal(maskEmail('first.last+tag@sub.example.org'), 'f***@sub.example.org');
});
test('never leaks the local part; degenerate input becomes ***', () => {
  assert.ok(!maskEmail('secretname@gmail.com').includes('ecret'));
  for (const bad of ['', null, undefined, 'no-at-sign', '@gmail.com', 'user@']) assert.equal(maskEmail(bad), '***');
});
test('masked text survives Telegram Markdown escaping', () => {
  assert.equal(escapeMarkdownV1(maskEmail('a_b@x.com')), 'a\\*\\*\\*@x.com');
});
