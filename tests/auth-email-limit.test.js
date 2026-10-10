import { test } from 'node:test';
import assert from 'node:assert/strict';

delete process.env.UPSTASH_REDIS_REST_URL; // force the in-process fallback limiter
delete process.env.UPSTASH_REDIS_REST_TOKEN;
process.env.NEXTAUTH_URL = 'https://example.test';

const { isEmailSignin, normalizeEmailForLimit, limitMagicLink } = await import('../lib/auth-email-limit.js');
const { AUTH_EMAIL_LIMITS } = await import('../config/limits.js');

function fakeRes() {
  return { statusCode: 200, body: null, headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; } };
}
const reqFor = (email, ip) => ({
  method: 'POST', query: { nextauth: ['signin', 'email'] },
  headers: { 'x-real-ip': ip }, body: { email },
});

test('defaults: 5 per address per hour, 10 per IP per hour', () => {
  assert.equal(AUTH_EMAIL_LIMITS.perEmailPerHour, 5);
  assert.equal(AUTH_EMAIL_LIMITS.perIpPerHour, 10);
});

test('only POST /api/auth/signin/email is matched', () => {
  assert.equal(isEmailSignin({ method: 'POST', query: { nextauth: ['signin', 'email'] } }), true);
  assert.equal(isEmailSignin({ method: 'GET',  query: { nextauth: ['signin', 'email'] } }), false);
  assert.equal(isEmailSignin({ method: 'POST', query: { nextauth: ['callback', 'email'] } }), false);
  assert.equal(isEmailSignin({ method: 'POST', query: { nextauth: ['signin', 'google'] } }), false);
  assert.equal(isEmailSignin({ method: 'POST', query: {} }), false);
});

test('address normalisation: case, spaces, +tag, ",domain" tricks collapse to one key', () => {
  const n = normalizeEmailForLimit;
  assert.equal(n(' Victim+spam1@Example.COM '), 'victim@example.com');
  assert.equal(n('victim+x@example.com,evil@attacker.test'), 'victim@example.com');
  assert.equal(n('nope'), null);
  assert.equal(n(undefined), null);
});

test('per address: the 6th request within the hour is refused (even from different IPs); same answer for any address', async () => {
  const email = 'target@example.com';
  for (let i = 0; i < 5; i++) {
    const res = fakeRes();
    assert.equal(await limitMagicLink(reqFor(email, `1.1.1.${i}`), res), false, `#${i + 1}`);
  }
  const res = fakeRes();
  assert.equal(await limitMagicLink(reqFor('Target+again@example.com', '1.1.1.99'), res), true);
  assert.equal(res.statusCode, 429);
  assert.equal(res.body.code, 'RATE_LIMITED');
  assert.match(res.body.url, /^https:\/\/example\.test\/api\/auth\/signin\?error=RateLimited$/); // next-auth/react parses this
  // a different, never-seen address is unaffected and gets the same (allowed) treatment
  assert.equal(await limitMagicLink(reqFor('someone-else@example.com', '2.2.2.2'), fakeRes()), false);
});

test('per IP: the 11th request within the hour is refused, whatever the addresses', async () => {
  for (let i = 0; i < 10; i++) {
    assert.equal(await limitMagicLink(reqFor(`user${i}@example.com`, '9.9.9.9'), fakeRes()), false, `#${i + 1}`);
  }
  const res = fakeRes();
  assert.equal(await limitMagicLink(reqFor('user99@example.com', '9.9.9.9'), res), true);
  assert.equal(res.statusCode, 429);
  assert.ok(res.headers['Retry-After']);
});
