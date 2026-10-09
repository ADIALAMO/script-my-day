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

scenario('T2', 'deletion request: masked in Telegram, full address kept in the 30-day Redis record',
  'masked text + pointer to the Redis key; deletion-request:<email>:<ts> holds the full email', async () => {
    providers.telegram.length = 0;
    const r = await invoke(deletion, { body: { email: 'private.person@example.org', note: 'please', lang: 'en' }, ip: '198.51.100.111' });
    assert.equal(r.status, 200);
    const t = providers.telegram[0];
    assert.ok(t.includes('p\\*\\*\\*@example.org'), t); assert.ok(!t.includes('private.person'), t);
    const keys = fake.keys('deletion-request:');
    assert.equal(keys.length, 1); assert.ok(keys[0].includes('private.person@example.org'));
    assert.ok(fake.ttl(keys[0]) > 29 * 86400 && fake.ttl(keys[0]) <= 30 * 86400);
    return { actual: `telegram: ${JSON.stringify(t)} ; redis key ${keys[0].replace(/@.*/, '@…')}` };
  });
