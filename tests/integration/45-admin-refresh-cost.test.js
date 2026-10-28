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
const stages = await ctx.route('admin/script-stages');

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

scenario('F1', 'commands per admin auto-refresh cycle (provider-health + stats + pro-users + users page) and for the creators card; per-day cost of one open tab at 5 min',
  'cycle 12; creators 34 and stages 14 are NOT part of the cycle', async () => {
    fresh(); seed();
    const c = { health: await cost(health), stats: await cost(stats), proUsers: await cost(proUsers), users: await cost(users, { limit: '25', offset: '0', tier: 'all' }) };
    const cycle = c.health + c.stats + c.proUsers + c.users;
    const creatorsCost = await cost(creators);
    assert.equal(creatorsCost, 34, 'one PFCOUNT pipeline: 34 commands');
    const stagesCost = await cost(stages);
    assert.equal(stagesCost, 14, 'one read per day, 14 days');
    const perDay = cycle * (86400 / 300);           // AUTO_REFRESH_MS = 5 min
    // regression guard: the cycle must not silently grow, and one visible tab must stay near the ~3.5K/day target
    assert.equal(cycle, 12, `auto-refresh cycle costs ${cycle} commands: ${JSON.stringify(c)}`);
    assert.ok(perDay <= 3600, `${perDay} commands a day for a visible tab`);
    console.log(`MEASURED per cycle: ${JSON.stringify(c)} = ${cycle}; creators card ${creatorsCost}; script stages ${stagesCost}; one visible tab at 5 min = ${perDay}/day`);
    return { actual: `cycle ${cycle} (${JSON.stringify(c)}); creators ${creatorsCost}, stages ${stagesCost} (load/Refresh only); 5 min tab ${perDay}/day` };
  });

scenario('F2', '/api/admin/script-stages: admin only (401 / 403), GET only, answers the stage list; /api/admin/stats no longer carries scriptStages',
  '401, 403, 405, 200 with scriptStages; stats without it', async () => {
    fresh(); seed();
    assert.equal((await invoke(stages, { method: 'GET', ip: '198.51.100.201' })).status, 401);
    assert.equal((await invoke(stages, { method: 'GET', cookies: (await ctx.makeUser('f2-free', 'free')).cookies, ip: '198.51.100.201' })).status, 403);
    assert.equal((await invoke(stages, { method: 'POST', headers: adminKeyHeader, ip: '198.51.100.201' })).status, 405);
    const ok = await invoke(stages, { method: 'GET', headers: adminKeyHeader, ip: '198.51.100.201' });
    assert.equal(ok.status, 200); assert.ok(Array.isArray(ok.body.scriptStages));
    const st = await invoke(stats, { method: 'GET', headers: adminKeyHeader, ip: '198.51.100.201' });
    assert.ok(!('scriptStages' in st.body));
    return { actual: 'gated, GET only, split off' };
  });
