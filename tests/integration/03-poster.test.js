/** Scenario C — standalone poster limits (Free 2/day, Pro 3/day, guest 1 lifetime) and free-provider cost. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '03-poster' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const poster = await ctx.route('generate-poster');
const call = (u, ip = '198.51.100.30') => invoke(poster, { body: { prompt: 'A lone figure walks into a neon-lit rainy street' }, cookies: u.cookies, ip });

scenario('C1', 'Free: 2 posters/day, 3rd → QUOTA_POSTER, zero provider calls; resets next UTC day',
  '200,200,429 QUOTA_POSTER; after midnight 200', async () => {
    const u = await makeUser('c1', 'free');
    assert.equal((await call(u)).status, 200); assert.equal((await call(u)).status, 200);
    const before = { ...providers.counts };
    const r = await call(u);
    assert.equal(r.status, 429); assert.equal(r.body.code, 'QUOTA_POSTER');
    assert.deepEqual(providers.counts, before);
    ctx.setNow('2026-10-16T00:00:01Z');
    assert.equal((await call(u)).status, 200);
    return { actual: `200,200,429 QUOTA_POSTER; reset next day; paid calls: ${providers.paidTotal()}`, evidence: `calls ${JSON.stringify(providers.counts)}` };
  });

scenario('C2', 'Pro: 3 posters/day, 4th → QUOTA_POSTER (paid and admin-granted Pro alike)',
  '200×3 then 429', async () => {
    for (const kind of ['paid', 'adminGranted']) {
      const u = await makeUser(`c2-${kind}`, kind);
      for (let i = 0; i < 3; i++) assert.equal((await call(u, `198.51.100.${kind === 'paid' ? 31 : 32}`)).status, 200, `${kind} #${i + 1}`);
      const r = await call(u, `198.51.100.${kind === 'paid' ? 31 : 32}`);
      assert.equal(r.status, 429, kind); assert.equal(r.body.code, 'QUOTA_POSTER');
    }
    return { actual: 'both Pro kinds: 3 allowed, 4th refused' };
  });

scenario('C3', 'a plain poster is served by the FREE provider first (Cloudflare) — zero paid calls',
  'cloudflare=1, klein/pollinations=0, paid total 0', async () => {
    const u = await makeUser('c3', 'free');
    const r = await call(u);
    assert.equal(r.status, 200); assert.equal(r.body.provider, 'Cloudflare-Flux');
    assert.equal(providers.paidTotal(), 0);
    return { actual: `provider ${r.body.provider}; paid calls 0` };
  });

scenario('C4', 'cascade fallback when Cloudflare fails: Klein (PAID) serves it and is counted toward the image budget counter',
  'klein=1, usage:image:paid:global=1', async () => {
    providers.mode.cloudflare = 500;
    const u = await makeUser('c4', 'free');
    const r = await call(u);
    assert.equal(r.status, 200); assert.equal(r.body.provider, 'OpenRouter-Klein');
    assert.equal(providers.counts.klein, 1);
    assert.equal(fake.num('usage:image:paid:global:2026-10-15'), 1);
    return { actual: 'Klein served it; paid image counter = 1' };
  });

scenario('C5', 'placeholder (all providers down) is not charged to the user quota',
  'success:true isPlaceholder:true, poster counter stays 0', async () => {
    providers.mode.cloudflare = 500; providers.mode.klein = 500; providers.mode.pollinations = 500;
    const u = await makeUser('c5', 'free');
    const r = await call(u);
    assert.equal(r.status, 200); assert.equal(r.body.isPlaceholder, true);
    assert.equal(fake.num(`usage:poster:${u.identifier}:2026-10-15`), 0);
    return { actual: `placeholder returned (code ${r.body.code}); quota counter 0` };
  });

scenario('C6', 'a non-whitelisted tier cannot be forged: x-dev-tier / body tier do not raise the poster limit',
  'Free still limited to 2 with forged hints', async () => {
    const u = await makeUser('c6', 'free');
    const hdr = { 'x-dev-tier': 'pro' };
    const c = () => invoke(poster, { body: { prompt: 'x', tier: 'admin' }, headers: hdr, cookies: u.cookies, ip: '198.51.100.33' });
    assert.equal((await c()).status, 200); assert.equal((await c()).status, 200);
    assert.equal((await c()).status, 429);
    return { actual: 'forged hints ignored; 3rd request 429' };
  });
