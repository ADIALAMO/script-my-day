/** Global daily budget for GUEST script generation (GUEST_SCRIPTS_PER_DAY, here 5). Production mode: Telegram only fires there. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '16-guest-budget', nodeEnv: 'production', env: { GUEST_SCRIPTS_PER_DAY: '5' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const script = await ctx.route('generate-script');
const JOURNAL = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama' };
const call = (ip, u) => invoke(script, { body: JOURNAL, cookies: u?.cookies, ip });
const gemini = () => providers.counts.gemini || 0;

async function withLogs(fn) {
  const lines = []; const orig = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.warn = orig; }
  return lines;
}

scenario('P1', 'guest global budget: 5 guest scripts/day across DIFFERENT IPs, the 6th gets the friendly sign-in message with zero provider calls and keeps its per-IP slot; ONE log line + ONE Telegram per day; signed-in users are never blocked; next UTC day resets',
  '5×200, then 429 GUEST_CAPACITY_REACHED; free + pro users still 200; 1 log + 1 telegram; day 2 allowed', async () => {
    const free = await makeUser('p1-free', 'free'); const pro = await makeUser('p1-pro', 'paid');
    const lines = await withLogs(async () => {
      for (let i = 1; i <= 5; i++) assert.equal((await call(`198.51.100.${100 + i}`)).status, 200, `guest ${i}`);
      assert.equal(providers.telegram.length, 0, 'no alert while under the cap');
      const g = gemini();
      for (let i = 6; i <= 9; i++) {
        const r = await call(`198.51.100.${100 + i}`);
        assert.equal(r.status, 429); assert.equal(r.body.code, 'GUEST_CAPACITY_REACHED');
        assert.equal(fake.num(`usage:script:198.51.100.${100 + i}:2026-10-15`), 0, 'refused guest keeps their own per-IP slot');
      }
      assert.equal(gemini(), g, 'refused guests make zero provider calls');
      assert.equal((await call('198.51.100.120', free)).status, 200, 'free user not blocked');
      assert.equal((await call('198.51.100.121', pro)).status, 200, 'pro user not blocked');
      assert.equal(fake.num('usage:guest-script-global:2026-10-15'), 5, 'signed-in users are not counted; refusals rolled back');
    });
    assert.equal(lines.filter((l) => l.includes('BUDGET REACHED') && l.includes('DAILY_GUEST_SCRIPT_BUDGET')).length, 1);
    assert.equal(providers.telegram.length, 1);
    assert.match(providers.telegram[0], /DAILY\\_GUEST\\_SCRIPT\\_BUDGET/);
    ctx.setNow('2026-10-16T00:05:00Z');
    assert.equal((await call('198.51.100.130')).status, 200, 'new UTC day');
    const { getMsg } = await import('../../lib/messages.js');
    return { actual: '5 guests OK; 4 refused (GUEST_CAPACITY_REACHED); free+pro OK; 1 log + 1 telegram; reset next day', evidence: `EN: ${getMsg('GUEST_CAPACITY_REACHED', 'en')}  HE: ${getMsg('GUEST_CAPACITY_REACHED', 'he')}` };
  });

scenario('P2', 'a guest whose generation FAILS gives the global slot back (providers down → 5 failures do not exhaust the budget)',
  'counter returns to 0 after failed generations', async () => {
    ctx.setNow('2026-10-17T12:00:00Z');
    for (const m of ['gemini', 'openrouter-text', 'cohere', 'openrouter-free']) providers.mode[m] = 500;
    for (let i = 1; i <= 3; i++) { const r = await call(`198.51.100.${140 + i}`); assert.equal(r.status, 500); }
    providers.reset();
    assert.equal(fake.num('usage:guest-script-global:2026-10-17'), 0);
    return { actual: '3 failed guest generations → global counter 0', evidence: 'releaseGuestScriptBudget' };
  });
