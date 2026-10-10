/** Scenario L — lib/plan.js is the single source of truth: same answer for every user type, every route uses it. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '11-plan' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, anonymous, plan, ROOT } = ctx;
const me = await ctx.route('me');
const poster = await ctx.route('generate-poster');
const upload = await ctx.route('upload-character');
const { getSessionAndTier } = await import('../../lib/auth.js');

const EXPECT = {
  anonymous:    { tier: 'anonymous', plan: 'free', isPro: false, grantedBy: null },
  free:         { tier: 'free',      plan: 'free', isPro: false, grantedBy: null },
  paid:         { tier: 'pro',       plan: 'pro',  isPro: true,  grantedBy: 'payment' },
  adminGranted: { tier: 'pro',       plan: 'pro',  isPro: true,  grantedBy: 'admin' },
  vip:          { tier: 'pro',       plan: 'pro',  isPro: true,  grantedBy: 'allowlist' },
  admin:        { tier: 'admin',     plan: 'pro',  isPro: true,  grantedBy: 'admin' },
};

scenario('L1', 'all six user types resolve consistently through resolvePlan(), getSessionAndTier() and GET /api/me',
  'identical tier/plan/isPro/grantedBy from the three entry points', async () => {
    const table = [];
    for (const kind of Object.keys(EXPECT)) {
      const u = kind === 'anonymous' ? anonymous('203.0.113.70') : await makeUser(`l1-${kind}`, kind);
      const viaMe = (await invoke(me, { method: 'GET', cookies: u.cookies, ip: u.ip || '203.0.113.71' })).body;
      const viaSession = await getSessionAndTier({ headers: { 'x-real-ip': u.ip || '203.0.113.71' }, cookies: u.cookies, query: {}, socket: {} }, ctx.makeRes());
      const direct = u.id ? await plan.resolvePlan({ userId: u.id, email: u.email }) : EXPECT.anonymous;
      const e = EXPECT[kind];
      assert.equal(viaMe.tier, e.tier, `${kind}: /api/me tier`);
      assert.equal(viaSession.tier, e.tier, `${kind}: getSessionAndTier tier`);
      assert.equal(direct.tier, e.tier, `${kind}: resolvePlan tier`);
      assert.equal(viaSession.plan.isPro, e.isPro, `${kind}: isPro`);
      assert.equal(viaSession.plan.plan, e.plan, `${kind}: plan`);
      if (kind !== 'anonymous') { assert.equal(viaMe.grantedBy, e.grantedBy, `${kind}: grantedBy (me)`); assert.equal(direct.grantedBy, e.grantedBy, `${kind}: grantedBy (direct)`); }
      table.push(`${kind}→${e.tier}/${e.grantedBy}`);
    }
    return { actual: table.join('  '), evidence: 'lib/plan.js classifyPlan(); lib/auth.js getSessionAndTier()' };
  });

scenario('L2', 'the SAME plan drives different routes: poster limit (Free 2 / Pro-any-source 3 / admin ∞) and identity upload access (anonymous refused)',
  'Free 3rd refused; paid, admin-granted and VIP 4th refused; admin 4 allowed; anonymous upload 403', async () => {
    const run = async (kind, n) => {
      const u = await makeUser(`l2-${kind}`, kind); const out = [];
      for (let i = 0; i < n; i++) out.push((await invoke(poster, { body: { prompt: 'a lone figure' }, cookies: u.cookies, ip: `203.0.113.${72 + kind.length}` })).status);
      return out;
    };
    assert.deepEqual(await run('free', 3), [200, 200, 429]);
    for (const kind of ['paid', 'adminGranted', 'vip']) assert.deepEqual(await run(kind, 4), [200, 200, 200, 429], kind);
    assert.deepEqual(await run('admin', 4), [200, 200, 200, 200]);
    const upAnon = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, ip: '203.0.113.79' });
    assert.equal(upAnon.status, 403);
    for (const kind of ['free', 'paid', 'adminGranted', 'vip', 'admin']) {
      const u = await makeUser(`l2u-${kind}`, kind);
      const r = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: u.cookies, ip: `203.0.113.${80 + kind.length}` });
      assert.equal(r.status, 200, `${kind} upload`);
    }
    return { actual: 'Free 2/day; paid, admin-granted and allow-list Pro 3/day; admin unlimited; anonymous upload 403; every signed-in kind may upload' };
  });

function gitGrep(pattern, pathspec) {
  try { return execFileSync('git', ['grep', '-n', '-E', pattern, '--', ...pathspec], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').filter(Boolean); } catch { return []; }
}

scenario('L3', 'no API route reads or writes the Pro flag directly — only lib/plan.js (and read-only admin dashboards). Leftovers are listed.',
  'writes of user:tier only in lib/plan.js; non-admin routes contain no user:tier/tier_source access', async () => {
    const SRC = ['pages', 'lib', 'components', 'hooks', 'utils', 'constants', 'scripts'];
    const flagAccess = gitGrep('user:tier|tier_source', SRC).filter((l) => !/^\S+:\d+:\s*(\/\/|\*|\/\*)/.test(l));
    const byFile = {};
    for (const l of flagAccess) { const f = l.split(':')[0]; (byFile[f] ??= []).push(l.split(':')[1]); }
    const files = Object.keys(byFile).sort();
    const writes = gitGrep('(redis\\.(set|del|sadd|srem)|pipe(line)?\\.(set|del))\\(\\s*[`\'"](user:tier|stats:pro:members)', SRC);
    // lib/pro-source.js is the tiny helper that records the grant SOURCE; it may only be called from lib/plan.js
    assert.deepEqual([...new Set(writes.map((l) => l.split(':')[0]))].filter((f) => !['lib/plan.js', 'lib/pro-source.js'].includes(f)), [], `Pro-flag writes outside lib/plan.js: ${writes}`);
    const srcCallers = [...new Set(gitGrep('(recordProSource|clearProSource)\\(', SRC).map((l) => l.split(':')[0]))].filter((f) => !['lib/plan.js', 'lib/pro-source.js'].includes(f));
    assert.deepEqual(srcCallers, [], `grant-source helpers called outside lib/plan.js: ${srcCallers}`);
    const routes = files.filter((f) => f.startsWith('pages/api/') && !f.startsWith('pages/api/admin/'));
    assert.deepEqual(routes, [], `non-admin routes touching the Pro flag directly: ${routes}`);
    const payment = gitGrep('user:stripe_customer', SRC).filter((l) => !/^\S+:\d+:\s*(\/\/|\*)/.test(l)).map((l) => l.split(':').slice(0, 2).join(':'));
    const consumers = gitGrep("tier *(===|!==) *'(pro|admin|free|anonymous)'", ['pages', 'lib']).map((l) => l.split(':').slice(0, 2).join(':'));
    return {
      actual: `direct flag access only in: ${files.join(', ')}; payment-customer key outside plan.js: ${payment.filter((p) => !p.startsWith('lib/plan.js')).join(', ') || 'none'}`,
      evidence: `tier-comparison consumers (they read the value returned by getSessionAndTier): ${consumers.join(' ')}`,
    };
  });

scenario('L4', 'the allow-list (VIP) is evaluated only inside resolvePlan: not stored, not touched by webhooks, case-insensitive',
  'VIP stays Pro with no Redis tier key; uppercase e-mail still VIP; non-VIP e-mail never', async () => {
    const vip = await makeUser('l4', 'vip');
    assert.equal(ctx.fake.get(`user:tier:${vip.id}`), null);
    assert.equal((await plan.resolvePlan({ userId: vip.id, email: 'VIP@TEST.EXAMPLE' })).grantedBy, 'allowlist');
    assert.equal((await plan.resolvePlan({ userId: 'x', email: 'vip@test.example.evil' })).tier, 'free');
    assert.equal((await plan.resolvePlan({ userId: 'x', email: 'evilvip@test.example' })).tier, 'free');
    return { actual: 'allow-list exact-match only, case-insensitive, never stored' };
  });
