/**
 * Scenario P — privacy-mode guard (lib/privacy-mode.js). The Privacy Policy describes PRODUCTION with privacy mode ON (OpenRouter + DAILY_SCRIPT_BUDGET > 0). With it OFF on the production
 * deployment (VERCEL_ENV=production) the owner gets ONE deduped Telegram alert (6 h) and a log line per instance; Preview deployments and privacy-mode-ON never alert.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '43-privacy-mode', nodeEnv: 'production', env: { VERCEL_ENV: 'production', DAILY_SCRIPT_BUDGET: '0' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser } = ctx;
const script = await ctx.route('generate-script');
const storyboard = await ctx.route('generate-storyboard');
const { _resetPrivacyModeLog } = await import('../../lib/privacy-mode.js');

const callScript = (u, ip) => invoke(script, { body: { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama', gender: 'neutral' }, cookies: u.cookies, ip });
const callSb = (u, ip) => invoke(storyboard, { body: { script: 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.', lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: `${Date.now()}${Math.random()}` }, cookies: u.cookies, ip });
const alerts = () => providers.telegram.filter((t) => /privacy mode is \*OFF\*/.test(t));
const withEnv = async (vars, fn) => { const prev = {}; for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; } try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; } } };
const capture = async (fn) => { const lines = []; const o = console.error; console.error = (...a) => { lines.push(a.join(' ')); }; try { return { result: await fn(), lines }; } finally { console.error = o; } };

scenario('P1', 'privacy mode OFF on the production deployment: ONE Telegram alert and ONE log line, however many script / comic requests follow (deduped across paths)',
  '1 alert, 1 log line after script + script + comic', async () => {
    _resetPrivacyModeLog();
    const u = await makeUser('p1', 'admin');
    const { lines } = await capture(async () => { await callScript(u, '198.51.100.170'); await callScript(u, '198.51.100.171'); await callSb(u, '198.51.100.172'); });
    assert.equal(alerts().length, 1, JSON.stringify(providers.telegram));
    assert.equal(lines.filter((l) => /PRIVACY MODE IS OFF/.test(l)).length, 1, 'one log line per instance');
    const text = alerts()[0];
    assert.match(text, /Privacy Policy/); assert.match(text, /DAILY\\_SCRIPT\\_BUDGET/);
    assert.ok(!/@test\.example|198\.51\.100|p1-admin|sk-|fake-/.test(text), 'fixed text: no ids, addresses or secrets');
    return { actual: 'one alert, one line' };
  });

scenario('P2', 'privacy mode ON (DAILY_SCRIPT_BUDGET > 0 and an OpenRouter key): no alert, no log line',
  '0 alerts', async () => {
    _resetPrivacyModeLog();
    const u = await makeUser('p2', 'admin');
    const { lines } = await capture(() => withEnv({ DAILY_SCRIPT_BUDGET: '10' }, async () => { await callScript(u, '198.51.100.173'); await callSb(u, '198.51.100.174'); }));
    assert.equal(alerts().length, 0); assert.equal(lines.filter((l) => /PRIVACY MODE/.test(l)).length, 0);
    return { actual: 'silent' };
  });

scenario('P3', 'a PREVIEW deployment (VERCEL_ENV=preview) never alerts, even with privacy mode off — it shares the Telegram chat with Production',
  '0 alerts, 0 log lines', async () => {
    _resetPrivacyModeLog();
    const u = await makeUser('p3', 'admin');
    const { lines } = await capture(() => withEnv({ VERCEL_ENV: 'preview' }, async () => { await callScript(u, '198.51.100.175'); await callSb(u, '198.51.100.176'); }));
    assert.equal(alerts().length, 0); assert.equal(lines.filter((l) => /PRIVACY MODE/.test(l)).length, 0);
    return { actual: 'silent' };
  });

scenario('P4', 'privacy mode is also OFF when the OpenRouter key is missing: alerted; the alert window is 6 h (a new one after 6 h, none before)',
  '1 alert; none at +5 h; a 2nd at +6 h 1 min', async () => {
    _resetPrivacyModeLog();
    const u = await makeUser('p4', 'admin');
    await withEnv({ OPENROUTER_API_KEY: '', DAILY_SCRIPT_BUDGET: '10' }, async () => {
      await callScript(u, '198.51.100.177'); assert.equal(alerts().length, 1);
      ctx.advance(5 * 3600_000); await callScript(u, '198.51.100.178'); assert.equal(alerts().length, 1, 'still inside the 6 h window');
      ctx.advance(61 * 60_000 + 1000); await callScript(u, '198.51.100.179'); assert.equal(alerts().length, 2, 'a reminder after 6 h');
    });
    return { actual: 'deduped per 6 h' };
  });

scenario('P5', 'the guard never changes a response: the script still answers 200 with privacy mode off, and a Telegram failure cannot break it',
  '200 / 200', async () => {
    _resetPrivacyModeLog();
    const u = await makeUser('p5', 'admin');
    const ok = await callScript(u, '198.51.100.180'); assert.equal(ok.status, 200);
    ctx.fresh(); _resetPrivacyModeLog(); providers.mode.telegram = '500';
    const u2 = await makeUser('p5b', 'admin');
    const r = await callScript(u2, '198.51.100.181'); assert.equal(r.status, 200); assert.equal(alerts().length, 1, 'the alert was attempted (and Telegram refused it)');
    return { actual: 'unchanged' };
  });
