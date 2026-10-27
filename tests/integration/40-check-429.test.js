/**
 * Scenario R — HTTP 429 on the paid SAFETY CHECKS (image fallback, second opinion, text classifier, minor screen).
 * One retry inside the call's own budget (jitter; none when Retry-After > 1.5 s), a failed retry stays fail-closed exactly as before, 429s are logged
 * (sanitized) and counted, the four check circuits pause 10 s (everything else keeps its duration), and the credit path (402 / key-limit 403) is untouched.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '40-check-429', nodeEnv: 'production' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const poster = await ctx.route('generate-poster');
const script = await ctx.route('generate-script');
const upload = await ctx.route('upload-character');
const cb = await import('../../lib/circuit-breaker.js');
const redis = (await import('../../lib/redis.js')).default;

const DAY = '2026-10-15';
const callPoster = (u, ip = '198.51.100.100') => invoke(poster, { body: { prompt: 'A lone figure walks into a neon-lit rainy street' }, cookies: u.cookies, ip });
const callScript = (u, genre, ip = '198.51.100.101') => invoke(script, { body: { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre, gender: 'neutral' }, cookies: u.cookies, ip });
const callUpload = (u, ip = '198.51.100.102') => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip });
const c429 = (name) => fake.num(`stats:ratelimit429:${DAY}:${name}`);
const openFor = (name) => { const v = fake.get(`circuit:img:${name}`); return v ? JSON.parse(v).openUntil - Date.now() : null; };
const calls = (k) => providers.counts[k] ?? 0;
const imgSafetySlot = () => fake.num(`usage:check:imgsafety:global:${DAY}`);
const capture = async (fn) => { const lines = []; const orig = console.warn; console.warn = (...a) => { lines.push(a.join(' ')); }; try { return { result: await fn(), lines }; } finally { console.warn = orig; } };

scenario('R1', 'second opinion: 429 once, then OK → the poster passes (marker set), 2 calls, ONE budget slot, circuit stays closed, no alert; the 429 is counted',
  'real poster; gemini-imgsafety 2; slot 1; no circuit; counter 1; no telegram', async () => {
    providers.mode['gemini-imgsafety'] = '429x1';
    const u = await makeUser('r1', 'admin');
    const r = await callPoster(u);
    assert.equal(r.status, 200); assert.equal(r.body.isPlaceholder, undefined); assert.equal(r.body.provider, 'Cloudflare-Flux');
    assert.equal(fake.keys('imgok:').length, 1, 'the approved image carries its marker');
    assert.equal(calls('gemini-imgsafety'), 2); assert.equal(imgSafetySlot(), 1, 'one billed check = one slot');
    assert.equal(openFor('check_imgsafety'), null, 'a retried-and-recovered 429 opens nothing');
    assert.equal(c429('check_imgsafety'), 1); assert.equal(providers.telegram.length, 0);
    return { actual: 'passed after one retry' };
  });

scenario('R2', 'second opinion: 429 twice → exactly as before (fail-closed): placeholder CONTENT_CHECK_UNAVAILABLE, no marker, nothing stored, slot given back, circuit 10 s, no credit alert',
  'placeholder CONTENT_CHECK_UNAVAILABLE; 2 calls; slot 0; circuit ≤ 10 s; counter 2', async () => {
    providers.mode['gemini-imgsafety'] = '429';
    const u = await makeUser('r2', 'admin');
    const r = await callPoster(u);
    assert.equal(r.status, 200); assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.checkUnavailable, true); assert.equal(r.body.serviceUnavailable, undefined);
    assert.ok(r.body.imageUrl.startsWith('data:image/svg+xml'));
    assert.deepEqual(fake.keys('imgok:'), []); assert.equal(providers.s3puts.length, 0);
    assert.equal(calls('gemini-imgsafety'), 2); assert.equal(imgSafetySlot(), 0, 'failed technically: the slot is released');
    const left = openFor('check_imgsafety'); assert.ok(left > 0 && left <= 10_000 + 1000, `pause ${left} ms`);
    assert.equal(c429('check_imgsafety'), 2); assert.equal(providers.telegram.length, 0, '429 is not a credit failure');
    ctx.advance(11_000);                                            // the 10 s pause is over → the next poster passes
    delete providers.mode['gemini-imgsafety'];
    const again = await callPoster(u, '198.51.100.103');
    assert.equal(again.body.isPlaceholder, undefined, 'back to normal after 10 s, not 45 s');
    return { actual: 'withheld, pause 10 s, recovered' };
  });

scenario('R3', 'Retry-After > 1.5 s → NO retry (one call), fails as before; the header value is in the log',
  '1 call; CONTENT_CHECK_UNAVAILABLE; log shows retry-after=3000ms', async () => {
    providers.mode['gemini-imgsafety'] = '429'; providers.rate429.retryAfter = 3;
    const u = await makeUser('r3', 'admin');
    const { result: r, lines } = await capture(() => callPoster(u));
    assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(calls('gemini-imgsafety'), 1, 'no early retry against a server that asked us to wait');
    assert.ok(lines.some((l) => /HTTP 429 on check_imgsafety/.test(l) && /retry-after=3000ms/.test(l)), lines.join('\n'));
    assert.equal(c429('check_imgsafety'), 1);
    return { actual: 'no retry' };
  });

scenario('R3b', 'Retry-After 1 s (<= 1.5 s) → the retry waits that long, then passes',
  '2 calls; elapsed >= ~1 s; poster passes', async () => {
    providers.mode['gemini-imgsafety'] = '429x1'; providers.rate429.retryAfter = 1;
    const u = await makeUser('r3b', 'admin');
    const t0 = performance.now(); const r = await callPoster(u); const ms = performance.now() - t0;
    assert.equal(r.body.isPlaceholder, undefined); assert.equal(calls('gemini-imgsafety'), 2); assert.ok(ms >= 950, `waited ${ms} ms`);
    return { actual: `waited ~${Math.round(ms)} ms` };
  });

scenario('R4', 'image fallback (Nemotron down): 429 once → retried → the image passes via the fallback; 429 always → CONTENT_CHECK_UNAVAILABLE and check_gemini pauses 10 s',
  'pass with 2 fallback calls; then withheld, pause ≤ 10 s', async () => {
    providers.mode.moderation = '500'; providers.mode['gemini-check'] = '429x1';
    const u = await makeUser('r4', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.isPlaceholder, undefined); assert.equal(calls('gemini-check'), 2); assert.equal(openFor('check_gemini'), null);
    ctx.fresh(); providers.mode.moderation = '500'; providers.mode['gemini-check'] = '429';
    const u2 = await makeUser('r4b', 'admin');
    const w = await callPoster(u2, '198.51.100.104');
    assert.equal(w.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(calls('gemini-check'), 2); assert.deepEqual(fake.keys('imgok:'), []);
    assert.ok(openFor('check_gemini') <= 10_000 + 1000);
    return { actual: 'retry works; double 429 fail-closed' };
  });

scenario('R5', 'text classifier (romance, fail-closed): 429 once → served; 429 always → 503 CONTENT_CHECK_UNAVAILABLE, script slot back, check_text pauses 10 s',
  '200; then 503 CONTENT_CHECK_UNAVAILABLE', async () => {
    providers.mode['gemini-check-text'] = '429x1';
    const u = await makeUser('r5', 'admin');
    const ok = await callScript(u, 'romance');
    assert.equal(ok.status, 200); assert.equal(providers.log.filter((l) => l.provider === 'gemini-check' && !l.hasImage).length, 2);
    ctx.fresh(); providers.mode['gemini-check-text'] = '429';
    const u2 = await makeUser('r5b', 'free');
    const bad = await callScript(u2, 'romance', '198.51.100.105');
    assert.equal(bad.status, 503); assert.equal(bad.body.code, 'CONTENT_CHECK_UNAVAILABLE');
    assert.equal(fake.num(`usage:script:${u2.identifier}:${DAY}`), 0, 'slot back');
    assert.ok(openFor('check_text') <= 10_000 + 1000);
    return { actual: 'retry then served; double 429 fail-closed' };
  });

scenario('R6', 'minor screen: 429 once → the upload goes through; 429 always → 503 PHOTO_CHECK_UNAVAILABLE, nothing stored, check_minor pauses 10 s',
  '200 sheet; then 503 PHOTO_CHECK_UNAVAILABLE', async () => {
    providers.mode['gemini-check-age'] = '429x1';
    const u = await makeUser('r6', 'free');
    const ok = await callUpload(u);
    assert.equal(ok.status, 200); assert.equal(ok.body.sheetGenerated, true);
    ctx.fresh(); providers.mode['gemini-check-age'] = '429';
    const u2 = await makeUser('r6b', 'free');
    const bad = await callUpload(u2, '198.51.100.106');
    assert.equal(bad.status, 503); assert.equal(bad.body.code, 'PHOTO_CHECK_UNAVAILABLE'); assert.equal(providers.s3puts.length, 0);
    assert.ok(openFor('check_minor') <= 10_000 + 1000);
    return { actual: 'retry then accepted; double 429 fail-closed' };
  });

scenario('R7', 'the credit path is untouched: 402 and a key-limit 403 are NOT retried (one call each) and still answer SERVICE_UNAVAILABLE with the 5-minute pause',
  '1 call each; SERVICE_UNAVAILABLE; 5 min', async () => {
    for (const mode of ['402', '403:keylimit']) {
      ctx.fresh(); providers.mode['gemini-imgsafety'] = mode;
      const u = await makeUser(`r7-${mode.length}`, 'admin');
      const r = await callPoster(u, '198.51.100.107');
      assert.equal(r.body.code, 'SERVICE_UNAVAILABLE', mode); assert.equal(calls('gemini-imgsafety'), 1, `${mode}: no retry`);
      const left = openFor('check_imgsafety'); assert.ok(left > 10_000 && left <= 5 * 60_000 + 1000, `${mode}: ${left}`);
      assert.equal(c429('check_imgsafety'), 0, `${mode}: not counted as a 429`);
    }
    return { actual: 'unchanged' };
  });

scenario('R8', 'Nemotron (now a paid check like the others): its own retry still works, its 429 is counted, and its circuit pauses 10 s; generation providers keep 45 s, other statuses are as before',
  'passes after Nemotron retry; the five check circuits 10 s; generation providers 45 s; 503 20 s; 500 15 s', async () => {
    providers.mode.moderation = '429x1';
    const u = await makeUser('r8', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.isPlaceholder, undefined); assert.equal(calls('moderation'), 2); assert.equal(openFor('check_nemotron'), null); assert.equal(c429('check_nemotron'), 1);
    ctx.fresh();
    const dur = async (name, status) => { await cb.recordFailure(redis, name, status); return openFor(name); };
    for (const name of ['check_nemotron', 'check_gemini', 'check_imgsafety', 'check_text', 'check_minor']) {
      const d = await dur(name, 429); assert.ok(d > 0 && d <= 10_000 + 1000, `${name} 429: ${d}`);
    }
    for (const name of ['cloudflare', 'openrouter', 'script_paid', 'storyboard_gemini', 'grok_identity']) {
      const d = await dur(name, 429); assert.ok(d > 40_000 && d <= 45_000 + 1000, `${name} 429: ${d}`);
    }
    const d503 = await dur('check_text', 503); assert.ok(d503 > 10_000 && d503 <= 20_000 + 1000, `check_text 503: ${d503}`);
    const d500 = await dur('check_minor', 500); assert.ok(d500 > 10_000 && d500 <= 15_000 + 1000, `check_minor 500: ${d500}`);
    return { actual: 'unchanged apart from the four check circuits' };
  });

scenario('R9', 'the 429 log line is sanitized: provider and a short message only — no URL, key id, e-mail, non-ASCII text or request content; the line is bounded',
  'log has provider=Google AI Studio and [url]/[email]/[id], nothing else', async () => {
    providers.rate429.body = JSON.stringify({ error: { message: 'Provider returned error: see https://openrouter.ai/workspaces/default/keys/abcdef0123456789abcdef01 and mail me@example.com', code: 429,
      metadata: { provider_name: 'Google AI Studio', raw: 'Resource has been exhausted (e.g. check quota). שלום ' + 'x'.repeat(500) } } });
    providers.mode['gemini-imgsafety'] = '429';
    const u = await makeUser('r9', 'admin');
    const { lines } = await capture(() => callPoster(u));
    const line = lines.find((l) => /HTTP 429 on check_imgsafety/.test(l)); assert.ok(line, lines.join('\n'));
    assert.match(line, /provider=Google AI Studio/); assert.match(line, /code=429/);
    assert.ok(!/https?:|workspaces|abcdef0123|@|שלום|data:image|neon-lit/.test(line), line); assert.ok(line.length < 520, `${line.length} chars`);
    return { actual: line.slice(0, 200) };
  });
