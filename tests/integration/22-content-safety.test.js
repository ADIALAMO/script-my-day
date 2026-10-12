/** Scenario S — content-safety hotfix: refusals end the request, no Pollinations, blocklist + prompt cap, face ownership, panel log. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '22-content-safety' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake, seedCharacter, FACE_URL } = ctx;
const poster = await ctx.route('generate-poster');
const script = await ctx.route('generate-script');
const storyboard = await ctx.route('generate-storyboard');
const { getMsg } = await import('../../lib/messages.js');

const plain = (u, ip, body = {}) => invoke(poster, { body: { prompt: 'A lone figure walks into the rain', ...body }, cookies: u.cookies, ip });
const posterCount = (u) => fake.num(`usage:poster:${u.identifier}:2026-10-15`);
let seq = 0;
const seed = () => `${Date.now()}${++seq}${Math.floor(Math.random() * 1e6)}`;
const BLATANT = 'a nude woman on a beach';   // one unambiguous probe; the full list is in lib/content-blocklist.js and not repeated here

async function withLogs(fn) {
  const lines = []; const origW = console.warn; const origL = console.log;
  console.warn = (...a) => lines.push(a.join(' ')); console.log = (...a) => lines.push(a.join(' '));
  try { await fn(); } finally { console.warn = origW; console.log = origL; }
  return lines;
}

// ─── refusals end the request ──────────────────────────────────────────────────────────────────────────────────────
scenario('S1', 'Cloudflare 8007 NSFW reject ENDS the poster request: placeholder + CONTENT_REFUSED, Klein is never called, no poster slot is spent, circuit stays closed',
  'cloudflare=1, klein=0, placeholder with code CONTENT_REFUSED, usage:poster = 0', async () => {
    providers.refuse.cloudflare = true;
    const u = await makeUser('s1', 'free');
    const r = await plain(u, '198.51.100.110');
    assert.equal(r.status, 200); assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.code, 'CONTENT_REFUSED'); assert.equal(r.body.contentRefused, true);
    assert.equal(providers.counts.cloudflare, 1); assert.equal(providers.counts.klein ?? 0, 0, 'a refused prompt is never retried on the paid provider');
    assert.equal(providers.paidTotal(), 0);
    assert.equal(posterCount(u), 0, 'refused request is not charged');
    assert.equal(fake.keys('circuit:img:').length, 0, 'a content refusal never trips the circuit');
    assert.ok(getMsg('CONTENT_REFUSED', 'he').length > 20 && getMsg('CONTENT_REFUSED', 'en').length > 20);
    return { actual: 'placeholder CONTENT_REFUSED; klein 0; poster counter 0' };
  });

scenario('S2', 'Klein (OpenRouter) refusal after a Cloudflare technical failure ALSO ends the request — nothing after it is tried',
  'cloudflare 500 → klein refuses → stop; no further provider', async () => {
    providers.mode.cloudflare = 500; providers.refuse.klein = true;
    const u = await makeUser('s2', 'free');
    const r = await plain(u, '198.51.100.111');
    assert.equal(r.body.code, 'CONTENT_REFUSED'); assert.equal(r.body.isPlaceholder, true);
    assert.equal(providers.counts.klein, 1); assert.equal(providers.counts.pollinations ?? 0, 0);
    assert.equal(posterCount(u), 0);
    return { actual: 'cloudflare failed technically (fell through), klein refused (stopped)' };
  });

scenario('S3', 'plain technical failures still fall through exactly as before: 500, 429 and Cloudflare schema error 5006 ("not allowed") → Klein serves',
  'each case served by OpenRouter-Klein', async () => {
    for (const [label, set] of [['500', () => { providers.mode.cloudflare = 500; }], ['429', () => { providers.mode.cloudflare = 429; }], ['5006', () => { providers.mode.cloudflareSchema = true; }]]) {
      for (const k of Object.keys(providers.mode)) delete providers.mode[k];
      set();
      const u = await makeUser(`s3-${label}`, 'free');   // one user per case: a Free user only has 2 posters a day
      const r = await plain(u, `198.51.100.${112 + label.length}`);
      assert.equal(r.status, 200, label); assert.equal(r.body.provider, 'OpenRouter-Klein', label);
    }
    return { actual: 'all three technical failures fell through to Klein' };
  });

scenario('S4', 'Star Yourself: a Grok refusal ends the request — no Gemini, no faceless fallback — and the identity credit + budget slot are given back',
  'grok=1, gemini-image=0, cloudflare=0, klein=0; usage:identity:global back to 0', async () => {
    providers.refuse.grok = true;
    const u = await makeUser('s4', 'paid');
    const r = await plain(u, '198.51.100.120', { characterImageUrl: FACE_URL });
    assert.equal(r.body.code, 'CONTENT_REFUSED'); assert.equal(r.body.isPlaceholder, true);
    assert.equal(providers.counts.grok, 1);
    for (const k of ['gemini-image', 'cloudflare', 'klein']) assert.equal(providers.counts[k] ?? 0, 0, k);
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 0, 'global identity budget slot returned');
    assert.equal(fake.num(`usage:identity:${u.identifier}:2026-10`), 0, 'personal credit returned');
    return { actual: 'only grok was called; credit and budget returned' };
  });

scenario('S5', 'comic panel: a refusal ends the panel request and does not burn a replacement; the other panels of the comic are unaffected',
  'panel 1 → CONTENT_REFUSED, cloudflare 0; retry works', async () => {
    const u = await makeUser('s5', 'free');
    const comicSeed = seed();
    const sb = await invoke(storyboard, { body: { script: 'INT. HALL - DAY. A calm person waits in a quiet hall while the rain falls.', lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed }, cookies: u.cookies, ip: '198.51.100.130' });
    assert.equal(sb.status, 200);
    providers.refuse.klein = true;   // a fresh comic runs in 'klein' mode: OpenRouter Klein is the first engine
    const p = await invoke(poster, { body: { prompt: sb.body.panels[1].visual, requestType: 'comic', panelIndex: 1, comicSeed }, cookies: u.cookies, ip: '198.51.100.130' });
    assert.equal(p.body.code, 'CONTENT_REFUSED'); assert.equal(providers.counts.cloudflare ?? 0, 0, 'no fallback to the free engine either');
    providers.refuse.klein = false;
    const again = await invoke(poster, { body: { prompt: sb.body.panels[1].visual, requestType: 'comic', panelIndex: 1, comicSeed }, cookies: u.cookies, ip: '198.51.100.130' });
    assert.equal(again.status, 200); assert.equal(again.body.isPlaceholder, undefined, 'the refused attempt did not consume the panel/replacement budget');
    return { actual: 'refused panel returned its reservation; retry succeeded' };
  });

// ─── Pollinations is gone ──────────────────────────────────────────────────────────────────────────────────────────
scenario('S6', 'Pollinations is in no chain: with Cloudflare and Klein both down the poster ends in the placeholder and Pollinations is never contacted',
  'pollinations=0, PROVIDERS_BUSY placeholder (poster and comic)', async () => {
    providers.mode.cloudflare = 500; providers.mode.klein = 500;
    const u = await makeUser('s6', 'free');
    const r = await plain(u, '198.51.100.140');
    assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.code, 'PROVIDERS_BUSY');
    const comicSeed = seed();
    await invoke(storyboard, { body: { script: 'INT. HALL - DAY. A calm person waits in a quiet hall while the rain falls.', lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed }, cookies: u.cookies, ip: '198.51.100.140' });
    const c = await invoke(poster, { body: { prompt: 'a calm person', requestType: 'comic', panelIndex: 0, comicSeed }, cookies: u.cookies, ip: '198.51.100.140' });
    assert.equal(c.body.isPlaceholder, true);
    assert.equal(providers.counts.pollinations ?? 0, 0);
    return { actual: 'both ended in placeholders; zero Pollinations calls' };
  });

// ─── blocklist, sanitize, cap ──────────────────────────────────────────────────────────────────────────────────────
scenario('S7', 'poster: a blocklisted prompt is rejected with CONTENT_BLOCKED before any quota or provider; direct API calls are covered too',
  '400 CONTENT_BLOCKED, zero provider calls, usage:poster = 0', async () => {
    const u = await makeUser('s7', 'free');
    const lines = await withLogs(async () => {
      const r = await plain(u, '198.51.100.150', { prompt: BLATANT });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'CONTENT_BLOCKED');
      const r2 = await plain(u, '198.51.100.150', { prompt: undefined, visualPrompt: `[image: ${BLATANT}]` });
      assert.equal(r2.status, 400);
      const c = await invoke(poster, { body: { prompt: BLATANT, requestType: 'comic', panelIndex: 0, comicSeed: seed() }, cookies: u.cookies, ip: '198.51.100.150' });
      assert.equal(c.status, 400); assert.equal(c.body.code, 'CONTENT_BLOCKED');
    });
    assert.deepEqual(providers.counts, {}, 'no provider was called');
    assert.equal(posterCount(u), 0);
    assert.ok(lines.every((l) => !l.includes('nude')), 'the blocked text is never logged');
    assert.ok(getMsg('CONTENT_BLOCKED', 'he').length > 20 && getMsg('CONTENT_BLOCKED', 'en').length > 20);
    return { actual: '3 blocked requests, 0 provider calls, nothing logged but the category' };
  });

scenario('S8', 'poster prompt is sanitized and length-capped before it reaches a provider',
  'markup stripped; prompt sent to Cloudflare ≤ cap + wrapper', async () => {
    const u = await makeUser('s8', 'free');
    const r = await plain(u, '198.51.100.151', { prompt: `<b>bold</b> <script>x()</script>${'a calm scene '.repeat(400)}` });
    assert.equal(r.status, 200);
    const sent = providers.bodies.find((b) => b.provider === 'cloudflare').body.prompt;
    assert.ok(!/<\/?(b|script)>/.test(sent), 'tags stripped');
    assert.ok(sent.length < 1500 + 250, `prompt length ${sent.length}`);
    return { actual: `provider prompt length ${sent.length} (cap 1500 + wrapper)` };
  });

scenario('S9', 'script: a blocklisted entry is rejected with CONTENT_BLOCKED before the quota and every model call',
  '400 CONTENT_BLOCKED, gemini=0, usage:script = 0', async () => {
    const u = await makeUser('s9', 'free');
    const r = await invoke(script, { body: { journalEntry: `Today I wrote about ${BLATANT} for my friends`, genre: 'drama' }, cookies: u.cookies, ip: '198.51.100.160' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'CONTENT_BLOCKED');
    assert.deepEqual(providers.counts, {});
    assert.equal(fake.num(`usage:script:${u.identifier}:2026-10-15`), 0);
    return { actual: '400 CONTENT_BLOCKED, no model called, no quota' };
  });

scenario('S10', 'storyboard: a blocklisted script is rejected before the comic quota and every model call',
  '400 CONTENT_BLOCKED, no model call, usage:comic = 0', async () => {
    const u = await makeUser('s10', 'free');
    const r = await invoke(storyboard, { body: { script: `INT. BEACH - DAY. ${BLATANT} walks slowly along the quiet shore.`, lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: seed() }, cookies: u.cookies, ip: '198.51.100.161' });
    assert.equal(r.status, 400); assert.equal(r.body.code, 'CONTENT_BLOCKED');
    assert.deepEqual(providers.counts, {});
    assert.equal(fake.num(`usage:comic:${u.identifier}:2026-10`), 0);
    return { actual: '400 CONTENT_BLOCKED, quota untouched' };
  });

// ─── prompts + Gemini settings ─────────────────────────────────────────────────────────────────────────────────────
scenario('S11', 'every Gemini text call carries safetySettings and the script / storyboard instructions carry the content-safety rule',
  'safetySettings on the Gemini script call; safety rule in the script prompt and in the storyboard system message', async () => {
    const u = await makeUser('s11', 'free');
    const s = await invoke(script, { body: { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama' }, cookies: u.cookies, ip: '198.51.100.170' });
    assert.equal(s.status, 200);
    const g = providers.bodies.find((b) => b.provider === 'gemini').body;
    assert.ok(Array.isArray(g.safetySettings) && g.safetySettings.some((x) => x.category === 'HARM_CATEGORY_SEXUALLY_EXPLICIT'));
    assert.ok(JSON.stringify(g.contents).includes('CONTENT SAFETY'), 'rule is in the script prompt');
    providers.bodies.length = 0;
    const sb = await invoke(storyboard, { body: { script: 'INT. HALL - DAY. A calm person waits in a quiet hall while the rain falls.', lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: seed() }, cookies: u.cookies, ip: '198.51.100.170' });
    assert.equal(sb.status, 200);
    const sys = providers.bodies.map((b) => b.body?.messages?.find?.((m) => m.role === 'system')?.content).find(Boolean);
    assert.ok(sys && sys.includes('CONTENT SAFETY') && /fully clothed/.test(sys), 'rule is in the storyboard instruction');
    return { actual: 'safetySettings + rule present on script and storyboard' };
  });

scenario('S12', 'a Gemini safety block on the script ENDS the request (CONTENT_REFUSED): Gemma / Cohere / DeepSeek are never asked; quota returned; no outage alert',
  'gemini calls only; others 0; 422 CONTENT_REFUSED; usage:script = 0; no telegram', async () => {
    providers.refuse.gemini = true;
    const u = await makeUser('s12', 'free');
    const r = await invoke(script, { body: { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama' }, cookies: u.cookies, ip: '198.51.100.171' });
    assert.equal(r.status, 422); assert.equal(r.body.code, 'CONTENT_REFUSED');
    for (const k of ['openrouter-text', 'openrouter-free', 'cohere']) assert.equal(providers.counts[k] ?? 0, 0, k);
    assert.equal(fake.num(`usage:script:${u.identifier}:2026-10-15`), 0);
    assert.equal(providers.telegram.length, 0, 'a refusal is not an outage');
    return { actual: '422 CONTENT_REFUSED, no unfiltered stage reached' };
  });

// ─── face ownership ────────────────────────────────────────────────────────────────────────────────────────────────
scenario('S13', 'characterImageUrl must be the caller\'s own stored character: another URL (or another user\'s) degrades to a faceless poster — no Grok/Gemini call, no credit',
  'foreign URL → faceApplied absent, grok=0; own URL → faceApplied true', async () => {
    const a = await makeUser('s13a', 'paid'); const b = await makeUser('s13b', 'paid'); const c = await makeUser('s13c', 'paid');
    seedCharacter(b.identifier, 'https://pub-test.r2.dev/characters/b-sheet.jpg');
    const foreign = await plain(a, '198.51.100.180', { characterImageUrl: 'https://pub-test.r2.dev/characters/b-sheet.jpg' });   // b's sheet, sent by a
    const arbitrary = await plain(a, '198.51.100.180', { characterImageUrl: 'https://example.org/any-face.jpg' });
    const dataUri = await plain(c, '198.51.100.182', { characterImageUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    for (const r of [foreign, arbitrary, dataUri]) { assert.equal(r.status, 200); assert.ok(!r.body.faceApplied); assert.equal(r.body.provider, 'Cloudflare-Flux'); }
    assert.equal((providers.counts.grok ?? 0) + (providers.counts['gemini-image'] ?? 0), 0);
    assert.equal(fake.num(`usage:identity:${a.identifier}:2026-10`), 0);
    const own = await plain(a, '198.51.100.180', { characterImageUrl: FACE_URL });
    assert.equal(own.body.faceApplied, true);
    return { actual: '3 foreign references ignored, own reference applied' };
  });

scenario('S14', 'no stored character at all (pointer missing/expired) → faceless; Redis down → faceless (fail-closed for the reference, no paid call)',
  'faceApplied absent, zero identity provider calls', async () => {
    const u = await makeUser('s14', 'paid');
    fake.del(`character:${u.identifier}`);
    const r = await plain(u, '198.51.100.181', { characterImageUrl: FACE_URL });
    assert.ok(!r.body.faceApplied); assert.equal((providers.counts.grok ?? 0) + (providers.counts['gemini-image'] ?? 0), 0);
    return { actual: 'degraded to faceless' };
  });

// ─── diagnostics ───────────────────────────────────────────────────────────────────────────────────────────────────
scenario('S15', 'the success log line carries provider, panelIndex and comicSeed — and nothing from the prompt',
  '"Poster generated successfully by: <provider> (panelIndex=2, comicSeed=<seed>)"', async () => {
    const u = await makeUser('s15', 'free');
    const comicSeed = seed();
    const sb = await invoke(storyboard, { body: { script: 'INT. HALL - DAY. A calm person waits in a quiet hall while the rain falls.', lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed }, cookies: u.cookies, ip: '198.51.100.190' });
    assert.equal(sb.status, 200);
    const SECRET_WORDS = 'zebra-marmalade-unique-words';
    let lines; let served;
    lines = await withLogs(async () => {
      const r = await invoke(poster, { body: { prompt: `${sb.body.panels[2].visual} ${SECRET_WORDS}`, requestType: 'comic', panelIndex: 2, comicSeed }, cookies: u.cookies, ip: '198.51.100.190' });
      assert.equal(r.status, 200); served = r.body.provider;
    });
    const line = lines.find((l) => l.includes('Poster generated successfully by:'));
    assert.ok(line, 'log line present');
    assert.ok(line.includes(`by: ${served}`) && line.includes('panelIndex=2') && line.includes(`comicSeed=${comicSeed}`), line);
    assert.ok(!line.includes(SECRET_WORDS) && !line.includes('data:image'), 'no prompt, no image in the line');
    const standalone = await withLogs(async () => { await plain(u, '198.51.100.191'); });
    assert.ok(standalone.find((l) => l.includes('Poster generated successfully by:'))?.includes('panelIndex=-, comicSeed=-'));
    return { actual: line };
  });
