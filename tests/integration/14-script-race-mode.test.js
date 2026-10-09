/** The old behaviour stays available behind SCRIPT_GEMINI_MODE=race (rollback switch). */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '14-script-race-mode', env: { SCRIPT_GEMINI_MODE: 'race' } });
after(() => ctx.afterAll());
const script = await ctx.route('generate-script');

ctx.scenario('S6', 'SCRIPT_GEMINI_MODE=race restores the old behaviour: both quality models start together (2 calls per script)',
  'gemini=2 for one script', async () => {
    const u = await ctx.makeUser('s6', 'free');
    const r = await ctx.invoke(script, { body: { journalEntry: 'I walked along the beach with my family.', genre: 'drama' }, cookies: u.cookies, ip: '198.51.100.92' });
    assert.equal(r.status, 200); assert.equal(ctx.providers.counts.gemini, 2);
    return { actual: '2 calls (rollback switch works)' };
  });
