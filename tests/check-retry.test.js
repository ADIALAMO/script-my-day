import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRetryAfterMs, retryPauseMs, callWithRetry, sanitizeLogText, describeRateLimitBody, MAX_RETRY_AFTER_MS } from '../lib/check-retry.js';

test('parseRetryAfterMs: absent → null, seconds → ms, HTTP-date → ms from now, unreadable → Infinity (treated as "asked us to wait")', () => {
  for (const v of [null, undefined]) assert.equal(parseRetryAfterMs(v), null, String(v));
  // present but empty / unreadable (including strings V8's lenient Date.parse would read as a PAST date = "retry now") → Infinity = do not retry
  for (const v of ['', '   ', 'soon', '-1', 'foo 12', 'Tue 2', '1,5', '1e3', '0x10', '5 s', 'Wed, 21 Oct 2026']) assert.equal(parseRetryAfterMs(v), Infinity, JSON.stringify(v));
  assert.equal(parseRetryAfterMs('0'), 0); assert.equal(parseRetryAfterMs('1'), 1000); assert.equal(parseRetryAfterMs('1.5'), 1500); assert.equal(parseRetryAfterMs(' 3 '), 3000);
  const d = parseRetryAfterMs(new Date(Date.now() + 10_000).toUTCString()); assert.ok(d > 8000 && d <= 10_000, String(d));
  assert.equal(parseRetryAfterMs(new Date(Date.now() - 5000).toUTCString()), 0);
});

test('retryPauseMs: no Retry-After → 300-700 ms jitter; Retry-After <= 1.5 s → exactly that; above 1.5 s (or unreadable) → null = do NOT retry', () => {
  assert.equal(MAX_RETRY_AFTER_MS, 1500);
  assert.equal(retryPauseMs(null, () => 0), 300); assert.equal(retryPauseMs(undefined, () => 0.9999), 700);
  for (let i = 0; i < 200; i++) { const p = retryPauseMs(null); assert.ok(p >= 300 && p <= 700, String(p)); }
  assert.equal(retryPauseMs(0), 0); assert.equal(retryPauseMs(1000), 1000); assert.equal(retryPauseMs(1500), 1500);
  assert.equal(retryPauseMs(1501), null); assert.equal(retryPauseMs(3000), null); assert.equal(retryPauseMs(Infinity), null);
});

const T = (status, extra = {}) => ({ kind: 'technical', status, ...extra });
function harness(results) {
  const calls = []; const sleeps = []; let t = 0;
  const call = async (timeoutMs) => { calls.push(timeoutMs); t += 100; return results[Math.min(calls.length - 1, results.length - 1)]; };
  const opts = { sleep: async (ms) => { sleeps.push(ms); t += ms; }, random: () => 0, now: () => t };
  return { call, calls, sleeps, opts };
}

test('callWithRetry: 429 then success → ONE retry with the jitter, result of the second call', async () => {
  const h = harness([T(429, { retryAfterMs: null }), { kind: 'ok', data: 1 }]);
  const r = await callWithRetry(h.call, 8000, h.opts);
  assert.deepEqual(r, { kind: 'ok', data: 1 }); assert.equal(h.calls.length, 2); assert.deepEqual(h.sleeps, [300]);
  assert.ok(h.calls[1] < 8000 && h.calls[1] >= 2500, 'the retry gets what is left of the SAME budget');
});

test('callWithRetry: 429 twice → exactly two calls, the failure is returned (fail-closed as before)', async () => {
  const h = harness([T(429), T(429)]);
  const r = await callWithRetry(h.call, 8000, h.opts);
  assert.equal(r.kind, 'technical'); assert.equal(r.status, 429); assert.equal(h.calls.length, 2);
});

test('callWithRetry: Retry-After above 1.5 s (or unreadable) → NO retry, the first failure is returned; at or below → the retry waits exactly that', async () => {
  for (const ra of [1501, 3000, Infinity]) {
    const h = harness([T(429, { retryAfterMs: ra }), { kind: 'ok' }]);
    const r = await callWithRetry(h.call, 8000, h.opts);
    assert.equal(r.status, 429); assert.equal(h.calls.length, 1, `retry-after ${ra}`); assert.deepEqual(h.sleeps, []);
  }
  const h = harness([T(429, { retryAfterMs: 1200 }), { kind: 'ok' }]);
  assert.equal((await callWithRetry(h.call, 8000, h.opts)).kind, 'ok'); assert.deepEqual(h.sleeps, [1200]);
});

test('callWithRetry: no retry when too little of the budget is left, and never for any status other than 429 (402, 403, 408, 500, a verdict)', async () => {
  const tight = harness([T(429), { kind: 'ok' }]);
  assert.equal((await callWithRetry(tight.call, 2800, tight.opts)).status, 429); assert.equal(tight.calls.length, 1, '2800 - 100 - 300 < 2500');
  for (const status of [402, 403, 408, 500, 503, null]) {
    const h = harness([T(status), { kind: 'ok' }]);
    assert.equal((await callWithRetry(h.call, 8000, h.opts)).status, status); assert.equal(h.calls.length, 1, String(status));
  }
  const ok = harness([{ kind: 'verdict', verdict: 'safe' }]);
  assert.equal((await callWithRetry(ok.call, 8000, ok.opts)).verdict, 'safe'); assert.equal(ok.calls.length, 1);
});

test('sanitizeLogText / describeRateLimitBody: no URLs, e-mails, key ids, non-ASCII or long text', () => {
  const body = JSON.stringify({ error: { message: 'Provider returned error https://openrouter.ai/workspaces/default/keys/abcdef0123456789abcdef for me@example.com', code: 429,
    metadata: { provider_name: 'Google AI Studio', raw: '{"error":{"message":"Resource has been exhausted (e.g. check quota). שלום ' + 'x'.repeat(400) + '"}}' } } });
  const d = describeRateLimitBody(body);
  assert.equal(d.provider, 'Google AI Studio'); assert.equal(d.code, '429');
  const all = Object.values(d).join(' | ');
  assert.ok(!/https?:|@|abcdef0123|workspaces|שלום/.test(all), all);
  assert.equal(sanitizeLogText('projects/123456789012 said "hello"'), "projects/[num] said 'hello'"); assert.ok(d.raw.length <= 160 && d.message.length <= 120);
  assert.match(d.message, /\[url\]/); assert.match(d.message, /\[email\]/);
  assert.equal(describeRateLimitBody('<html>rate limited https://x.example/y</html>').raw, '<html>rate limited [url]');
  assert.equal(sanitizeLogText('a\nb\u0000c'), 'a b c');   // control characters become spaces
});
