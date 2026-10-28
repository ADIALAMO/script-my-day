/** Scenario K — billing disabled, Stripe webhook (signed / unsigned), admin protection, idempotency. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '10-billing' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake, plan } = ctx;
const webhook = await ctx.route('stripe/webhook');
const checkout = await ctx.route('checkout/index');
const me = await ctx.route('me');
const { default: Stripe } = await import('stripe');
const signer = new Stripe(process.env.STRIPE_SECRET_KEY);

// K3–K8 test what the webhook does once billing IS enabled (the flag is "true" only for the duration of one scenario);
// K1/K2 and K9–K12 run with the flag unset, i.e. the production default while no payment provider is live.
const billingOn = (fn) => async (...a) => { process.env.NEXT_PUBLIC_BILLING_ENABLED = 'true'; try { return await fn(...a); } finally { delete process.env.NEXT_PUBLIC_BILLING_ENABLED; } };
const scenarioBilling = (id, title, expected, fn) => scenario(id, title, expected, billingOn(fn));

let n = 0;
const ev = (type, object) => ({ id: `evt_${++n}`, object: 'event', type, data: { object } });
const paid = (userId, customer = `cus_${userId}`) => ev('checkout.session.completed', { id: `cs_${++n}`, payment_status: 'paid', customer, metadata: { userId } });
const deleted = (userId) => ev('customer.subscription.deleted', { id: `sub_${++n}`, metadata: { userId } });
const failed = (extra = {}) => ev('invoice.payment_failed', { id: `in_${++n}`, subscription: 'sub_x', attempt_count: 2, customer_email: 'private@person.test', ...extra });
function send(event, { secret = process.env.STRIPE_WEBHOOK_SECRET, timestamp, headerOverride, body } = {}) {
  const payload = body ?? JSON.stringify(event);
  const sig = headerOverride !== undefined ? headerOverride : signer.webhooks.generateTestHeaderString({ payload, secret, ...(timestamp ? { timestamp } : {}) });
  return invoke(webhook, { stream: payload, headers: sig === null ? {} : { 'stripe-signature': sig }, ip: '203.0.113.60' });
}
const tierOf = (id) => fake.get(`user:tier:${id}`);
const sourceOf = (id) => { const r = fake.get(`user:tier_source:${id}`); return r ? JSON.parse(r).source : null; };
const meOf = async (u) => (await invoke(me, { method: 'GET', cookies: u.cookies })).body;
const members = () => fake.exec(['SMEMBERS', 'stats:pro:members']);

scenario('K1', 'billing is disabled: POST /api/checkout → 503 for anonymous and signed-in users, and no call goes to Stripe',
  '503 "Billing is not available yet", zero outbound requests', async () => {
    const u = await makeUser('k1', 'free');
    for (const opts of [{ cookies: {} }, { cookies: u.cookies }]) {
      const r = await invoke(checkout, { ...opts, ip: '203.0.113.61' });
      assert.equal(r.status, 503); assert.match(r.body.error, /not available/i);
    }
    assert.deepEqual(providers.unexpected, []); assert.deepEqual(ctx.violations, []);
    assert.equal(process.env.NEXT_PUBLIC_BILLING_ENABLED, undefined);
    return { actual: '503 ×2; no Stripe request attempted' };
  });

scenario('K2', 'unsigned / badly signed / tampered / stale / malformed webhooks are rejected (400) and change nothing',
  '400 for every variant; no Pro granted', async () => {
    const u = await makeUser('k2', 'free');
    const good = paid(u.id);
    const cases = {
      'no signature header': () => send(good, { headerOverride: null }),
      'garbage signature': () => send(good, { headerOverride: 't=1,v1=deadbeef' }),
      'signed with another secret': () => send(good, { secret: 'whsec_somebody_else' }),
      'payload tampered after signing': () => { const p = JSON.stringify(good); const sig = signer.webhooks.generateTestHeaderString({ payload: p, secret: process.env.STRIPE_WEBHOOK_SECRET }); return send(good, { headerOverride: sig, body: p.replace(u.id, 'attacker') }); },
      'stale timestamp (1 hour old = replay)': () => send(good, { timestamp: Math.floor(Date.now() / 1000) - 3600 }),
      'empty body': () => send(good, { body: '' , headerOverride: signer.webhooks.generateTestHeaderString({ payload: '', secret: process.env.STRIPE_WEBHOOK_SECRET }) }),
    };
    const out = {};
    const orig = console.error; console.error = () => {};
    try { for (const [name, fn] of Object.entries(cases)) { const r = await fn(); out[name] = r.status; assert.equal(r.status, 400, name); } } finally { console.error = orig; }
    assert.equal(tierOf(u.id), null); assert.equal(tierOf('attacker'), null);
    return { actual: JSON.stringify(out), evidence: 'pages/api/stripe/webhook.js:56-76 (constructEvent, 300 s tolerance)' };
  });

scenarioBilling('K3', 'a correctly signed checkout.session.completed activates Pro for a normal user (source = payment) and /api/me reflects it; the customer id is stored',
  'tier pro, source stripe, /api/me tier=pro grantedBy=payment', async () => {
    const u = await makeUser('k3', 'free');
    assert.equal((await meOf(u)).tier, 'free');
    const r = await send(paid(u.id));
    assert.equal(r.status, 200);
    assert.equal(tierOf(u.id), 'pro'); assert.equal(sourceOf(u.id), 'stripe');
    assert.equal(fake.get(`user:stripe_customer:${u.id}`), `cus_${u.id}`);
    const m = await meOf(u);
    assert.equal(m.tier, 'pro'); assert.equal(m.grantedBy, 'payment');
    // the Pro limits are really in force now (script cap 20 instead of 5)
    const script = await ctx.route('generate-script');
    for (let i = 0; i < 6; i++) assert.equal((await invoke(script, { body: { journalEntry: 'a long walk home after the rain', genre: 'drama' }, cookies: u.cookies, ip: '203.0.113.62' })).status, 200);
    return { actual: '/api/me → pro / payment; 6th script allowed (Free would be refused)' };
  });

scenarioBilling('K4', 'a payment must NOT overwrite admin: (a) stored admin stays admin, (b) admin-granted Pro keeps source=admin; the payment customer id is still recorded',
  'tier admin / pro unchanged, source admin unchanged, grantedBy admin', async () => {
    const adm = await makeUser('k4a', 'admin'); const granted = await makeUser('k4b', 'adminGranted');
    assert.equal((await send(paid(adm.id))).status, 200); assert.equal((await send(paid(granted.id))).status, 200);
    assert.equal(tierOf(adm.id), 'admin'); assert.equal(sourceOf(adm.id), 'admin');
    assert.equal(tierOf(granted.id), 'pro'); assert.equal(sourceOf(granted.id), 'admin');
    assert.equal((await meOf(adm)).tier, 'admin'); assert.equal((await meOf(granted)).grantedBy, 'admin');
    assert.equal(fake.get(`user:stripe_customer:${granted.id}`), `cus_${granted.id}`);
    return { actual: 'admin stays admin; admin-granted Pro keeps source=admin' };
  });

scenarioBilling('K5', 'customer.subscription.deleted revokes a PAID Pro but NOT admin, NOT admin-granted Pro, and NOT a legacy Pro of unknown origin without a payment customer; the VIP allow-list is untouched',
  'paid → free; admin / admin-granted / legacy / VIP unchanged', async () => {
    const paidU = await makeUser('k5p', 'paid'); const adm = await makeUser('k5a', 'admin'); const granted = await makeUser('k5g', 'adminGranted'); const vip = await makeUser('k5v', 'vip');
    fake.set('user:tier:legacy-k5', 'pro'); fake.exec(['SADD', 'stats:pro:members', 'legacy-k5']);
    for (const id of [paidU.id, adm.id, granted.id, vip.id, 'legacy-k5']) assert.equal((await send(deleted(id))).status, 200);
    assert.equal(tierOf(paidU.id), null); assert.equal((await meOf(paidU)).tier, 'free');
    assert.equal(tierOf(adm.id), 'admin'); assert.equal(tierOf(granted.id), 'pro'); assert.equal(tierOf('legacy-k5'), 'pro');
    assert.equal((await meOf(vip)).tier, 'pro', 'allow-list Pro is computed, not stored, so a cancel cannot remove it');
    assert.ok(!members().includes(paidU.id) && members().includes(granted.id));
    return { actual: 'only the paid Pro was revoked' };
  });

scenarioBilling('K6', 'invoice.payment_failed is logged (fixed text + the attempt number: no invoice / subscription id, no e-mail), answers 200, changes no access, and survives malformed payloads',
  '200 ×5; tier unchanged; log lines carry NO invoice / subscription id and no e-mail', async () => {
    const u = await makeUser('k6', 'paid');
    const lines = []; const ow = console.warn; console.warn = (...a) => lines.push(a.join(' '));
    const results = [];
    try {
      for (const e of [failed(), failed({ subscription: undefined, parent: { subscription_details: { subscription: 'sub_new' } } }), failed({ subscription: { id: 'sub_obj' } }), ev('invoice.payment_failed', {}), { id: 'evt_x', object: 'event', type: 'invoice.payment_failed', data: {} }]) results.push((await send(e)).status);
    } finally { console.warn = ow; }
    assert.deepEqual(results, [200, 200, 200, 200, 200]);
    assert.equal(tierOf(u.id), 'pro'); assert.equal((await meOf(u)).tier, 'pro');
    const logged = lines.filter((l) => l.includes('invoice.payment_failed'));
    assert.equal(logged.length, 5);
    assert.ok(!logged.join('\n').includes('private@person.test'));
    assert.match(logged[0], /payment_failed \(attempt=2\) — logged only/);
    assert.ok(!/in_\d+|sub_(x|new|obj)|invoice=|subscription=/.test(logged.join('\n')), 'no Stripe object id in the log');
    return { actual: `5×200, access unchanged, ${logged.length} log lines, no PII`, evidence: logged[0] };
  });

scenarioBilling('K7', 'duplicate delivery of the same event is idempotent (checkout ×3, delete ×3, failed ×3): final state identical, member set has one entry',
  'same state after 1 and after 3 deliveries', async () => {
    const u = await makeUser('k7', 'free');
    const e = paid(u.id);
    for (let i = 0; i < 3; i++) assert.equal((await send(e)).status, 200);
    assert.equal(tierOf(u.id), 'pro'); assert.equal(members().filter((m) => m === u.id).length, 1);
    const f = failed(); for (let i = 0; i < 3; i++) assert.equal((await send(f)).status, 200);
    assert.equal(tierOf(u.id), 'pro');
    const d = deleted(u.id);
    for (let i = 0; i < 3; i++) assert.equal((await send(d)).status, 200);
    assert.equal(tierOf(u.id), null); assert.ok(!members().includes(u.id));
    return { actual: 'state after N deliveries == state after 1 (idempotent by construction)', evidence: 'NOTE: there is no event-id de-duplication (webhook.js); idempotency comes from SET/DEL/SADD/SREM semantics' };
  });

scenarioBilling('K8', 'edge cases: unpaid session, missing userId, unknown event types → 200 and no change; processing error → 500 so Stripe retries',
  'no Pro granted for unpaid/no-user; unknown type ignored; Redis failure → 500', async () => {
    const u = await makeUser('k8', 'free');
    const oe = console.error; console.error = () => {};
    try {
      assert.equal((await send(ev('checkout.session.completed', { id: 'cs_u', payment_status: 'unpaid', customer: 'c', metadata: { userId: u.id } }))).status, 200);
      assert.equal((await send(ev('checkout.session.completed', { id: 'cs_n', payment_status: 'paid', customer: 'c', metadata: {} }))).status, 200);
      assert.equal((await send(ev('customer.created', { id: 'cus' }))).status, 200);
      assert.equal(tierOf(u.id), null);
      fake.control.failCommands.add('MGET');                       // grant path reads the current tier first → simulated Redis failure
      const r = await send(paid(u.id));
      fake.control.failCommands.delete('MGET');
      assert.equal(r.status, 500);
    } finally { console.error = oe; }
    assert.equal(tierOf(u.id), null);
    return { actual: 'unpaid/no-user/unknown → 200 no change; Redis error → 500 (Stripe will retry)' };
  });

const portal = await ctx.route('portal/index');
const logged = async (fn) => { const lines = []; const ow = console.warn, oe = console.error; console.warn = (...a) => lines.push(a.join(' ')); console.error = () => {}; try { return { r: await fn(), lines }; } finally { console.warn = ow; console.error = oe; } };

scenario('K9', 'billing flag unset: a VALIDLY SIGNED checkout.session.completed → 200 {ignored}, Pro is NOT granted, no tier / source / customer / member written',
  '200 + ignored:true; no tier / source / customer / member keys', async () => {
    const u = await makeUser('k9', 'free');
    const { r } = await logged(() => send(paid(u.id)));
    assert.equal(r.status, 200); assert.deepEqual(r.body, { received: true, ignored: true });
    assert.equal(tierOf(u.id), null); assert.equal(sourceOf(u.id), null);
    assert.equal(fake.get(`user:stripe_customer:${u.id}`), null);
    assert.deepEqual(members(), []);
    return { actual: '200 ignored; user stays Free; no Pro key written' };
  });

scenario('K10', 'billing flag unset (or any value but "true"): signed customer.subscription.deleted does NOT revoke an existing Pro, any other event type is ignored too',
  '200 ignored; a paid Pro stays Pro; flag "false"/"1"/"TRUE" behaves like unset', async () => {
    const u = await makeUser('k10', 'paid');
    assert.equal(tierOf(u.id), 'pro');
    for (const flag of [undefined, 'false', '1', 'TRUE', '']) {
      if (flag === undefined) delete process.env.NEXT_PUBLIC_BILLING_ENABLED; else process.env.NEXT_PUBLIC_BILLING_ENABLED = flag;
      try {
        for (const e of [deleted(u.id), failed(), ev('customer.created', { id: 'cus_x' })]) {
          const { r } = await logged(() => send(e));
          assert.equal(r.status, 200, `flag=${flag} ${e.type}`); assert.equal(r.body.ignored, true);
        }
      } finally { delete process.env.NEXT_PUBLIC_BILLING_ENABLED; }
    }
    assert.equal(tierOf(u.id), 'pro'); assert.equal(sourceOf(u.id), 'stripe');
    return { actual: 'Pro unchanged after 15 ignored events (5 flag values × 3 types)' };
  });

scenario('K11', 'billing flag unset: the ignored event logs ONLY its type — no event id, no payload, no e-mail, no user id, no customer id',
  'one log line "type=…"; nothing from the payload', async () => {
    const u = await makeUser('k11', 'free');
    const e = ev('invoice.payment_failed', { id: 'in_k11', subscription: 'sub_k11', customer: 'cus_SECRETCUSTOMER', customer_email: 'private@person.test', metadata: { userId: u.id } });
    const { r, lines } = await logged(() => send(e));
    assert.equal(r.status, 200);
    const text = lines.join('\n');
    assert.match(text, /type=invoice\.payment_failed/);
    for (const secret of ['private@person.test', 'cus_SECRETCUSTOMER', u.id, 'sub_k11', 'in_k11', e.id]) assert.ok(!text.includes(secret), `log leaks ${secret}`);
    return { actual: `logged: ${lines.join(' | ')}` };
  });

scenario('K12', 'signature is verified BEFORE the flag: with the flag unset a forged / unsigned / stale request is still 400 (never "ignored"); the portal answers 503 before auth, Redis or Stripe',
  '400 for bad signatures; portal 503 for anonymous, free and paid callers; zero outbound calls', async () => {
    const u = await makeUser('k12', 'paid');
    const good = paid(u.id);
    const out = {};
    for (const [name, opts] of Object.entries({ 'no header': { headerOverride: null }, 'garbage': { headerOverride: 't=1,v1=dead' }, 'other secret': { secret: 'whsec_other' }, 'stale': { timestamp: Math.floor(Date.now() / 1000) - 3600 } })) {
      const { r } = await logged(() => send(good, opts)); out[name] = r.status; assert.equal(r.status, 400, name);
    }
    for (const cookies of [{}, (await makeUser('k12f', 'free')).cookies, u.cookies]) {
      const r = await invoke(portal, { cookies, ip: '203.0.113.62' });
      assert.equal(r.status, 503); assert.match(r.body.error, /not available/i);
    }
    assert.deepEqual(providers.unexpected, []); assert.deepEqual(ctx.violations, []);
    return { actual: `bad signatures ${JSON.stringify(out)}; portal 503 ×3; no Stripe request` };
  });

scenario('K13', 'flag on: the portal is no longer blocked by the guard (anonymous → 401 from the auth gate, not 503)',
  '401 when billing is enabled', async () => {
    process.env.NEXT_PUBLIC_BILLING_ENABLED = 'true';
    try { const r = await invoke(portal, { cookies: {}, ip: '203.0.113.63' }); assert.equal(r.status, 401); } finally { delete process.env.NEXT_PUBLIC_BILLING_ENABLED; }
    return { actual: '401 Authentication required' };
  });
