/** Scenario I — NextAuth e-mail sign-in (magic link) rate limits, enumeration safety, and that the link still works. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '08-magic-link' });
after(() => ctx.afterAll());
const { scenario, invoke, mails, fake } = ctx;
const nextauth = await ctx.route('auth/[...nextauth]');
const authLib = await import('../../lib/auth.js');
const { isEmailSignin, normalizeEmailForLimit } = await import('../../lib/auth-email-limit.js');

/** fetch a CSRF token + cookie the way next-auth/react does */
async function csrf(ip) {
  const r = await invoke(nextauth, { method: 'GET', url: '/api/auth/csrf', query: { nextauth: ['csrf'] }, ip });
  const raw = [].concat(r.headers['set-cookie'] || []).find((c) => c.startsWith('next-auth.csrf-token='));
  return { token: r.body.csrfToken, cookie: decodeURIComponent(raw.split(';')[0].split('=').slice(1).join('=')) };
}
/** POST /api/auth/signin/email exactly as signIn('email', {redirect:false}) does */
async function requestLink(email, ip) {
  const { token, cookie } = await csrf(ip);
  return invoke(nextauth, {
    method: 'POST', url: '/api/auth/signin/email', query: { nextauth: ['signin', 'email'] }, ip,
    cookies: { 'next-auth.csrf-token': cookie }, headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: { email, csrfToken: token, callbackUrl: 'http://localhost:3000/', json: 'true' },
  });
}
const shape = (r) => ({ status: r.status, body: r.body });

scenario('I1', 'same address: 5 sign-in e-mails per hour, the 6th is blocked (429, no e-mail sent); case/+tag/",domain" variants count as the SAME address',
  '5 mails sent, 6th/7th/8th (variants) → 429 RATE_LIMITED with a url, mails stay 5; allowed again after the hour', async () => {
    const email = 'target.one@test.example';
    for (let i = 1; i <= 5; i++) { const r = await requestLink(email, `203.0.113.${100 + i}`); assert.equal(r.status, 200, `request ${i}`); }
    assert.equal(mails.length, 5);
    for (const variant of ['target.one@test.example', 'TARGET.ONE@Test.Example', 'target.one+spam@test.example']) {
      const r = await requestLink(variant, '203.0.113.120');
      assert.equal(r.status, 429, variant); assert.equal(r.body.code, 'RATE_LIMITED');
      assert.match(r.body.url, /\/api\/auth\/signin\?error=RateLimited$/);
    }
    assert.equal(mails.length, 5, 'no further e-mail was sent');
    ctx.advance(2 * 3600_000);
    assert.equal((await requestLink(email, '203.0.113.121')).status, 200);
    return { actual: '5 sent; 6th + 3 variants → 429 RATE_LIMITED; mails=5; allowed again 2h later' };
  });

scenario('I2', 'same IP: 10 sign-in e-mails per hour across different addresses, the 11th is blocked; a different IP is unaffected',
  '10×200 (10 mails), 11th 429, other IP 200', async () => {
    const ip = '203.0.113.150';
    for (let i = 1; i <= 10; i++) { const r = await requestLink(`ip-user-${i}@test.example`, ip); assert.equal(r.status, 200, `request ${i}`); }
    assert.equal(mails.length, 10);
    const r11 = await requestLink('ip-user-11@test.example', ip);
    assert.equal(r11.status, 429); assert.equal(r11.body.code, 'RATE_LIMITED');
    assert.equal(mails.length, 10);
    assert.equal((await requestLink('someone-else@test.example', '203.0.113.151')).status, 200);
    return { actual: '10 allowed, 11th 429; another IP 200; mails=11 total (10 + 1 other IP)' };
  });

scenario('I3', 'no account enumeration: an existing and a non-existing address get an indistinguishable response (status + body), also when rate limited',
  'identical {status, body} for both, in the normal and in the blocked state', async () => {
    await authLib.authOptions.adapter.createUser({ email: 'exists@test.example', emailVerified: null });
    assert.ok(await authLib.authOptions.adapter.getUserByEmail('exists@test.example'), 'fixture: the account exists');
    assert.equal(await authLib.authOptions.adapter.getUserByEmail('ghost@test.example'), null, 'fixture: this one does not');
    const a = await requestLink('exists@test.example', '203.0.113.160');
    const b = await requestLink('ghost@test.example', '203.0.113.161');
    assert.deepEqual(shape(a), shape(b));
    assert.equal(a.status, 200);
    // block both (5 more requests each), then compare the refusal
    for (let i = 0; i < 4; i++) { await requestLink('exists@test.example', `203.0.113.${162 + i}`); await requestLink('ghost@test.example', `203.0.113.${170 + i}`); }
    const a6 = await requestLink('exists@test.example', '203.0.113.180');
    const b6 = await requestLink('ghost@test.example', '203.0.113.181');
    assert.equal(a6.status, 429);
    assert.deepEqual(shape(a6), shape(b6));
    return { actual: `normal: ${JSON.stringify(shape(a).body)} for both; blocked: ${a6.status} ${JSON.stringify(a6.body.code)} for both` };
  });

scenario('I4', 'the e-mail link works end to end locally (token in the mail → callback → session), and the callback is NOT rate limited',
  'link extracted from the recorded mail → 302 + session cookie → /api/me authenticated', async () => {
    const ip = '203.0.113.190';
    // exhaust the IP limit first: the click must still work
    for (let i = 0; i < 10; i++) await requestLink(`click-${i}@test.example`, ip);
    assert.equal((await requestLink('click-x@test.example', ip)).status, 429);
    const mail = mails.find((m) => m.to === 'click-3@test.example');
    const link = /https?:\/\/[^\s"<]+callback\/email[^\s"<]*/.exec(mail.text || mail.html)[0].replace(/&amp;/g, '&');
    const u = new URL(link);
    const cb = await invoke(nextauth, { method: 'GET', url: u.pathname, query: { nextauth: ['callback', 'email'], ...Object.fromEntries(u.searchParams) }, ip });
    assert.ok([302, 200].includes(cb.status), `callback status ${cb.status}`);
    const setCookie = [].concat(cb.headers['set-cookie'] || []).find((c) => c.startsWith('next-auth.session-token='));
    assert.ok(setCookie, 'a session cookie is issued');
    const me = await ctx.route('me');
    const session = decodeURIComponent(setCookie.split(';')[0].split('=').slice(1).join('='));
    const r = await invoke(me, { method: 'GET', cookies: { 'next-auth.session-token': session } });
    assert.equal(r.body.authenticated, true); assert.equal(r.body.email, 'click-3@test.example');
    return { actual: `callback ${cb.status}, session issued, /api/me authenticated as ${r.body.email}; mail subject "${mail.subject}"` };
  });

scenario('I5', 'other auth endpoints and Google are not touched by the e-mail limits',
  'providers/csrf/session stay 200 (30 calls) after e-mail limits are exhausted; signin/google is not routed to the e-mail limiter', async () => {
    const ip = '203.0.113.200';
    for (let i = 0; i < 11; i++) await requestLink(`g-${i}@test.example`, ip);
    const rlKeysBefore = fake.keys('rl:auth-email').length;
    for (let i = 0; i < 30; i++) {
      for (const action of ['providers', 'csrf', 'session']) {
        const r = await invoke(nextauth, { method: 'GET', url: `/api/auth/${action}`, query: { nextauth: [action] }, ip });
        assert.equal(r.status, 200, `${action} #${i}`);
        if (action === 'providers') assert.ok(r.body.google && r.body.email, 'google + email providers listed');
      }
    }
    assert.equal(fake.keys('rl:auth-email').length, rlKeysBefore, 'no e-mail limiter state created by non-e-mail routes');
    assert.equal(isEmailSignin({ method: 'POST', query: { nextauth: ['signin', 'google'] } }), false);
    assert.equal(isEmailSignin({ method: 'GET', query: { nextauth: ['callback', 'google'] } }), false);
    assert.equal(normalizeEmailForLimit(undefined), null);
    return { actual: '90 GETs on providers/csrf/session = 200; google routes bypass the limiter; real Google OAuth round-trip cannot be exercised offline (see manual checklist)' };
  });

scenario('I6', 'a request without an e-mail or with a bad CSRF token costs no mail and does not crash the wrapper',
  'no mail sent', async () => {
    const r = await invoke(nextauth, { method: 'POST', url: '/api/auth/signin/email', query: { nextauth: ['signin', 'email'] }, ip: '203.0.113.210', body: { csrfToken: 'bad', json: 'true' } });
    assert.ok(r.status >= 200 && r.status < 500);
    assert.equal(mails.length, 0);
    return { actual: `status ${r.status}, mails 0` };
  });
