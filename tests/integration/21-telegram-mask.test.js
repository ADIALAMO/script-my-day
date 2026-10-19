/** Telegram alerts for waitlist / deletion requests carry a MASKED address; Redis keeps the full one. NODE_ENV=production: Telegram only fires there. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '21-telegram-mask', nodeEnv: 'production' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, fake } = ctx;
const waitlist = await ctx.route('waitlist');
const deletion = await ctx.route('request-deletion');

scenario('T1', 'waitlist signup: Telegram text has a***@gmail.com, never the full address; the Redis record keeps the full address',
  'telegram contains the masked form only; waitlist:<email> exists', async () => {
    const r = await invoke(waitlist, { body: { email: 'adialamo@gmail.com', lang: 'he' }, ip: '198.51.100.110' });
    assert.equal(r.status, 200);
    assert.equal(providers.telegram.length, 1);
    const t = providers.telegram[0];
    assert.ok(t.includes('a\\*\\*\\*@gmail.com'), t); assert.ok(!t.includes('adialamo'), t);
    assert.ok(fake.get('waitlist:adialamo@gmail.com') !== null, 'full address kept in Redis');
    return { actual: `telegram: ${JSON.stringify(t)}` };
  });

scenario('T2', 'deletion request: masked in Telegram, full address kept in the 45-day Redis record',
  'masked text + pointer to the Redis key; deletion-request:<email>:<ts> holds the full email', async () => {
    providers.telegram.length = 0;
    const r = await invoke(deletion, { body: { email: 'private.person@example.org', note: 'please', lang: 'en' }, ip: '198.51.100.111' });
    assert.equal(r.status, 200);
    const t = providers.telegram[0];
    assert.ok(t.includes('p\\*\\*\\*@example.org'), t); assert.ok(!t.includes('private.person'), t);
    const keys = fake.keys('deletion-request:');
    assert.equal(keys.length, 1); assert.ok(keys[0].includes('private.person@example.org'));
    assert.ok(fake.ttl(keys[0]) > 44 * 86400 && fake.ttl(keys[0]) <= 45 * 86400);
    return { actual: `telegram: ${JSON.stringify(t)} ; redis key ${keys[0].replace(/@.*/, '@…')}` };
  });

const { makeUser } = ctx;
const rec = (email) => JSON.parse(fake.get(`waitlist:${email}`));

scenario('T3', 'waitlist (real Upstash client + real session): a signed-in signup stores the v1 record with the server-resolved userId; a guest stores null; the client cannot set userId/source',
  'record = {v:1,email,createdAt ISO,locale,source:"pro-modal",userId,consentVersion}', async () => {
    const u = await makeUser('t3', 'free');
    let r = await invoke(waitlist, { body: { email: 'Signed.In@Example.com', lang: 'he', userId: 'u:attacker', source: 'evil' }, cookies: u.cookies, ip: '198.51.100.120' });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { success: true });
    const a = rec('signed.in@example.com');
    assert.equal(a.v, 1); assert.equal(a.email, 'signed.in@example.com'); assert.equal(a.locale, 'he'); assert.equal(a.source, 'pro-modal'); assert.equal(a.consentVersion, 1);
    assert.equal(a.userId, u.id); assert.equal(new Date(a.createdAt).toISOString(), a.createdAt);
    r = await invoke(waitlist, { body: { email: 'guest@example.com', lang: 'en' }, ip: '198.51.100.121' });
    assert.equal(rec('guest@example.com').userId, null);
    return { actual: `signed-in userId stored, guest null; createdAt ${a.createdAt}` };
  });

scenario('T4', 'waitlist: a duplicate keeps the FIRST record, answers exactly like a new signup, and sends no second alert',
  'same body, record unchanged, one Telegram message', async () => {
    providers.telegram.length = 0;
    const first = await invoke(waitlist, { body: { email: 'dup@example.com', lang: 'he' }, ip: '198.51.100.122' });
    const raw = fake.get('waitlist:dup@example.com');
    const second = await invoke(waitlist, { body: { email: 'DUP@example.com', lang: 'en' }, ip: '198.51.100.123' });
    assert.deepEqual(second.body, first.body); assert.equal(second.status, first.status);
    assert.equal(fake.get('waitlist:dup@example.com'), raw); assert.equal(providers.telegram.length, 1);
    return { actual: 'identical answer; first record kept; 1 alert' };
  });

scenario('T5', 'waitlist honeypot: silent success, nothing stored, no alert',
  '200 {success:true}; no waitlist key; no Telegram', async () => {
    providers.telegram.length = 0;
    const r = await invoke(waitlist, { body: { email: 'bot@example.com', lang: 'en', zq_ref7x: 'spam' }, ip: '198.51.100.124' });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { success: true });
    assert.equal(fake.get('waitlist:bot@example.com'), null); assert.equal(providers.telegram.length, 0);
    return { actual: 'silent success, nothing stored' };
  });

scenario('T6', 'waitlist with Redis SET failing: retryable 503 (never a fake success), no alert, and the address appears in no console line',
  '503 TEMPORARILY_UNAVAILABLE retryable; no key; nothing logged with the address', async () => {
    providers.telegram.length = 0;
    const lines = []; const o = { w: console.warn, e: console.error }; console.warn = console.error = (...a) => lines.push(a.map(String).join(' '));
    fake.control.failCommands.add('SET');
    let r;
    try { r = await invoke(waitlist, { body: { email: 'outage.person@example.com', lang: 'en' }, ip: '198.51.100.125' }); }
    finally { fake.control.failCommands.delete('SET'); console.warn = o.w; console.error = o.e; }
    assert.equal(r.status, 503); assert.deepEqual(r.body, { code: 'TEMPORARILY_UNAVAILABLE', retryable: true });
    assert.equal(fake.get('waitlist:outage.person@example.com'), null); assert.equal(providers.telegram.length, 0);
    assert.ok(!lines.join('\n').includes('outage.person'), 'address leaked into a log line');
    const retry = await invoke(waitlist, { body: { email: 'outage.person@example.com', lang: 'en' }, ip: '198.51.100.125' });
    assert.equal(retry.status, 200); assert.ok(fake.get('waitlist:outage.person@example.com') !== null);
    return { actual: '503 retryable; retry after recovery stored the record' };
  });
