import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem;
// memory stub additions used by the plan module
mem.sadd = async (k, m) => { const s = new Set(JSON.parse(mem._store.get(k) || '[]')); s.add(m); mem._store.set(k, JSON.stringify([...s])); return 1; };
mem.srem = async (k, m) => { const s = new Set(JSON.parse(mem._store.get(k) || '[]')); s.delete(m); mem._store.set(k, JSON.stringify([...s])); return 1; };
const members = () => JSON.parse(mem._store.get('stats:pro:members') || '[]');

process.env.PRO_ALLOWLIST = 'vip@example.com, Other@Example.com';
// Dummy, obviously fake values: only used to SIGN a test payload for our own handler.
process.env.STRIPE_SECRET_KEY = 'sk_test_dummy_not_a_real_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_dummy_for_tests';

const plan = await import('../lib/plan.js');
const { default: Stripe } = await import('stripe');
const { default: webhook } = await import('../pages/api/stripe/webhook.js');

beforeEach(() => mem._store.clear());
const tierOf = (id) => mem._store.get(`user:tier:${id}`) ?? null;
const sourceOf = (id) => { const r = mem._store.get(`user:tier_source:${id}`); return r ? JSON.parse(r).source : null; };

// ── resolvePlan: one function, with the reason ─────────────────────────────────────────
test('resolvePlan: free by default; pro/admin by stored tier, with who granted it', async () => {
  assert.deepEqual(await plan.resolvePlan({ userId: 'a', email: 'x@y.z' }), { tier: 'free', plan: 'free', isPro: false, grantedBy: null });
  await plan.grantPaidPro('p', 'cus_1');
  assert.deepEqual(await plan.resolvePlan({ userId: 'p' }), { tier: 'pro', plan: 'pro', isPro: true, grantedBy: 'payment' });
  await plan.setTierByAdmin('g', 'pro', 'boss@x.y');
  assert.equal((await plan.resolvePlan({ userId: 'g' })).grantedBy, 'admin');
  await plan.setTierByAdmin('r', 'admin', 'boss@x.y');
  assert.deepEqual(await plan.resolvePlan({ userId: 'r' }), { tier: 'admin', plan: 'pro', isPro: true, grantedBy: 'admin' });
  mem._store.set('user:tier:legacy', 'pro'); // predates source tracking
  assert.equal((await plan.resolvePlan({ userId: 'legacy' })).grantedBy, 'unknown');
});

test('resolvePlan: PRO_ALLOWLIST lifts free → pro (case-insensitive) but never downgrades admin/pro', async () => {
  assert.deepEqual(await plan.resolvePlan({ userId: 'v', email: 'VIP@Example.com' }), { tier: 'pro', plan: 'pro', isPro: true, grantedBy: 'allowlist' });
  await plan.setTierByAdmin('adm', 'admin', 'x');
  assert.equal((await plan.resolvePlan({ userId: 'adm', email: 'vip@example.com' })).tier, 'admin');
  await plan.grantPaidPro('pp', 'cus');
  assert.equal((await plan.resolvePlan({ userId: 'pp', email: 'vip@example.com' })).grantedBy, 'payment');
});

test('resolvePlan: Redis down → free (never throws), allowlist still applies', async () => {
  const orig = mem.mget; mem.mget = async () => { throw new Error('down'); };
  try {
    assert.equal((await plan.resolvePlan({ userId: 'a', email: 'n@n.n' })).tier, 'free');
    assert.equal((await plan.resolvePlan({ userId: 'a', email: 'vip@example.com' })).tier, 'pro');
  } finally { mem.mget = orig; }
});

// ── payment rules ───────────────────────────────────────────────────────────────────────
test('a payment NEVER overwrites admin with pro', async () => {
  await plan.setTierByAdmin('adm', 'admin', 'x');
  const r = await plan.grantPaidPro('adm', 'cus_9');
  assert.equal(r.changed, false);
  assert.equal(tierOf('adm'), 'admin');
  assert.equal(sourceOf('adm'), 'admin');
  assert.equal(mem._store.get('user:stripe_customer:adm'), 'cus_9'); // portal still works
});

test('a payment on admin-granted Pro keeps the admin source (so a later cancel cannot revoke it)', async () => {
  await plan.setTierByAdmin('g', 'pro', 'boss');
  assert.equal((await plan.grantPaidPro('g', 'cus_2')).reason, 'admin-granted-kept');
  assert.equal(sourceOf('g'), 'admin');
});

test('a cancellation NEVER revokes admin or admin-granted Pro; it DOES revoke paid Pro', async () => {
  await plan.setTierByAdmin('adm', 'admin', 'x');
  await plan.setTierByAdmin('g', 'pro', 'boss');
  await plan.grantPaidPro('paid', 'cus_3');
  assert.equal((await plan.revokePaidPro('adm')).changed, false);
  assert.equal((await plan.revokePaidPro('g')).changed, false);
  assert.equal(tierOf('adm'), 'admin');
  assert.equal(tierOf('g'), 'pro');
  const r = await plan.revokePaidPro('paid');
  assert.equal(r.changed, true);
  assert.equal(tierOf('paid'), null);
  assert.equal(sourceOf('paid'), null);
  assert.ok(!members().includes('paid'));
});

test('legacy Pro without a recorded source: revoked only if a payment customer is on record', async () => {
  mem._store.set('user:tier:l1', 'pro');
  assert.equal((await plan.revokePaidPro('l1')).reason, 'unknown-origin-kept');
  assert.equal(tierOf('l1'), 'pro');
  mem._store.set('user:tier:l2', 'pro'); mem._store.set('user:stripe_customer:l2', 'cus_x');
  assert.equal((await plan.revokePaidPro('l2')).changed, true);
});

test('revoking a Free user is a no-op', async () => {
  assert.deepEqual(await plan.revokePaidPro('nobody'), { changed: false, reason: 'not-pro' });
});

// ── the real webhook handler, end to end (signed with a dummy secret) ───────────────────
const signer = new Stripe(process.env.STRIPE_SECRET_KEY);
async function send(event) {
  const payload = JSON.stringify(event);
  const sig = signer.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
  const req = Object.assign(Readable.from([Buffer.from(payload)]), { method: 'POST', headers: { 'stripe-signature': sig } });
  const res = { code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }, end() { return this; } };
  await webhook(req, res);
  return res;
}
const ev = (type, object) => ({ id: `evt_${Math.random().toString(36).slice(2)}`, object: 'event', type, data: { object } });

test('webhook: checkout.session.completed grants Pro; subscription.deleted revokes it', async () => {
  let r = await send(ev('checkout.session.completed', { id: 'cs_1', payment_status: 'paid', customer: 'cus_a', metadata: { userId: 'u1' } }));
  assert.equal(r.code, 200);
  assert.equal(tierOf('u1'), 'pro');
  assert.equal(sourceOf('u1'), 'stripe');
  r = await send(ev('customer.subscription.deleted', { id: 'sub_1', metadata: { userId: 'u1' } }));
  assert.equal(r.code, 200);
  assert.equal(tierOf('u1'), null);
});

test('webhook: admin is not overwritten by a checkout, nor revoked by a cancellation', async () => {
  await plan.setTierByAdmin('adm', 'admin', 'x');
  await send(ev('checkout.session.completed', { id: 'cs_2', payment_status: 'paid', customer: 'cus_b', metadata: { userId: 'adm' } }));
  assert.equal(tierOf('adm'), 'admin');
  await send(ev('customer.subscription.deleted', { id: 'sub_2', metadata: { userId: 'adm' } }));
  assert.equal(tierOf('adm'), 'admin');
});

test('webhook: invoice.payment_failed is logged, returns 200, changes nothing, never crashes (even with odd payloads)', async () => {
  await plan.grantPaidPro('u2', 'cus_c');
  const warns = []; const ow = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  try {
    for (const object of [
      { id: 'in_1', subscription: 'sub_9', attempt_count: 2, customer_email: 'secret@person.test' },
      { id: 'in_2', parent: { subscription_details: { subscription: 'sub_10' } } },
      {}, 
    ]) {
      const r = await send(ev('invoice.payment_failed', object));
      assert.equal(r.code, 200);
    }
    const r = await send({ id: 'evt_x', object: 'event', type: 'invoice.payment_failed', data: {} });
    assert.equal(r.code, 200);
  } finally { console.warn = ow; }
  assert.equal(tierOf('u2'), 'pro');
  const logged = warns.filter((w) => w.includes('invoice.payment_failed'));
  assert.equal(logged.length, 4);
  assert.ok(!logged.join(' ').includes('secret@person.test')); // no user data in the log
});

test('webhook: a bad signature is rejected (400) and nothing changes', async () => {
  const payload = JSON.stringify(ev('checkout.session.completed', { id: 'cs_3', payment_status: 'paid', metadata: { userId: 'evil' } }));
  const req = Object.assign(Readable.from([Buffer.from(payload)]), { method: 'POST', headers: { 'stripe-signature': 't=1,v1=deadbeef' } });
  const res = { code: null, status(c) { this.code = c; return this; }, json() { return this; }, end() { return this; } };
  const ow = console.error; console.error = () => {};
  try { await webhook(req, res); } finally { console.error = ow; }
  assert.equal(res.code, 400);
  assert.equal(tierOf('evil'), null);
});
