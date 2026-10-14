/** Scenario E — the signal the client uses to tell "no character on the server" from "server could not read Redis" (utils/character-store.js restore). Test only; the route is unchanged. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '35-character-expired-signal' });
after(() => ctx.afterAll());
const { scenario, invoke, makeUser, fake } = ctx;
const character = await ctx.route('character');
const get = (u) => invoke(character, { method: 'GET', cookies: u.cookies, ip: '198.51.102.1' });

scenario('E1', 'pointer expired → GET answers characterImageUrl:null WITH a boolean adultConfirmed (a positive "none"); Redis unreadable → null WITHOUT it (the client must not clear)',
  'expired: null + boolean; outage: null + no boolean; valid: url', async () => {
    const u = await makeUser('e1', 'free');
    const valid = await get(u); assert.equal(valid.body.characterImageUrl, ctx.FACE_URL);
    fake.del?.(`character:${u.identifier}`);
    if (!fake.del) { const { default: r } = await import('../../lib/redis.js'); await r.del(`character:${u.identifier}`); }   // the pointer "expired"
    const expired = await get(u);
    assert.equal(expired.status, 200); assert.equal(expired.body.characterImageUrl, null); assert.equal(typeof expired.body.adultConfirmed, 'boolean');
    ctx.seedCharacter(u.identifier);
    const oe = console.warn; console.warn = () => {};
    try {
      fake.control.failCommands.add('GET');
      const down = await get(u);
      assert.equal(down.status, 200); assert.equal(down.body.characterImageUrl, null); assert.notEqual(typeof down.body.adultConfirmed, 'boolean');
    } finally { console.warn = oe; fake.control.failCommands.clear(); }
  });
