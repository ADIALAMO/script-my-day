/**
 * Scenario R — HTTP 429 on the paid SAFETY CHECKS (image fallback, second opinion, text classifier, minor screen).
 * One retry inside the call's own budget, on a SIBLING model (IMAGE_CHECK_RETRY_MODEL, default google/gemini-2.5-flash; empty = the same model) with a short jitter
 * (a longer one when it is the same model; none and no sibling call when Retry-After > 1.5 s). A failed retry stays fail-closed exactly as before, "unsafe" from either
 * model is final, 429s are logged (sanitized) and counted, the Gemini circuits check_imgsafety / check_gemini pause 3 s (the other check circuits 10 s, generation
 * providers 45 s), and the credit path (402 / key-limit 403) is untouched.
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
const modelsSentTo = (providerKey) => providers.bodies.filter((b) => b.provider === providerKey).map((b) => b.body.model);
const withRetryModel = async (value, fn) => { const prev = process.env.IMAGE_CHECK_RETRY_MODEL; if (value === undefined) delete process.env.IMAGE_CHECK_RETRY_MODEL; else process.env.IMAGE_CHECK_RETRY_MODEL = value; try { return await fn(); } finally { if (prev === undefined) delete process.env.IMAGE_CHECK_RETRY_MODEL; else process.env.IMAGE_CHECK_RETRY_MODEL = prev; } };

scenario('R1', 'second opinion: 429 on flash-lite → ONE retry on the SIBLING model (gemini-2.5-flash) → the poster passes (marker set), ONE budget slot, circuit closed, no alert; the 429 is counted',
  'real poster; flash-lite 1 call, sibling 1 call; slot 1; no circuit; counter 1; no telegram; short pause', async () => {
    providers.mode['gemini-imgsafety'] = '429x1';
    const u = await makeUser('r1', 'admin');
    const t0 = performance.now(); const r = await callPoster(u); const ms = performance.now() - t0;
    assert.equal(r.status, 200); assert.equal(r.body.isPlaceholder, undefined); assert.equal(r.body.provider, 'Cloudflare-Flux');
    assert.equal(fake.keys('imgok:').length, 1, 'the approved image carries its marker');
    assert.equal(calls('gemini-imgsafety'), 1); assert.equal(calls('gemini-retry'), 1);
    assert.deepEqual(modelsSentTo('gemini-retry'), ['google/gemini-2.5-flash']); assert.equal(providers.bodies.find((b) => b.provider === 'gemini-retry').body.provider.data_collection, 'deny');
    assert.deepEqual(providers.bodies.find((b) => b.provider === 'gemini-retry').body.reasoning, { effort: 'none' }, 'the thinking model is told not to think (tiny max_tokens)');
    assert.equal(providers.bodies.find((b) => b.provider === 'gemini-imgsafety').body.reasoning, undefined, 'the first model\'s request is unchanged');
    assert.equal(imgSafetySlot(), 1, 'one billed check = one slot');
    assert.equal(openFor('check_imgsafety'), null, 'a retried-and-recovered 429 opens nothing');
    assert.equal(c429('check_imgsafety'), 1); assert.equal(providers.telegram.length, 0);
    assert.ok(ms < 2500, `a different model gets the SHORT jitter, not the long one (${Math.round(ms)} ms)`);
    return { actual: `passed on the sibling after ${Math.round(ms)} ms` };
  });

scenario('R1b', 'SAME-model branch (IMAGE_CHECK_RETRY_MODEL set empty): the retry goes back to flash-lite after the LONGER 1.5-2.0 s jitter',
  'flash-lite 2 calls; sibling 0; elapsed >= 1.45 s', async () => {
    providers.mode['gemini-imgsafety'] = '429x1';
    const u = await makeUser('r1b', 'admin');
    const t0 = performance.now(); const r = await withRetryModel('', () => callPoster(u)); const ms = performance.now() - t0;
    assert.equal(r.body.isPlaceholder, undefined); assert.equal(calls('gemini-imgsafety'), 2); assert.equal(calls('gemini-retry'), 0);
    assert.ok(ms >= 1450 && ms < 4500, `waited ${Math.round(ms)} ms`);
    assert.equal(c429('check_imgsafety'), 1);
    return { actual: `same model after ${Math.round(ms)} ms` };
  });

scenario('R2', 'second opinion: 429 on BOTH models → exactly as before (fail-closed): placeholder CONTENT_CHECK_UNAVAILABLE, no marker, nothing stored, slot given back, circuit 3 s, no credit alert',
  'placeholder CONTENT_CHECK_UNAVAILABLE; 1+1 calls; slot 0; circuit ≤ 3 s; counters flash-lite 1 + retry 1', async () => {
    providers.mode['gemini-imgsafety'] = '429'; providers.mode['gemini-retry'] = '429';
    const u = await makeUser('r2', 'admin');
    const r = await callPoster(u);
    assert.equal(r.status, 200); assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.checkUnavailable, true); assert.equal(r.body.serviceUnavailable, undefined);
    assert.ok(r.body.imageUrl.startsWith('data:image/svg+xml'));
    assert.deepEqual(fake.keys('imgok:'), []); assert.equal(providers.s3puts.length, 0);
    assert.equal(calls('gemini-imgsafety'), 1); assert.equal(calls('gemini-retry'), 1); assert.equal(imgSafetySlot(), 0, 'failed technically: the slot is released');
    const left = openFor('check_imgsafety'); assert.ok(left > 0 && left <= 3_000 + 1000, `pause ${left} ms`);
    assert.equal(c429('check_imgsafety'), 1); assert.equal(c429('check_imgsafety_retry'), 1, 'the sibling\'s own 429 is counted separately (is it rate-limited at the same moment?)');
    assert.equal(providers.telegram.length, 0, '429 is not a credit failure');
    ctx.advance(4_000);                                            // the 3 s pause is over → the next poster passes
    delete providers.mode['gemini-imgsafety']; delete providers.mode['gemini-retry'];
    const again = await callPoster(u, '198.51.100.103');
    assert.equal(again.body.isPlaceholder, undefined, 'back to normal after 3 s');
    return { actual: 'withheld, pause 3 s, recovered' };
  });

scenario('R2b', 'the SAME-model branch also stays fail-closed on a double 429 (2 calls on flash-lite, slot back)',
  'CONTENT_CHECK_UNAVAILABLE; flash-lite 2; sibling 0', async () => {
    providers.mode['gemini-imgsafety'] = '429';
    const u = await makeUser('r2b', 'admin');
    const r = await withRetryModel('', () => callPoster(u));
    assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(calls('gemini-imgsafety'), 2); assert.equal(calls('gemini-retry'), 0); assert.equal(imgSafetySlot(), 0);
    assert.deepEqual(fake.keys('imgok:'), []);
    return { actual: 'withheld' };
  });

scenario('R3', 'Retry-After > 1.5 s → NO retry at all (no sibling call either), fails as before; the header value is in the log',
  'flash-lite 1 call; sibling 0; CONTENT_CHECK_UNAVAILABLE; log shows retry-after=3000ms', async () => {
    providers.mode['gemini-imgsafety'] = '429'; providers.rate429.retryAfter = 3;
    const u = await makeUser('r3', 'admin');
    const { result: r, lines } = await capture(() => callPoster(u));
    assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(calls('gemini-imgsafety'), 1, 'no early retry against a server that asked us to wait'); assert.equal(calls('gemini-retry'), 0);
    assert.ok(lines.some((l) => /HTTP 429 on check_imgsafety/.test(l) && /retry-after=3000ms/.test(l)), lines.join('\n'));
    assert.equal(c429('check_imgsafety'), 1);
    return { actual: 'no retry' };
  });

scenario('R3b', 'Retry-After 1 s (<= 1.5 s) → the retry (on the sibling) waits exactly that long, then passes',
  'sibling 1 call; elapsed >= ~1 s; poster passes', async () => {
    providers.mode['gemini-imgsafety'] = '429x1'; providers.rate429.retryAfter = 1;
    const u = await makeUser('r3b', 'admin');
    const t0 = performance.now(); const r = await callPoster(u); const ms = performance.now() - t0;
    assert.equal(r.body.isPlaceholder, undefined); assert.equal(calls('gemini-imgsafety'), 1); assert.equal(calls('gemini-retry'), 1); assert.ok(ms >= 950 && ms < 2500, `waited ${Math.round(ms)} ms`);
    return { actual: `waited ~${Math.round(ms)} ms` };
  });

scenario('R4', 'image fallback (Nemotron down): 429 once → the sibling answers → the image passes via the fallback; 429 on both → CONTENT_CHECK_UNAVAILABLE and check_gemini pauses 3 s',
  'pass with 1+1 calls; then withheld, pause ≤ 3 s', async () => {
    providers.mode.moderation = '500'; providers.mode['gemini-check'] = '429x1';
    const u = await makeUser('r4', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.isPlaceholder, undefined); assert.equal(calls('gemini-check'), 1); assert.equal(calls('gemini-retry'), 1); assert.equal(openFor('check_gemini'), null);
    assert.equal(providers.bodies.find((b) => b.provider === 'gemini-retry').body.response_format.json_schema.name, 'safety_verdict');
    ctx.fresh(); providers.mode.moderation = '500'; providers.mode['gemini-check'] = '429'; providers.mode['gemini-retry'] = '429';
    const u2 = await makeUser('r4b', 'admin');
    const w = await callPoster(u2, '198.51.100.104');
    assert.equal(w.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(calls('gemini-check'), 1); assert.equal(calls('gemini-retry'), 1); assert.deepEqual(fake.keys('imgok:'), []);
    assert.ok(openFor('check_gemini') <= 3_000 + 1000);
    return { actual: 'retry works; double 429 fail-closed' };
  });

scenario('R5', 'text classifier (romance, fail-closed): 429 once → the sibling classifies → served; 429 on both → 503 CONTENT_CHECK_UNAVAILABLE, script slot back, check_text pauses 10 s',
  '200; then 503 CONTENT_CHECK_UNAVAILABLE', async () => {
    providers.mode['gemini-check-text'] = '429x1';
    const u = await makeUser('r5', 'admin');
    const ok = await callScript(u, 'romance');
    assert.equal(ok.status, 200); assert.equal(calls('gemini-retry'), 1);
    assert.equal(providers.bodies.find((b) => b.provider === 'gemini-retry').body.response_format.json_schema.name, 'safety_verdict');
    ctx.fresh(); providers.mode['gemini-check-text'] = '429'; providers.mode['gemini-retry'] = '429';
    const u2 = await makeUser('r5b', 'free');
    const bad = await callScript(u2, 'romance', '198.51.100.105');
    assert.equal(bad.status, 503); assert.equal(bad.body.code, 'CONTENT_CHECK_UNAVAILABLE');
    assert.equal(fake.num(`usage:script:${u2.identifier}:${DAY}`), 0, 'slot back');
    assert.ok(openFor('check_text') > 3_000 && openFor('check_text') <= 10_000 + 1000);
    return { actual: 'retry then served; double 429 fail-closed' };
  });

scenario('R6', 'minor screen: 429 once → the sibling screens (apparent_age schema) → the upload goes through; 429 on both → 503 PHOTO_CHECK_UNAVAILABLE, nothing stored, check_minor pauses 10 s',
  '200 sheet; then 503 PHOTO_CHECK_UNAVAILABLE', async () => {
    providers.mode['gemini-check-age'] = '429x1';
    const u = await makeUser('r6', 'free');
    const ok = await callUpload(u);
    assert.equal(ok.status, 200); assert.equal(ok.body.sheetGenerated, true);
    assert.ok(providers.bodies.some((b) => b.provider === 'gemini-retry' && b.body.response_format.json_schema.name === 'apparent_age'));
    ctx.fresh(); providers.mode['gemini-check-age'] = '429'; providers.mode['gemini-retry'] = '429';
    const u2 = await makeUser('r6b', 'free');
    const bad = await callUpload(u2, '198.51.100.106');
    assert.equal(bad.status, 503); assert.equal(bad.body.code, 'PHOTO_CHECK_UNAVAILABLE'); assert.equal(providers.s3puts.length, 0);
    assert.ok(openFor('check_minor') > 3_000 && openFor('check_minor') <= 10_000 + 1000);
    return { actual: 'retry then accepted; double 429 fail-closed' };
  });

scenario('R6b', 'the sibling is judged by the same strict rules: an "unsafe" from the sibling is FINAL (CONTENT_REFUSED, no marker); an unreadable sibling answer is never "safe"; a minor verdict from the sibling rejects the photo',
  'refused / not approved / MINOR_REJECTED', async () => {
    providers.mode['gemini-imgsafety'] = '429'; providers.sibling.verdict = 'unsafe';
    const u = await makeUser('r6b1', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.code, 'CONTENT_REFUSED'); assert.equal(r.body.isPlaceholder, true); assert.deepEqual(fake.keys('imgok:'), []);
    ctx.fresh(); providers.mode['gemini-imgsafety'] = '429'; providers.sibling.raw = 'maybe';
    const r2 = await callPoster(await makeUser('r6b2', 'admin'), '198.51.100.108');
    assert.equal(r2.body.isPlaceholder, true, 'an unreadable sibling answer is never "safe"'); assert.deepEqual(fake.keys('imgok:'), []);
    ctx.fresh(); providers.mode['gemini-check-age'] = '429'; providers.sibling.age = 'minor';
    const up = await callUpload(await makeUser('r6b3', 'free'), '198.51.100.109');
    assert.equal(up.status, 422); assert.equal(up.body.code, 'MINOR_REJECTED'); assert.equal(providers.s3puts.length, 0);
    return { actual: 'sibling verdicts are final and strict' };
  });

scenario('R6c', '"unsafe" from the FIRST model is final: no retry, no sibling call',
  'CONTENT_REFUSED; sibling 0', async () => {
    providers.imgSafety.value = 'unsafe';
    const u = await makeUser('r6c', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.code, 'CONTENT_REFUSED'); assert.equal(calls('gemini-imgsafety'), 1); assert.equal(calls('gemini-retry'), 0);
    return { actual: 'final' };
  });

scenario('R7', 'the credit path is untouched: 402 and a key-limit 403 are NOT retried (one call each, no sibling call) and still answer SERVICE_UNAVAILABLE with the 5-minute pause',
  '1 call each; sibling 0; SERVICE_UNAVAILABLE; 5 min', async () => {
    for (const mode of ['402', '403:keylimit']) {
      ctx.fresh(); providers.mode['gemini-imgsafety'] = mode;
      const u = await makeUser(`r7-${mode.length}`, 'admin');
      const r = await callPoster(u, '198.51.100.107');
      assert.equal(r.body.code, 'SERVICE_UNAVAILABLE', mode); assert.equal(calls('gemini-imgsafety'), 1, `${mode}: no retry`); assert.equal(calls('gemini-retry'), 0, `${mode}: no sibling call`);
      const left = openFor('check_imgsafety'); assert.ok(left > 10_000 && left <= 5 * 60_000 + 1000, `${mode}: ${left}`);
      assert.equal(c429('check_imgsafety'), 0, `${mode}: not counted as a 429`);
    }
    return { actual: 'unchanged' };
  });

scenario('R8', 'Nemotron keeps its own retry (same model); circuit pauses on a 429: check_imgsafety / check_gemini 3 s, check_nemotron / check_text / check_minor 10 s, generation providers 45 s, other statuses unchanged',
  'passes after Nemotron retry; 3 s / 10 s / 45 s; 503 20 s; 500 15 s', async () => {
    providers.mode.moderation = '429x1';
    const u = await makeUser('r8', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.isPlaceholder, undefined); assert.equal(calls('moderation'), 2); assert.equal(openFor('check_nemotron'), null); assert.equal(c429('check_nemotron'), 1);
    ctx.fresh();
    const dur = async (name, status) => { await cb.recordFailure(redis, name, status); return openFor(name); };
    for (const name of ['check_gemini', 'check_imgsafety']) { const d = await dur(name, 429); assert.ok(d > 0 && d <= 3_000 + 1000, `${name} 429: ${d}`); }
    for (const name of ['check_nemotron', 'check_text', 'check_minor']) { const d = await dur(name, 429); assert.ok(d > 5_000 && d <= 10_000 + 1000, `${name} 429: ${d}`); }
    for (const name of ['cloudflare', 'openrouter', 'script_paid', 'storyboard_gemini', 'grok_identity']) { const d = await dur(name, 429); assert.ok(d > 40_000 && d <= 45_000 + 1000, `${name} 429: ${d}`); }
    const d503 = await dur('check_text', 503); assert.ok(d503 > 10_000 && d503 <= 20_000 + 1000, `check_text 503: ${d503}`);
    const d500 = await dur('check_minor', 500); assert.ok(d500 > 10_000 && d500 <= 15_000 + 1000, `check_minor 500: ${d500}`);
    const d500g = await dur('check_gemini', 500); assert.ok(d500g > 10_000 && d500g <= 15_000 + 1000, `check_gemini 500 (unchanged 15 s): ${d500g}`);
    return { actual: 'durations as decided' };
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

scenario('R10', 'a retry model that cannot be routed under deny (404 data policy) is just a technical failure: withheld, counted under its own _retry label; an invalid IMAGE_CHECK_RETRY_MODEL is ignored (default used)',
  'CONTENT_CHECK_UNAVAILABLE; policy404 counter on check_imgsafety_retry; bad env -> gemini-2.5-flash', async () => {
    providers.mode['gemini-imgsafety'] = '429'; providers.mode['gemini-retry'] = '404:policy';
    const u = await makeUser('r10', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.deepEqual(fake.keys('imgok:'), []);
    assert.equal(fake.num(`stats:policy404:${DAY}:check_imgsafety_retry`), 1); assert.equal(fake.keys(`stats:policy404:${DAY}:other`).length, 0);
    ctx.fresh(); providers.mode['gemini-imgsafety'] = '429x1';
    const u2 = await makeUser('r10b', 'admin');
    const r2 = await withRetryModel('openai/gpt-6-luna', () => callPoster(u2, '198.51.100.120'));
    assert.equal(r2.body.isPlaceholder, undefined); assert.deepEqual(modelsSentTo('gemini-retry'), ['google/gemini-2.5-flash'], 'the invalid value was ignored: the default sibling served it');
    return { actual: 'fail-closed; labelled; env validated' };
  });
