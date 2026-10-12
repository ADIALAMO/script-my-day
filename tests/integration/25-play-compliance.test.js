/** Scenario P — Play compliance: /api/og takes a referral code (no free text), blocked names are never shown, deletion requests record the session, Star Yourself is 18+. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '25-play-compliance' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const og = await ctx.route('og');
const deletion = await ctx.route('request-deletion');
const upload = await ctx.route('upload-character');
const { rememberReferrerName, lookupReferrer } = await import('../../lib/referral.js');
const { getMsg } = await import('../../lib/messages.js');

const card = async (qs, ip) => {
  const r = await og(new Request(`http://localhost:3000/api/og?${qs}`, { headers: { 'x-real-ip': ip } }));
  assert.equal(r.status, 200);
  return createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex');
};
const mintCode = (code, userId, name) => { fake.set(`referral:code:${code}`, userId); if (name !== undefined) fake.set(`referral:name:${userId}`, name); };
const BLATANT = 'nude';   // one unambiguous probe (the list itself is lib/content-blocklist.js)

scenario('P1', '/api/og: the name comes from the referral CODE, server-side — the card for a code with a name differs from the generic card; ?name= from the URL is ignored',
  'hash(code→Dana) ≠ hash(generic); hash(?name=Dana) = hash(generic); hash(code→Dana) = hash(code→Dana again)', async () => {
    mintCode('abc123', 'u-dana', 'Dana');
    const generic = await card('lang=en', '203.0.113.90');
    const named = await card('code=abc123&lang=en', '203.0.113.91');
    const spoof = await card('name=Dana&lang=en', '203.0.113.92');
    const unknown = await card('code=nosuchcode&lang=en', '203.0.113.93');
    const malformed = await card(`code=${encodeURIComponent('../../x<script>')}&lang=en`, '203.0.113.94');
    assert.notEqual(named, generic, 'the looked-up name is on the card');
    assert.equal(spoof, generic, 'a name in the URL changes nothing');
    assert.equal(unknown, generic); assert.equal(malformed, generic);
    return { actual: 'name only via code; query-string text ignored' };
  });

scenario('P2', 'a blocklisted display name is never stored (and a stored one is cleared); a name stored BEFORE the blocklist is screened on read — the invite and the card fall back to the generic greeting',
  'rememberReferrerName(blocked) stores nothing; lookupReferrer(legacy blocked) → name ""; clean names pass', async () => {
    await rememberReferrerName('u-ok', 'Dana Cohen');
    assert.equal(fake.get('referral:name:u-ok'), 'Dana');
    fake.set('referral:name:u-bad', 'Previous');
    await rememberReferrerName('u-bad', `${BLATANT} guy`);
    assert.equal(fake.get('referral:name:u-bad'), null, 'blocked name cleared, nothing stored');
    assert.equal(fake.get('referral:name:u-new'), null);
    await rememberReferrerName('u-new', `${BLATANT} lady`);
    assert.equal(fake.get('referral:name:u-new'), null);
    mintCode('legacy1', 'u-legacy', `${BLATANT} boy`); // stored before the blocklist
    mintCode('clean1', 'u-ok');
    assert.equal((await lookupReferrer('legacy1')).name, '');
    assert.equal((await lookupReferrer('clean1')).name, 'Dana');
    const generic = await card('lang=en', '203.0.113.95');
    assert.equal(await card('code=legacy1&lang=en', '203.0.113.96'), generic, 'blocked legacy name → generic card');
    await rememberReferrerName('u-ctrl', '<b>Bob</b>\u0000x');
    assert.equal(fake.get('referral:name:u-ctrl'), 'bBob/bx', 'control characters and angle brackets removed');
    return { actual: 'blocked names never displayed' };
  });

scenario('P3', 'deletion request records the session user id; a session whose e-mail matches is flagged verified, a mismatching one is flagged for manual verification, a guest is not signed in',
  'userId + sessionEmailMatches in the audit record; Telegram line tells the owner what to verify', async () => {
    const u = await makeUser('p3', 'free');
    const post = (cookies, email, ip) => invoke(deletion, { body: { email, note: '', lang: 'en' }, cookies, ip });
    const ok = await post(u.cookies, u.email, '198.51.100.101'); assert.equal(ok.status, 200);
    const mismatch = await post(u.cookies, 'someone.else@test.example', '198.51.100.102'); assert.equal(mismatch.status, 200);
    const guest = await post({}, 'guest@test.example', '198.51.100.103'); assert.equal(guest.status, 200);
    const rec = (email) => { const k = fake.keys(`deletion-request:${email}:`)[0]; return JSON.parse(fake.get(k)); };
    assert.deepEqual([rec(u.email).userId, rec(u.email).sessionEmailMatches], [u.id, true]);
    assert.deepEqual([rec('someone.else@test.example').userId, rec('someone.else@test.example').sessionEmailMatches], [u.id, false]);
    assert.deepEqual([rec('guest@test.example').userId, rec('guest@test.example').sessionEmailMatches], [null, false]);
    const t = providers.telegram.filter((x) => x.includes('deletion request'));
    assert.equal(t.length, 3);
    assert.match(t[0], /e-mail matches the session \(verified\)/);
    assert.match(t[1], /does NOT match the session: verify before deleting/);
    assert.match(t[2], /Not signed in — verify with the address before deleting/);
    assert.ok(!t.join('\n').includes(u.email), 'the full address is never in Telegram (masked)');
    return { actual: 'verified / mismatch / guest all recorded distinctly' };
  });

scenario('P4', 'Star Yourself is 18+: an upload without the adult confirmation is refused (400 ADULT_REQUIRED) with zero provider calls and nothing stored or charged; with it, the upload works',
  '400 ADULT_REQUIRED; moderation=0; sheet quota 0; then 200', async () => {
    const u = await makeUser('p4', 'free');
    const none = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: u.cookies, ip: '198.51.100.110' });
    const falsy = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: 'true' }, cookies: u.cookies, ip: '198.51.100.110' });   // a string is not the boolean
    for (const r of [none, falsy]) { assert.equal(r.status, 400); assert.equal(r.body.code, 'ADULT_REQUIRED'); }
    assert.deepEqual(providers.counts, {}); assert.equal(providers.s3puts.length, 0);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0);
    assert.match(getMsg('ADULT_REQUIRED', 'en'), /18 and over/); assert.match(getMsg('ADULT_REQUIRED', 'he'), /18/);
    const ok = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.110' });
    assert.equal(ok.status, 200);
    return { actual: 'refused without adult:true, accepted with it' };
  });
