import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.OBJECT_KEY_SECRET = 'unit-secret';
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';
const { buildPlan, executePlan, run, parseArgs } = await import('../scripts/delete-user-data.js');
const { ownerSegment, legacyOwnerSegment } = await import('../lib/upload-image.js');

const ID = '11111111-aaaa-bbbb-cccc-222222222222', OTHER = '99999999-ffff-eeee-dddd-000000000000';
const EMAIL = 'someone@example.com';

/** minimal Redis mock: strings, sets, zsets, glob SCAN, DEL */
function mockRedis(seed = {}) {
  const store = new Map(Object.entries(seed)); const sets = new Map(); const zsets = new Map(); const calls = [];
  const glob = (pat) => new RegExp('^' + pat.replace(/\\(.)/g, '\u0000$1').replace(/[.+^${}()|]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.').replace(/\u0000(.)/g, (_, c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) + '$');
  return {
    store, sets, zsets, calls,
    async get(k) { const v = store.get(k); return v === undefined ? null : v; },
    async scan(cursor, { match }) { const re = glob(match); return ['0', [...store.keys()].filter((k) => re.test(k))]; },
    async del(...ks) { calls.push(['del', ks]); let n = 0; for (const k of ks) if (store.delete(k)) n++; return n; },
    async sismember(k, m) { return sets.get(k)?.has(m) ? 1 : 0; },
    async zscore(k, m) { return zsets.get(k)?.has(m) ? zsets.get(k).get(m) : null; },
    async srem(k, m) { calls.push(['srem', k, m]); sets.get(k)?.delete(m); return 1; },
    async zrem(k, m) { calls.push(['zrem', k, m]); zsets.get(k)?.delete(m); return 1; },
  };
}
function mockR2(objs) { const set = new Set(objs); const deleted = []; return { set, deleted, async list(p) { return [...set].filter((k) => k.startsWith(p)); }, async del(k) { deleted.push(k); set.delete(k); } }; }

function seed() {
  const r = mockRedis({
    [`user:${ID}`]: { id: ID, email: EMAIL, name: 'S' },
    [`user:email:${EMAIL}`]: ID,
    [`user:tier:${ID}`]: 'pro', [`user:tier_source:${ID}`]: '{}', [`user:stripe_customer:${ID}`]: 'cus_x',
    [`user:last_active:${ID}`]: '2026-10-01', [`user:signup_provider:${ID}`]: 'google', [`signup:fresh:${ID}`]: 'google',
    [`usage:script:u:${ID}:2026-10-15`]: '3', [`usage:script-month:u:${ID}:2026-10`]: '3', [`usage:poster:u:${ID}:2026-10-15`]: '1',
    [`usage:comic:u:${ID}:2026-10-15`]: '1', [`usage:comic-month:u:${ID}:2026-10`]: '1', [`usage:comic:lifetime:u:${ID}`]: '2',
    [`usage:identity:u:${ID}:2026-10`]: '4', [`usage:identity:lifetime:u:${ID}`]: '1', [`usage:identity:bonus:u:${ID}`]: '2',
    [`usage:sheet:u:${ID}:2026-10`]: '1', [`usage:panels:u:${ID}:2026-10-15`]: '9',
    [`character:u:${ID}`]: { url: 'https://pub-test.r2.dev/characters/old/x-raw.jpg', styledUrl: 'https://pub-test.r2.dev/characters/old/x-sheet.jpg' },
    [`referral:codeof:u:${ID}`]: 'abc123', 'referral:code:abc123': ID, [`referral:name:${ID}`]: 'S', [`referral:by:${ID}`]: OTHER, [`referral:count:${ID}`]: '1',
    [`user:account:by-user-id:${ID}`]: 'user:account:google:g-777', 'user:account:google:g-777': { userId: ID },
    [`user:session:by-user-id:${ID}`]: 'user:session:tok-1', 'user:session:tok-1': { userId: ID },
    [`user:token:${EMAIL}:abcdef`]: { identifier: EMAIL }, [`waitlist:${EMAIL}`]: '1',
    [`deletion-request:${EMAIL}:123`]: '{}',
    // someone else's data that must survive
    [`user:${OTHER}`]: { id: OTHER, email: 'other@example.com' }, 'user:email:other@example.com': OTHER, [`usage:script:u:${OTHER}:2026-10-15`]: '1',
    [`character:u:${OTHER}`]: {}, 'usage:poster:lifetime:203.0.113.5': '1',
  });
  r.sets.set('stats:pro:members', new Set([ID, OTHER])); r.zsets.set('stats:users:all', new Map([[ID, 1], [OTHER, 2]]));
  return r;
}
const me = `u:${ID}`;
function seedR2() {
  return mockR2([
    `characters/${ownerSegment(me)}/n1-raw.jpg`, `characters/${ownerSegment(me)}/n1-sheet.jpg`, `posters/${ownerSegment(me)}/p1.png`, `panels/${ownerSegment(me)}/c1.png`,
    `posters/${legacyOwnerSegment(me)}/old.png`, `characters/u:${ID}-raw-1700.jpg`, 'characters/old/x-raw.jpg',
    `characters/${ownerSegment(`u:${OTHER}`)}/o-sheet.jpg`, `posters/${ownerSegment('203.0.113.5')}/g.png`,           // other people's objects
  ]);
}
const quiet = () => {};

test('dry run (default) lists keys and objects and changes NOTHING', async () => {
  const redis = seed(), r2 = seedR2(); const before = redis.store.size, ob = r2.set.size; const lines = [];
  const { code, plan } = await run({ argv: ['--email', EMAIL], redis, r2, confirm: async () => assert.fail('no prompt in a dry run'), out: (s) => lines.push(s) });
  assert.equal(code, 0);
  assert.equal(redis.store.size, before); assert.equal(r2.set.size, ob); assert.equal(redis.calls.length, 0); assert.equal(r2.deleted.length, 0);
  assert.ok(lines.join('\n').includes('DRY RUN'));
  assert.equal(plan.userId, ID);
});

test('plan covers every per-user key family and object family, and nobody else’s data', async () => {
  const plan = await buildPlan({ redis: seed(), r2: seedR2(), email: EMAIL, env: { OBJECT_KEY_SECRET: 'unit-secret' } });
  const has = (k) => assert.ok(plan.redisKeys.includes(k), `missing ${k}`);
  [`user:${ID}`, `user:email:${EMAIL}`, `user:tier:${ID}`, `user:tier_source:${ID}`, `user:stripe_customer:${ID}`, `user:last_active:${ID}`, `user:signup_provider:${ID}`, `signup:fresh:${ID}`,
    `usage:script:u:${ID}:2026-10-15`, `usage:script-month:u:${ID}:2026-10`, `usage:poster:u:${ID}:2026-10-15`, `usage:comic:u:${ID}:2026-10-15`, `usage:comic-month:u:${ID}:2026-10`,
    `usage:comic:lifetime:u:${ID}`, `usage:identity:u:${ID}:2026-10`, `usage:identity:lifetime:u:${ID}`, `usage:identity:bonus:u:${ID}`, `usage:sheet:u:${ID}:2026-10`, `usage:panels:u:${ID}:2026-10-15`,
    `character:u:${ID}`, `referral:codeof:u:${ID}`, 'referral:code:abc123', `referral:name:${ID}`, `referral:by:${ID}`, `referral:count:${ID}`,
    `user:account:by-user-id:${ID}`, 'user:account:google:g-777', `user:session:by-user-id:${ID}`, 'user:session:tok-1', `user:token:${EMAIL}:abcdef`, `waitlist:${EMAIL}`].forEach(has);
  assert.ok(!plan.redisKeys.some((k) => k.includes(OTHER) || k.includes('other@') || k.includes('203.0.113.5')), 'other users untouched');
  assert.ok(!plan.redisKeys.some((k) => k.startsWith('deletion-request:')), 'the audit record of the request is kept by default');
  assert.deepEqual(plan.setOps.map((o) => `${o.cmd}:${o.key}`).sort(), ['srem:stats:pro:members', 'zrem:stats:users:all']);
  assert.deepEqual(plan.objects, [
    `characters/${ownerSegment(me)}/n1-raw.jpg`, `characters/${ownerSegment(me)}/n1-sheet.jpg`, 'characters/old/x-raw.jpg', 'characters/old/x-sheet.jpg', `characters/u:${ID}-raw-1700.jpg`,
    `panels/${ownerSegment(me)}/c1.png`, `posters/${legacyOwnerSegment(me)}/old.png`, `posters/${ownerSegment(me)}/p1.png`].sort());
});

test('--execute: confirmation is asked with the plan, then exactly the planned keys/objects are deleted; others survive', async () => {
  const redis = seed(), r2 = seedR2(); let shown = null; const lines = [];
  const { code, result } = await run({ argv: ['--user', ID, '--execute'], redis, r2, out: (s) => lines.push(s), confirm: async (p) => { shown = p; return true; } });
  assert.equal(code, 0); assert.ok(shown.redisKeys.length > 20 && shown.objects.length === 8);
  assert.equal(result.errors.length, 0);
  assert.ok(lines.join('\n').includes(`DEL   user:${ID}`) && lines.join('\n').includes('DELETE posters/'));
  assert.ok(![...redis.store.keys()].some((k) => k.includes(ID)), 'no key with the user id remains');
  assert.ok(redis.store.has(`user:${OTHER}`) && redis.store.has(`usage:script:u:${OTHER}:2026-10-15`) && redis.store.has(`deletion-request:${EMAIL}:123`));
  assert.equal(redis.sets.get('stats:pro:members').has(ID), false); assert.equal(redis.sets.get('stats:pro:members').has(OTHER), true);
  assert.equal(redis.zsets.get('stats:users:all').has(ID), false);
  assert.equal(r2.set.size, 2); assert.ok([...r2.set].every((k) => k.includes(ownerSegment(`u:${OTHER}`)) || k.includes(ownerSegment('203.0.113.5'))));
});

test('declined confirmation → nothing is deleted', async () => {
  const redis = seed(), r2 = seedR2(); const n = redis.store.size;
  const { code } = await run({ argv: ['--user', ID, '--execute'], redis, r2, confirm: async () => false, out: quiet });
  assert.equal(code, 2); assert.equal(redis.store.size, n); assert.equal(r2.deleted.length, 0);
});

test('admin accounts are refused without --allow-admin (by tier and by ADMIN_EMAILS), allowed with it', async () => {
  const a = seed(); a.store.set(`user:tier:${ID}`, 'admin');
  let r = await run({ argv: ['--user', ID, '--execute'], redis: a, r2: seedR2(), confirm: async () => assert.fail('must not even ask'), out: quiet });
  assert.equal(r.code, 3); assert.ok(a.store.has(`user:${ID}`));
  const b = seed();
  r = await run({ argv: ['--email', EMAIL, '--execute'], redis: b, r2: seedR2(), confirm: async () => assert.fail('must not ask'), out: quiet, env: { ADMIN_EMAILS: 'x@y.z, Someone@Example.com', OBJECT_KEY_SECRET: 'unit-secret' } });
  assert.equal(r.code, 3);
  r = await run({ argv: ['--user', ID, '--execute', '--allow-admin'], redis: a, r2: seedR2(), confirm: async () => true, out: quiet });
  assert.equal(r.code, 0); assert.ok(!a.store.has(`user:${ID}`));
});

test('a failing delete is reported, the rest still runs, exit code 1', async () => {
  const redis = seed(), r2 = seedR2(); const orig = r2.del; r2.del = async (k) => { if (k.endsWith('p1.png')) throw new Error('boom'); return orig(k); };
  const { code, result } = await run({ argv: ['--user', ID, '--execute'], redis, r2, confirm: async () => true, out: quiet });
  assert.equal(code, 1); assert.equal(result.errors.length, 1); assert.equal(result.objectsDeleted, 7);
});

test('unknown user is an error; argument parsing', async () => {
  await assert.rejects(() => buildPlan({ redis: mockRedis(), email: 'nobody@example.com' }), /No user found/);
  assert.throws(() => parseArgs([]), /--user/);
  assert.throws(() => parseArgs(['--user', 'x', '--wat']), /Unknown argument/);
  assert.deepEqual(parseArgs(['--email', 'a@b.c', '--execute']).execute, true);
});

test('without OBJECT_KEY_SECRET the plan says that HMAC-folder objects cannot be found', async () => {
  const plan = await buildPlan({ redis: seed(), r2: seedR2(), userId: ID, env: {} });
  assert.ok(plan.notes.some((n) => n.includes('OBJECT_KEY_SECRET')));
});
