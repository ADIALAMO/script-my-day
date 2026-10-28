/**
 * Scenario F — what ONE admin auto-refresh cycle costs in Upstash commands (the free tier allows 500K per MONTH). Upstash counts every command, also inside a pipeline;
 * an MGET of many keys is ONE command. The numbers come from the fake Redis' command counter (exact), with a realistic data set (35 users, 4 Pro members; the 14 script-stage reads count even when the day is empty).
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '45-admin-refresh-cost', nodeEnv: 'production' });
after(() => ctx.afterAll());
const { scenario, invoke, fake, adminKeyHeader, fresh } = ctx;
const health = await ctx.route('provider-health');
const stats = await ctx.route('admin/stats');
const proUsers = await ctx.route('admin/pro-users');
const users = await ctx.route('admin/users');
const creators = await ctx.route('admin/active-creators');

function seed() {
  for (let i = 0; i < 35; i++) {
    fake.exec(['ZADD', 'stats:users:all', String(1_700_000_000_000 + i), `id${i}`]);
    fake.set(`user:id${i}`, JSON.stringify({ id: `id${i}`, email: `u${i}@test.example`, name: `U${i}` }));
  }
  for (let i = 0; i < 4; i++) { fake.exec(['SADD', 'stats:pro:members', `id${i}`]); fake.set(`user:tier:id${i}`, 'pro'); }
}
const cost = async (route, query = {}) => {
  const before = fake.stats.total;
  const r = await invoke(route, { method: 'GET', headers: adminKeyHeader, query, ip: '198.51.100.200' });
  assert.equal(r.status, 200);
  return fake.stats.total - before;
};

scenario('F1', 'commands per admin auto-refresh cycle (provider-health + stats + pro-users + users page) and for the creators card; per-day cost of one open tab at 30 s',
  'cycle measured; creators 34 and NOT part of the cycle', async () => {
    fresh(); seed();
    const c = { health: await cost(health), stats: await cost(stats), proUsers: await cost(proUsers), users: await cost(users, { limit: '25', offset: '0', tier: 'all' }) };
    const cycle = c.health + c.stats + c.proUsers + c.users;
    const creatorsCost = await cost(creators);
    assert.equal(creatorsCost, 34, 'one PFCOUNT pipeline: 34 commands');
    const perDay30s = cycle * 2880;
    // regression guard: the cycle must not silently grow (today: see the measured numbers in the report)
    assert.ok(cycle <= 30, `auto-refresh cycle costs ${cycle} commands`);
    console.log(`MEASURED per cycle: ${JSON.stringify(c)} = ${cycle}; creators card ${creatorsCost}; one visible tab at 30 s = ${perDay30s}/day`);
    return { actual: `cycle ${cycle} (${JSON.stringify(c)}); creators ${creatorsCost}; 30 s tab ${perDay30s}/day` };
  });
