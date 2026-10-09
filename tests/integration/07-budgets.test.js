/**
 * Scenario H — global spend budgets (DAILY_IMAGE_BUDGET, DAILY_IDENTITY_BUDGET).
 * Run with NODE_ENV=production because the Telegram alert channel only fires in production.
 * DAILY_IMAGE_BUDGET=0.028 → 2 Klein calls/day (0.014 each); DAILY_IDENTITY_BUDGET=0.12 → 2 identity calls/day (0.06 each).
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '07-budgets', nodeEnv: 'production', env: { DAILY_IMAGE_BUDGET: '0.028', DAILY_IDENTITY_BUDGET: '0.12' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const poster = await ctx.route('generate-poster');
const storyboard = await ctx.route('generate-storyboard');
const upload = await ctx.route('upload-character');
const { getMsg } = await import('../../lib/messages.js');
const { _resetBudgetAlertMemory } = await import('../../lib/budget-alerts.js');
const FACE = 'https://pub-test.r2.dev/characters/face.jpg';
const IMG = (d = '2026-10-15') => `usage:image:paid:global:${d}`;
const IDN = (d = '2026-10-15') => `usage:identity:global:${d}`;

/** capture console.warn for the duration of fn */
async function withLogs(fn) {
  const lines = []; const orig = console.warn;
  console.warn = (...a) => lines.push(a.join(' '));
  try { await fn(lines); } finally { console.warn = orig; }
  return lines;
}
const budgetLines = (lines, name) => lines.filter((l) => l.includes('BUDGET REACHED') && l.includes(name));
const plain = (u, ip) => invoke(poster, { body: { prompt: 'A lone figure walks into the rain' }, cookies: u.cookies, ip });
const face = (u, ip) => invoke(poster, { body: { prompt: 'A hero walks forward', characterImageUrl: FACE }, cookies: u.cookies, ip });
const reset = () => { _resetBudgetAlertMemory(); };

scenario('H1', 'image budget: after 2 paid Klein images the paid provider is dropped (free Pollinations serves), ONE log line and ONE Telegram message per day — not per request; a new UTC day alerts again',
  'klein stays 2; pollinations used; 1 log line + 1 telegram on day 1 (after 2 more requests); day 2 → a second alert', async () => {
    reset(); providers.mode.cloudflare = 500;
    const users = []; for (let i = 0; i < 6; i++) users.push(await makeUser(`h1-${i}`, 'free'));
    const lines = await withLogs(async () => {
      for (let i = 0; i < 2; i++) { const r = await plain(users[i], '198.51.100.80'); assert.equal(r.body.provider, 'OpenRouter-Klein'); }
      assert.equal(fake.num(IMG()), 2);
      assert.equal(providers.telegram.length, 0, 'no alert while under the cap');
      for (let i = 2; i < 5; i++) { const r = await plain(users[i], '198.51.100.80'); assert.equal(r.status, 200); assert.equal(r.body.provider, 'Pollinations-Flux', `request ${i + 1} must be served by the free provider`); }
    });
    assert.equal(providers.counts.klein, 2, 'Klein never called again once capped');
    assert.ok(providers.counts.pollinations >= 3);
    assert.equal(budgetLines(lines, 'DAILY_IMAGE_BUDGET').length, 1, `log lines: ${budgetLines(lines, 'DAILY_IMAGE_BUDGET')}`);
    assert.equal(providers.telegram.length, 1);
    const tg = providers.telegram[0];
    assert.match(tg, /DAILY\\_IMAGE\\_BUDGET/); assert.match(tg, /Count: 2 \/ limit: 2/);
    assert.ok(!/@test\.example|198\.51\.100|h1-/.test(tg + budgetLines(lines, 'DAILY_IMAGE_BUDGET').join()), 'no user data in the alert');
    // next UTC day: counter resets, cap is reached again → exactly one more alert
    ctx.setNow('2026-10-16T00:05:00Z'); reset(); delete providers.mode.cloudflare; providers.mode.cloudflare = 500;
    await withLogs(async () => {
      const a = await makeUser('h1-d2a', 'free'); const b = await makeUser('h1-d2b', 'free'); const c = await makeUser('h1-d2c', 'free'); const d = await makeUser('h1-d2d', 'free');
      for (const u of [a, b, c, d]) await plain(u, '198.51.100.81');
    });
    assert.equal(providers.telegram.length, 2, 'one alert per budget per day');
    return { actual: `klein=2, free fallback served 3, log lines 1, telegram 1 on day 1; telegram total 2 after day 2`, evidence: `telegram text: ${JSON.stringify(tg)}` };
  });

scenario('H2', 'image budget + every free provider failing → the placeholder carries IMAGE_BUDGET_REACHED (honest message he/en), not the generic "providers busy"',
  'success:true isPlaceholder:true code=IMAGE_BUDGET_REACHED; quota not charged', async () => {
    reset(); providers.mode.cloudflare = 500;
    const u1 = await makeUser('h2a', 'free'); const u2 = await makeUser('h2b', 'free'); const u3 = await makeUser('h2c', 'free');
    await plain(u1, '198.51.100.82'); await plain(u2, '198.51.100.82');
    providers.mode.pollinations = 500;
    const r = await plain(u3, '198.51.100.82');
    assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.code, 'IMAGE_BUDGET_REACHED');
    assert.equal(fake.num(`usage:poster:${u3.identifier}:2026-10-15`), 0);
    const en = getMsg('IMAGE_BUDGET_REACHED', 'en'); const he = getMsg('IMAGE_BUDGET_REACHED', 'he');
    assert.ok(/capacity/i.test(en) && he.length > 20, `${en} / ${he}`);
    return { actual: `placeholder code ${r.body.code}; EN "${en}"`, evidence: `HE "${he}"` };
  });

scenario('H3', 'image budget reached → a NEW comic is switched to the free cascade for all its panels (comic:mode = free), Klein not used',
  'comic:mode:<seed> = free; panels served by Cloudflare/Pollinations; klein unchanged', async () => {
    reset();
    const a = await makeUser('h3a', 'free'); const b = await makeUser('h3b', 'free');
    providers.mode.cloudflare = 500;
    await plain(a, '198.51.100.83'); await plain(b, '198.51.100.83');       // spend the 2 Klein calls
    const kl = providers.counts.klein; delete providers.mode.cloudflare;
    const u = await makeUser('h3c', 'free');
    const sb = await invoke(storyboard, { body: { script: 'INT. BEACH - DAY. A family laughs together by the water while the sun sets.', lang: 'en', genre: 'drama', comicSeed: '92000000001' }, cookies: u.cookies, ip: '198.51.100.84' });
    assert.equal(sb.status, 200);
    assert.equal(fake.get('comic:mode:92000000001'), 'free');
    for (let i = 0; i < 3; i++) assert.equal((await invoke(poster, { body: { prompt: 'a calm person', requestType: 'comic', panelIndex: i, comicSeed: '92000000001' }, cookies: u.cookies, ip: '198.51.100.84' })).status, 200);
    assert.equal(providers.counts.klein, kl, 'no paid image for the capped comic');
    return { actual: `comic:mode=free; 3 panels via ${JSON.stringify({ cloudflare: providers.counts.cloudflare })}; klein unchanged (${kl})` };
  });

scenario('H4', 'identity budget: after 2 identity generations the next face poster degrades to FACELESS with an explicit IDENTITY_BUDGET_REACHED message; ONE log line + ONE Telegram message',
  'grok=2, 3rd/4th: identityDegraded + code, faceless image; 1 log, 1 telegram', async () => {
    reset();
    const u = await makeUser('h4', 'paid');
    const lines = await withLogs(async () => {
      for (let i = 0; i < 2; i++) { const r = await face(u, '198.51.100.85'); assert.equal(r.body.faceApplied, true, `face poster ${i + 1}`); }
      assert.equal(fake.num(IDN()), 2);
      const r3 = await face(u, '198.51.100.85');
      assert.equal(r3.status, 200); assert.equal(r3.body.identityDegraded, true); assert.equal(r3.body.code, 'IDENTITY_BUDGET_REACHED');
      assert.notEqual(r3.body.faceApplied, true);
      const other = await makeUser('h4b', 'adminGranted');
      const r4 = await face(other, '198.51.100.86');
      assert.equal(r4.body.identityDegraded, true); assert.equal(r4.body.code, 'IDENTITY_BUDGET_REACHED');
    });
    assert.equal(providers.counts.grok, 2, 'no identity generation beyond the budget');
    assert.equal(budgetLines(lines, 'DAILY_IDENTITY_BUDGET').length, 1);
    assert.equal(providers.telegram.filter((t) => /IDENTITY/.test(t)).length, 1);
    assert.match(providers.telegram.find((t) => /IDENTITY/.test(t)), /Count: 2 \/ limit: 2/);
    const en = getMsg('IDENTITY_BUDGET_REACHED', 'en'), he = getMsg('IDENTITY_BUDGET_REACHED', 'he');
    assert.ok(/paused/i.test(en) && he.length > 20);
    return { actual: `faceless + identityDegraded/IDENTITY_BUDGET_REACHED; EN "${en}"`, evidence: `HE "${he}"` };
  });

scenario('H5', 'identity budget reached → character upload is refused EXPLICITLY (503 IDENTITY_BUDGET_REACHED), nothing reserved/stored, no paid call',
  '503, sheet counter 0, no R2 write, no grok/gemini-image', async () => {
    reset();
    const p = await makeUser('h5p', 'paid');
    await face(p, '198.51.100.87'); await face(p, '198.51.100.87');            // spend the budget (2)
    const g = (providers.counts.grok || 0) + (providers.counts['gemini-image'] || 0);
    const u = await makeUser('h5', 'free');
    const r = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: u.cookies, ip: '198.51.100.88' });
    assert.equal(r.status, 503); assert.equal(r.body.code, 'IDENTITY_BUDGET_REACHED');
    assert.equal((providers.counts.grok || 0) + (providers.counts['gemini-image'] || 0), g);
    assert.equal(providers.s3puts.length, 0);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0, 'quota slot returned');
    assert.equal(fake.num(IDN()), 2, 'global counter not inflated by the refused upload');
    return { actual: '503 IDENTITY_BUDGET_REACHED; nothing stored; slot returned' };
  });

scenario('H6', 'Redis outage fails CLOSED on spend: no Klein, no identity generation — the request is still served by a free provider',
  '200 from Cloudflare, klein=0, grok/gemini-image=0', async () => {
    reset();
    const u = await makeUser('h6', 'paid');
    fake.control.downEverything = true;
    const lines = await withLogs(async () => {
      const r = await plain(u, '198.51.100.89');
      // with the whole Redis down the tier lookup also fails open to 'free', so only the free cascade is reachable
      assert.equal(r.status, 200);
      const f = await face(u, '198.51.100.89');
      assert.equal(f.status, 200); assert.notEqual(f.body.faceApplied, true);
    });
    fake.control.downEverything = false;
    assert.equal(providers.counts.klein || 0, 0);
    assert.equal((providers.counts.grok || 0) + (providers.counts['gemini-image'] || 0), 0);
    return { actual: 'poster + face poster both served by the free cascade; zero paid calls during the outage', evidence: `warnings logged: ${lines.length}` };
  });
