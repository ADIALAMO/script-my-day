/**
 * Scenario M — cost sanity. Simulates a whole month (31 UTC days, fake clock) of a maximally ABUSIVE Free user and
 * a maximally abusive Pro user against the REAL route handlers, counts every paid provider call, and prices it with
 * the unit prices documented in ai-cost-report.md (unverified prices are flagged). Three attack profiles:
 *   sequential          – hammers every endpoint politely, one request at a time (the "by design" ceiling)
 *   sequential+CFdown   – same, with the free image provider (Cloudflare) down so the PAID Klein fallback serves every image
 *   parallel+CFdown     – plus daily bursts of 20 parallel requests, which exploit the non-atomic poster/identity counters
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

// optional what-if: PRO_COMICS_PER_MONTH=6 npm run test:integration (the hermetic boot would otherwise wipe it)
const WHAT_IF = process.env.PRO_COMICS_PER_MONTH ? { PRO_COMICS_PER_MONTH: process.env.PRO_COMICS_PER_MONTH } : {};
const ctx = await boot({ file: '12-cost', startAt: '2026-10-01T00:00:00.000Z', env: WHAT_IF });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const script = await ctx.route('generate-script');
const poster = await ctx.route('generate-poster');
const storyboard = await ctx.route('generate-storyboard');
const upload = await ctx.route('upload-character');
const FACE = 'https://pub-test.r2.dev/characters/face.jpg';
const SCRIPT_BODY = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama' };
const SB_SCRIPT = 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.';

// ---- unit prices (USD per call) — see ai-cost-report.md §2.3 / §2.4 -------------------------------------------------
export const PRICES = {
  'gemini:gemini-2.5-flash':       { usd: 0.0084, note: 'Google list price × assumed 2.8k in / 3k out tokens (rates VERIFIED, tokens estimated); upper bound: the raced loser is really aborted' },
  'gemini:gemini-3-flash-preview': { usd: 0.0104, note: 'same basis' },
  'openrouter-text':               { usd: 0.0006, note: 'PAID (OpenRouter credits). Rates VERIFIED at openrouter.ai/api/v1/models for google/gemma-3-27b-it ($0.08 in / $0.45 out per M) × assumed ~2k in / 1k out tokens; tokens estimated' },
  klein:                           { usd: 0.014,  note: 'UNVERIFIED (KLEIN_COST_USD from OpenRouter logs, not an official page)' },
  grok:                            { usd: 0.06,   note: 'UNVERIFIED (code comment; OpenRouter page showed no price)' },
  'gemini-image':                  { usd: 0.039,  note: 'VERIFIED at Google direct; via OpenRouter UNVERIFIED' },
  cloudflare:                      { usd: 0,      note: 'free tier (≈115 images/day); marginal ≈$0.001 beyond it — UNVERIFIED exact' },
  pollinations: { usd: 0, note: 'free' }, moderation: { usd: 0, note: 'free model' },
};
const ILS = 3.7;

// FREE / PAID classification: Gemini called DIRECTLY with the owner's Google key is FREE ($0, but it consumes the
// project's shared free quota) when the key's plan is Free, PAID at list price when billing is enabled (plan UNKNOWN,
// see model-inventory.md). Everything else is the same under both plans: OpenRouter models are billed to credits.
function price(log) {
  const lines = {}; let usd = 0; let usdGeminiFree = 0; let geminiCalls = 0;
  for (const e of log) {
    const key = e.provider === 'gemini' ? `gemini:${e.model}` : e.provider;
    const p = PRICES[key]; if (!p) continue;
    lines[key] = (lines[key] || 0) + 1; usd += p.usd;
    if (e.provider === 'gemini') geminiCalls++; else usdGeminiFree += p.usd;
  }
  return { usd, usdGeminiFree, geminiCalls, lines };
}

const step = (ms) => ctx.advance(ms);
const burst = (n, fn) => Promise.all(Array.from({ length: n }, fn));

/** One whole month of abuse. `pro` toggles the attacker's tier. */
async function month({ kind, cloudflareDown, parallel }) {
  fake.flush(); providers.reset(); ctx.setNow('2026-10-01T00:00:00Z'); fake.control.failCommands.clear();
  if (cloudflareDown) providers.mode.cloudflare = 500;
  const u = await makeUser(`m-${kind}-${cloudflareDown ? 'cf' : 'ok'}-${parallel ? 'par' : 'seq'}`, kind);
  const ip = '198.18.0.1';
  const pro = kind !== 'free';
  const stats = { scripts: 0, posters: 0, comics: 0, panelImages: 0, uploads: 0, faceImages: 0 };
  const post = (body) => invoke(poster, { body, cookies: u.cookies, ip });
  for (let day = 0; day < 31; day++) {
    // --- race exploit FIRST thing in the day, while the daily poster / identity counters are still low ---
    if (parallel) {
      const withFace = pro ? day === 5 : day === 0;                      // Free: the single lifetime credit; Pro: one credit left of 30
      if (pro && day === 5) fake.set(`usage:identity:${u.identifier}:2026-10`, 29);
      const rs = await burst(20, () => post(withFace ? { prompt: 'burst', characterImageUrl: FACE } : { prompt: 'burst' }));
      stats.posters += rs.filter((r) => r.status === 200 && !r.body.isPlaceholder).length;
      step(130_000);
    }
    // --- character uploads: 8 attempts a day in batches of 4 per 5 minutes ---
    for (let i = 0; i < 8; i++) { const r = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: u.cookies, ip }); if (r.status === 200 && r.body.sheetGenerated) stats.uploads++; if (i % 4 === 3) step(11 * 60_000); }
    // --- scripts (attempt well over the cap, in rate-limit-friendly batches) ---
    for (let i = 0; i < (pro ? 26 : 8); i++) { if ((await invoke(script, { body: SCRIPT_BODY, cookies: u.cookies, ip })).status === 200) stats.scripts++; if (i % 10 === 9) step(130_000); }
    step(130_000);
    // --- face posters first (credit sink), then plain posters ---
    for (let i = 0; i < 4; i++) { const r = await post({ prompt: 'A hero walks', characterImageUrl: FACE }); if (r.body?.faceApplied) stats.faceImages++; }
    step(130_000);
    for (let i = 0; i < 6; i++) { const r = await post({ prompt: 'A lone figure in the rain' }); if (r.status === 200 && !r.body.isPlaceholder) stats.posters++; }
    step(70_000);
    // --- comics: open as many as allowed (try 5), then hammer every panel index with and without a face reference ---
    const opened = [];
    for (let i = 0; i < 5; i++) {
      const seed = `${day}${i}${Date.now()}`;
      const r = await invoke(storyboard, { body: { script: SB_SCRIPT, lang: 'en', genre: 'drama', comicSeed: seed }, cookies: u.cookies, ip });
      if (r.status === 200) { opened.push(seed); stats.comics++; }
    }
    step(70_000);
    for (const seed of opened) for (let round = 0; round < 4; round++) for (let idx = 0; idx < 7; idx++) {
      const r = await post({ prompt: 'a calm person', requestType: 'comic', panelIndex: idx, comicSeed: seed, ...(pro ? { characterImageUrl: FACE } : {}) });
      if (r.status === 200 && !r.body.isPlaceholder) stats.panelImages++;
      step(3_500);
    }
    ctx.setNow(new Date(Date.UTC(2026, 9, day + 2, 0, 5)).toISOString());
  }
  const { usd, usdGeminiFree, geminiCalls, lines } = price(providers.log);
  return { stats, usd, usdGeminiFree, geminiCalls, lines, calls: { ...providers.counts } };
}

const rows = [];
async function profile(label, kind, opts) {
  const t0 = Date.now();
  const r = await month({ kind, ...opts });
  rows.push({ label, kind, ...opts, ...r, seconds: ((Date.now() - t0) / 1000).toFixed(1) });
  return r;
}

scenario('M1', 'abusive FREE user, one month, sequential, free image provider healthy',
  'cost bounded by the quotas: scripts ≤155 (31×5), comics 3, uploads 3, ≤1 face image, ≤19 comic images', async () => {
    const r = await profile('free / sequential', 'free', { cloudflareDown: false, parallel: false });
    assert.ok(r.stats.scripts <= 31 * 5, `scripts ${r.stats.scripts}`);   // October has 31 UTC days
    assert.equal(r.stats.comics, 3);
    assert.equal(r.stats.uploads, 3);
    assert.ok(r.stats.faceImages <= 1, `face images ${r.stats.faceImages}`);
    assert.ok(r.stats.panelImages <= 19, `panel images ${r.stats.panelImages}`);
    return { actual: `stats ${JSON.stringify(r.stats)}; calls ${JSON.stringify(r.calls)}; cost $${r.usd.toFixed(2)} (₪${(r.usd * ILS).toFixed(2)})` };
  });
scenario('M2', 'abusive FREE user, sequential, Cloudflare DOWN (every image served by paid Klein)',
  'same counts; cost higher by the Klein price', async () => {
    const r = await profile('free / sequential / CF down', 'free', { cloudflareDown: true, parallel: false });
    return { actual: `stats ${JSON.stringify(r.stats)}; cost $${r.usd.toFixed(2)} (₪${(r.usd * ILS).toFixed(2)})` };
  });
scenario('M3', 'abusive FREE user with daily 20-request parallel bursts, Cloudflare down',
  'cost does not exceed the sequential ceiling (counters are atomic)', async () => {
    const seq = rows.find((x) => x.label === 'free / sequential / CF down');
    const r = await profile('free / parallel / CF down', 'free', { cloudflareDown: true, parallel: true });
    assert.ok(r.usd <= seq.usd * 1.05, `parallel abuse cost $${r.usd.toFixed(2)} vs sequential ceiling $${seq.usd.toFixed(2)} (Klein calls ${r.calls.klein} vs ${seq.calls.klein}; gemini-image ${r.calls['gemini-image']} vs ${seq.calls['gemini-image']})`);
    return { actual: `cost $${r.usd.toFixed(2)} (₪${(r.usd * ILS).toFixed(2)})` };
  });
scenario('M4', 'abusive PRO user, one month, sequential, free image provider healthy',
  'cost below the $9 (₪33) subscription price', async () => {
    const r = await profile('pro / sequential', 'paid', { cloudflareDown: false, parallel: false });
    assert.ok(r.stats.scripts <= 31 * 20, `scripts ${r.stats.scripts}`);
    assert.ok(r.usd < 9, `abusive Pro costs $${r.usd.toFixed(2)} (₪${(r.usd * ILS).toFixed(2)}) vs $9 revenue`);
    return { actual: `stats ${JSON.stringify(r.stats)}; cost $${r.usd.toFixed(2)} (₪${(r.usd * ILS).toFixed(2)})` };
  });
scenario('M5', 'abusive PRO user, sequential, Cloudflare DOWN',
  'cost below the $9 subscription price', async () => {
    const r = await profile('pro / sequential / CF down', 'paid', { cloudflareDown: true, parallel: false });
    assert.ok(r.usd < 9, `abusive Pro (CF down) costs $${r.usd.toFixed(2)} (₪${(r.usd * ILS).toFixed(2)}) vs $9 revenue`);
    return { actual: `stats ${JSON.stringify(r.stats)}; cost $${r.usd.toFixed(2)} (₪${(r.usd * ILS).toFixed(2)})` };
  });
scenario('M6', 'abusive PRO user with daily parallel bursts, Cloudflare down',
  'cost does not exceed the sequential ceiling', async () => {
    const seq = rows.find((x) => x.label === 'pro / sequential / CF down');
    const r = await profile('pro / parallel / CF down', 'paid', { cloudflareDown: true, parallel: true });
    assert.ok(r.usd <= seq.usd * 1.05, `parallel abuse cost $${r.usd.toFixed(2)} vs sequential ceiling $${seq.usd.toFixed(2)}`);
    return { actual: `cost $${r.usd.toFixed(2)} (₪${(r.usd * ILS).toFixed(2)})` };
  });

after(() => {
  const dir = path.join(path.dirname(new URL(import.meta.url).pathname), '.results'); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '12-cost-table.json'), JSON.stringify({ ils: ILS, prices: PRICES, profiles: rows.map((r) => ({ label: r.label, stats: r.stats, calls: r.calls, usd: +r.usd.toFixed(3), ils: +(r.usd * ILS).toFixed(2), usdIfGeminiFree: +r.usdGeminiFree.toFixed(3), geminiCallsPerMonth: r.geminiCalls, priced: r.lines, seconds: r.seconds })) }, null, 1));
});
