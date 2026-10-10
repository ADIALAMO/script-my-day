/**
 * Proves the HARNESS itself before it is trusted: the fake Redis is atomic and honours TTLs, the
 * network guard really blocks, the hermetic env is fake, and every provider/sender is mocked.
 */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '00-infra' });
after(() => ctx.afterAll());
const { fake, providers } = ctx;

test('environment is hermetic: only fake values from tests/integration/test.env', () => {
  assert.equal(process.env.NEXTAUTH_SECRET.includes('not-real'), true);
  assert.equal(process.env.OPENROUTER_API_KEY, 'fake-openrouter-key');
  assert.equal(process.env.VERCEL_TOKEN, undefined);
  assert.match(process.env.UPSTASH_REDIS_REST_URL, /^http:\/\/127\.0\.0\.1:\d+$/);
});

test('fake Redis through the REAL @upstash/redis client: INCR is atomic under 500 concurrent clients', async () => {
  const redis = (await import('../../lib/redis.js')).default;
  await Promise.all(Array.from({ length: 500 }, () => redis.incr('storm')));
  assert.equal(fake.num('storm'), 500);
  // concurrent INCR returns each integer exactly once (no lost update, no duplicate)
  const seen = await Promise.all(Array.from({ length: 200 }, () => redis.incr('uniq')));
  assert.equal(new Set(seen).size, 200);
  assert.equal(Math.max(...seen), 200);
});

test('fake Redis: pipelines, SET NX/EX, TTL and expiry follow the mocked clock; DECR/GETDEL/MGET behave', async () => {
  const redis = (await import('../../lib/redis.js')).default;
  assert.equal(await redis.set('k1', 'v', { nx: true, ex: 60 }), 'OK');
  assert.equal(await redis.set('k1', 'other', { nx: true, ex: 60 }), null);   // NX loses
  assert.equal(await redis.get('k1'), 'v');
  assert.ok((await redis.ttl('k1')) <= 60);
  const out = await redis.pipeline().incr('p').incr('p').decr('p').exec();
  assert.deepEqual(out, [1, 2, 1]);
  ctx.advance(61_000);
  assert.equal(await redis.get('k1'), null);                                  // expired by the fake clock
  await redis.set('g', 'x'); assert.equal(await redis.getdel('g'), 'x'); assert.equal(await redis.get('g'), null);
  assert.deepEqual(await redis.mget('p', 'missing'), [1, null]);
});

test('sliding-window rate limiter (real @upstash/ratelimit → fake Lua emulation) allows N then blocks', async () => {
  const { Ratelimit } = await import('@upstash/ratelimit');
  const { Redis } = await import('@upstash/redis');
  const rl = new Ratelimit({ redis: new Redis({ url: process.env.UPSTASH_REDIS_REST_URL, token: 'x' }), limiter: Ratelimit.slidingWindow(5, '60 s'), prefix: 'rl:selftest' });
  const results = [];
  for (let i = 0; i < 8; i++) results.push((await rl.limit('same')).success);
  assert.deepEqual(results, [true, true, true, true, true, false, false, false]);
  ctx.advance(125_000);                                                       // two windows later → free again
  assert.equal((await rl.limit('same')).success, true);
});

test('network guard: a real outbound connection (socket) is blocked and recorded; localhost still works', async () => {
  assert.throws(() => net.connect({ host: 'example.com', port: 80 }), /NETWORK GUARD/);
  assert.ok(ctx.violations.some((v) => v.includes('example.com')));
  ctx.violations.length = 0;                                                  // the deliberate probe must not fail the run
});

test('network guard: fetch to an unknown host throws and is recorded; known providers are served locally and counted', async () => {
  await assert.rejects(fetch('https://evil.example/steal'), /NETWORK GUARD/);
  assert.ok(ctx.violations.some((v) => v.includes('evil.example')));
  ctx.violations.length = 0; providers.unexpected.length = 0;
  const r = await fetch('https://api.cloudflare.com/client/v4/accounts/x/ai/run/@cf/black-forest-labs/flux-1-schnell', { method: 'POST', body: '{}' });
  assert.equal(r.status, 200);
  assert.equal(providers.counts.cloudflare, 1);
  providers.reset();
});

test('email and R2 senders are recorders, not real senders', async () => {
  const nodemailer = (await import('nodemailer')).default;
  const t = nodemailer.createTransport({ host: 'smtp.test.invalid' });
  await t.sendMail({ to: 'a@b.c', subject: 's' });
  assert.equal(ctx.mails.length, 1);
  const { putImage } = await import('../../lib/blob-store.js');
  const url = await putImage('characters/x.jpg', Buffer.from('abc'), 'image/jpeg');
  assert.equal(url, 'https://pub-test.r2.dev/characters/x.jpg');
  assert.equal(providers.s3puts.length, 1);
  providers.reset(); ctx.mails.length = 0;
});

test('a real route handler runs in-process (module hooks + sessions work): anonymous /api/me', async () => {
  const me = await ctx.route('me');
  const r = await ctx.invoke(me, { method: 'GET' });
  assert.equal(r.status, 200);
  assert.equal(r.body.authenticated, false);
  assert.equal(r.body.tier, 'anonymous');
  const u = await ctx.makeUser('probe', 'free');
  const r2 = await ctx.invoke(me, { method: 'GET', cookies: u.cookies });
  assert.equal(r2.body.authenticated, true);
  assert.equal(r2.body.tier, 'free');
});
