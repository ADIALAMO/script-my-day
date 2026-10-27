/**
 * Scenario K — OpenRouter CREDIT exhaustion (HTTP 402) on every path that calls OpenRouter.
 * Asserts for each path: the owner is alerted (Telegram, ONE per 30 min for the account), the day's counter moves, the user gets the honest
 * SERVICE_UNAVAILABLE answer (no "try again"), quota/reservations come back, nothing leaks provider details, and NO image ever passes unchecked.
 * Also: the credit circuit pause is capped at 5 min (a top-up restores the app), every other status keeps today's behaviour, recovery is announced once.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

// production: the Telegram alerts only send there. DAILY_SCRIPT_BUDGET>0 = the privacy route (paid Gemini first, deny-only fallbacks) = the real production cascade.
const ctx = await boot({ file: '39-credit-failure', nodeEnv: 'production', env: { DAILY_SCRIPT_BUDGET: '10' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const script = await ctx.route('generate-script');
const storyboard = await ctx.route('generate-storyboard');
const poster = await ctx.route('generate-poster');
const upload = await ctx.route('upload-character');
const cb = await import('../../lib/circuit-breaker.js');
const redis = (await import('../../lib/redis.js')).default;
const { getMsg, isRetryableError, CODES } = await import('../../lib/messages.js');

const ENTRY = 'I walked along the beach with my family and we laughed all afternoon.';
const SB_SCRIPT = 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.';
const callScript = (u, genre = 'drama', ip = '198.51.100.70') => invoke(script, { body: { journalEntry: ENTRY, genre, gender: 'neutral' }, cookies: u.cookies, ip });
const callStoryboard = (u, ip = '198.51.100.71') => invoke(storyboard, { body: { script: SB_SCRIPT, lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: `${Date.now()}${Math.floor(Math.random() * 1e9)}` }, cookies: u.cookies, ip });
const callPoster = (u, extra = {}, ip = '198.51.100.72') => invoke(poster, { body: { prompt: 'A lone figure walks into a neon-lit rainy street', ...extra }, cookies: u.cookies, ip });
const DAY = '2026-10-15';
const counter = (slug) => fake.num(`stats:credit402:${DAY}:${slug}`);
const creditAlerts = () => providers.telegram.filter((t) => /credit/i.test(t) && /exhausted/i.test(t));
const recoveryAlerts = () => providers.telegram.filter((t) => /succeeding again/.test(t));
const openUntil = (name) => { const v = fake.get(`circuit:img:${name}`); return v ? JSON.parse(v).openUntil : null; };
const LEAK = /openrouter|credit|balance|402|nemotron|gemini|grok|flux|klein/i;   // nothing like this may reach the client
const clean = (body) => { const t = JSON.stringify(body ?? {}); assert.ok(!LEAK.test(t.replace(/"code":"SERVICE_UNAVAILABLE"/g, '')), `client body leaks internals: ${t.slice(0, 200)}`); };

scenario('K1', 'script: every OpenRouter stage answers 402 → 503 SERVICE_UNAVAILABLE (not SCRIPT_FAIL), quota given back, ONE alert, counter, circuit paused 5 min',
  '503 SERVICE_UNAVAILABLE; script quota 0; 1 telegram; stats:credit402:script=1; script_paid open ≤ 5 min', async () => {
    providers.mode['openrouter-text'] = '402';
    const u = await makeUser('k1', 'free');
    const r = await callScript(u);
    assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); clean(r.body);
    assert.equal(fake.num(`usage:script:${u.identifier}:${DAY}`), 0, 'the script slot is given back');
    assert.equal(creditAlerts().length, 1, `alerts: ${JSON.stringify(providers.telegram)}`);
    assert.ok(!/SCRIPT_FAIL|Check Gemini quota/.test(providers.telegram.join()), 'the generic "cascade failed" alert is replaced by the credit one');
    assert.equal(counter('script'), 1);
    const ou = openUntil('script_paid'); assert.ok(ou > Date.now() && ou - Date.now() <= 5 * 60_000 + 1000, `circuit pause ${ou - Date.now()} ms`);
    // a second request (circuit open → the paid engine is skipped, Gemma/DeepSeek still 402): same answer, counted, NOT announced again
    const r2 = await callScript(u, 'drama', '198.51.100.73');
    assert.equal(r2.status, 503); assert.equal(r2.body.code, 'SERVICE_UNAVAILABLE');
    assert.equal(creditAlerts().length, 1, 'deduped: one alert per 30 min');
    assert.equal(counter('script'), 2);
    return { actual: `503 SERVICE_UNAVAILABLE ×2, quota 0, telegram ${providers.telegram.length}, counter ${counter('script')}` };
  });

scenario('K2', 'storyboard: every OpenRouter engine answers 402 → 503 SERVICE_UNAVAILABLE (not STORYBOARD_FAIL), comic quota given back, alert + counter',
  '503 SERVICE_UNAVAILABLE; comic quota 0; 1 telegram', async () => {
    providers.mode['storyboard-gemini'] = '402'; providers.mode['openrouter-text'] = '402';
    const u = await makeUser('k2', 'free');
    const r = await callStoryboard(u);
    assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); clean(r.body);
    assert.equal(fake.num(`usage:comic:${u.identifier}:2026-10`), 0, 'the comic is given back');
    assert.equal(creditAlerts().length, 1); assert.equal(counter('storyboard'), 1);
    return { actual: '503 SERVICE_UNAVAILABLE, comic 0, 1 alert' };
  });

scenario('K3', 'poster: generation fine, BOTH image checkers answer 402 → placeholder + SERVICE_UNAVAILABLE; the image is NOT shown, stored or marked checked (fail-closed); alert + counter',
  '200 placeholder SERVICE_UNAVAILABLE; no imgok marker, no R2 put, poster quota 0; 1 telegram; image-check counter ≥ 1', async () => {
    providers.mode.moderation = '402'; providers.mode['gemini-check'] = '402';
    const u = await makeUser('k3', 'free');
    const r = await callPoster(u);
    assert.equal(r.status, 200); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.checkUnavailable, true);
    assert.ok(r.body.imageUrl.startsWith('data:image/svg+xml'), 'only the placeholder is returned, never the generated image'); clean({ ...r.body, imageUrl: undefined, details: undefined });
    assert.deepEqual(fake.keys('imgok:'), [], 'no approval marker for an unchecked image');
    assert.equal(providers.s3puts.length, 0);
    assert.equal(fake.num(`usage:poster:${u.identifier}:${DAY}`), 0, 'no poster slot spent');
    assert.equal(creditAlerts().length, 1); assert.ok(counter('image-check') >= 1);
    return { actual: `placeholder SERVICE_UNAVAILABLE; imgok 0; r2 puts 0; telegram ${creditAlerts().length}` };
  });

scenario('K3b', 'poster: the second-opinion check answers 402 (Nemotron said safe) → still withheld, SERVICE_UNAVAILABLE',
  'placeholder SERVICE_UNAVAILABLE; no marker', async () => {
    providers.mode['gemini-imgsafety'] = '402';
    const u = await makeUser('k3b', 'free');
    const r = await callPoster(u);
    assert.equal(r.status, 200); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true);
    assert.deepEqual(fake.keys('imgok:'), []);
    assert.equal(creditAlerts().length, 1);
    return { actual: 'withheld, SERVICE_UNAVAILABLE' };
  });

scenario('K3c', 'REGRESSION: a checker outage that is NOT credit (HTTP 500) keeps CONTENT_CHECK_UNAVAILABLE, no credit alert, circuit pause unchanged (15 s)',
  'CONTENT_CHECK_UNAVAILABLE; 0 credit alerts; check_nemotron open ≤ 20 s', async () => {
    providers.mode.moderation = '500'; providers.mode['gemini-check'] = '500';
    const u = await makeUser('k3c', 'free');
    const r = await callPoster(u);
    assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.serviceUnavailable, undefined);
    assert.equal(creditAlerts().length, 0); assert.equal(fake.keys('stats:credit402').length, 0);
    const ou = openUntil('check_nemotron'); assert.ok(ou - Date.now() <= 20_000, `pause ${ou - Date.now()} ms`);
    return { actual: 'CONTENT_CHECK_UNAVAILABLE, no credit alert' };
  });

scenario('K4', 'cascade exhausted with a 402 on the paid image provider (Klein) → SERVICE_UNAVAILABLE instead of "providers busy"; nothing charged',
  '200 placeholder SERVICE_UNAVAILABLE; poster quota 0', async () => {
    providers.mode.cloudflare = '500'; providers.mode.klein = '402';
    const u = await makeUser('k4', 'free');
    const r = await callPoster(u);
    assert.equal(r.status, 200); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true);
    assert.equal(fake.num(`usage:poster:${u.identifier}:${DAY}`), 0);
    assert.equal(creditAlerts().length, 1); assert.equal(counter('poster-image'), 1);
    return { actual: 'SERVICE_UNAVAILABLE placeholder, alert 1' };
  });

scenario('K5', 'Star Yourself image: Grok answers 402 → silently degrades to Gemini (face kept), the owner is alerted, the user sees no error',
  '200 real image from Gemini-Identity; 1 telegram; counter star-yourself-image 1', async () => {
    providers.mode.grok = '402';
    const u = await makeUser('k5', 'paid');
    const r = await callPoster(u, { characterImageUrl: ctx.FACE_URL });
    assert.equal(r.status, 200); assert.equal(r.body.success, true); assert.equal(r.body.isPlaceholder, undefined); assert.equal(r.body.provider, 'Gemini-Identity');
    assert.equal(creditAlerts().length, 1); assert.equal(counter('star-yourself-image'), 1);
    return { actual: `provider ${r.body.provider}, telegram 1` };
  });

scenario('K6', 'text classifier (romance = fail-closed) answers 402 → 503 SERVICE_UNAVAILABLE, script slot back; a non-risk genre is still served on the blocklist alone (unchanged)',
  'romance 503 SERVICE_UNAVAILABLE, quota 0; drama 200', async () => {
    providers.mode['gemini-check-text'] = '402';
    const u = await makeUser('k6', 'free');
    const r = await callScript(u, 'romance');
    assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); clean(r.body);
    assert.equal(fake.num(`usage:script:${u.identifier}:${DAY}`), 0);
    assert.equal(counter('text-check') >= 1, true);
    const d = await callScript(u, 'drama', '198.51.100.74');
    assert.equal(d.status, 200, 'drama still degrades to the blocklist (unchanged behaviour)');
    return { actual: 'romance 503 SERVICE_UNAVAILABLE; drama 200' };
  });

scenario('K7', 'Star Yourself upload: the photo screen answers 402 → 503 SERVICE_UNAVAILABLE, nothing stored, reservations back',
  '503 SERVICE_UNAVAILABLE; 0 R2 puts; sheet quota 0', async () => {
    providers.mode['gemini-check-age'] = '402';
    const u = await makeUser('k7', 'free');
    const r = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.75' });
    assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE');
    assert.equal(providers.s3puts.length, 0); assert.equal(providers.counts['gemini-image'] ?? 0, 0, 'no paid sheet call');
    assert.equal(creditAlerts().length, 1); assert.equal(counter('photo-check') >= 1, true);
    return { actual: '503 SERVICE_UNAVAILABLE, nothing stored' };
  });

scenario('K8', 'Star Yourself upload: the sheet generator answers 402 → 503 SERVICE_UNAVAILABLE, raw selfie deleted, quota back, alert + counter',
  '503 SERVICE_UNAVAILABLE; the raw selfie is deleted; counter character-sheet 1', async () => {
    providers.mode['gemini-image'] = '402';
    const u = await makeUser('k8', 'free');
    const r = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.76' });
    assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE');
    assert.ok(providers.s3deletes.some((d) => /-raw\./.test(d.key)), 'the raw selfie is deleted after the failed attempt');
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0, 'the sheet quota is given back');
    assert.equal(creditAlerts().length, 1); assert.equal(counter('character-sheet'), 1);
    return { actual: '503 SERVICE_UNAVAILABLE, raw deleted, quota 0' };
  });

scenario('K9', 'circuit: a credit 402 on an OpenRouter circuit pauses it a flat 5 min with NO strikes and NO escalation to midnight, however often it repeats; other statuses and other providers are unchanged',
  '402×3 on check_gemini → ≤ 5 min each time; huggingface 402×2 → midnight; check_gemini 403×2 → midnight; 500 → 15 s', async () => {
    const now = () => Date.now();
    for (let i = 0; i < 3; i++) {
      await cb.recordFailure(redis, 'check_gemini', 402);
      const left = openUntil('check_gemini') - now(); assert.ok(left > 0 && left <= 5 * 60_000 + 1000, `402 #${i + 1}: ${left} ms`);
      assert.equal(fake.get('circuit:img:strikes:check_gemini'), null, 'a credit 402 keeps no strike counter');
    }
    await cb.recordFailure(redis, 'huggingface', 402); await cb.recordFailure(redis, 'huggingface', 402);
    const midnight = Date.parse('2026-10-16T00:00:00Z');
    assert.equal(openUntil('huggingface'), midnight, 'a non-OpenRouter provider keeps the two-strike → midnight rule');
    await cb.recordFailure(redis, 'check_text', 403); assert.ok(openUntil('check_text') - now() <= 5 * 60_000 + 1000, '403 first strike: 5 min');
    await cb.recordFailure(redis, 'check_text', 403); assert.equal(openUntil('check_text'), midnight, '403 second strike: midnight (unchanged)');
    await cb.recordFailure(redis, 'check_minor', 500); assert.ok(openUntil('check_minor') - now() <= 15_000 + 1000, '500: 15 s (unchanged)');
    await cb.recordFailure(redis, 'check_gemini', 429); assert.ok(openUntil('check_gemini') - now() <= 45_000 + 1000, '429: 45 s (unchanged)');
    await cb.recordFailure(redis, 'cloudflare', null); assert.equal(openUntil('cloudflare'), null, 'no status: no pause (unchanged)');
    assert.equal(providers.telegram.length, 1, 'only the first credit failure announced (one alert per 30 min)');
    return { actual: '402 flat 5 min / no strikes; hf 402 midnight; 403 two-strike; 500 15 s; 429 45 s' };
  });

scenario('K10', 'a top-up restores the app within minutes: after the 5-min pause the next request succeeds, the circuit and strikes are cleared, and the recovery is announced ONCE; a later new outage is announced again',
  'blocked → (6 min, credit back) 200 + 1 recovery message; new outage → 2nd credit alert', async () => {
    providers.mode.moderation = '402'; providers.mode['gemini-check'] = '402';
    const u = await makeUser('k10', 'admin');   // unlimited poster quota: this scenario makes five poster requests
    const a = await callPoster(u); assert.equal(a.body.code, 'SERVICE_UNAVAILABLE');
    assert.equal(creditAlerts().length, 1);
    delete providers.mode.moderation; delete providers.mode['gemini-check'];          // the owner added credit
    const still = await callPoster(u, {}, '198.51.100.77');                           // inside the 5-min pause: the checkers are skipped, so still unavailable — never unchecked
    assert.equal(still.body.isPlaceholder, true); assert.equal(still.body.code, 'SERVICE_UNAVAILABLE', 'the circuit that is open BECAUSE of a 402 still answers truthfully');
    ctx.advance(11 * 60_000);                                                         // a REAL outage (>= 10 min) re-arms the failure alert on recovery
    const ok = await callPoster(u, {}, '198.51.100.78');
    assert.equal(ok.status, 200); assert.equal(ok.body.isPlaceholder, undefined); assert.ok(ok.body.imageUrl);
    assert.equal(openUntil('check_nemotron'), null); assert.equal(fake.get('circuit:img:strikes:check_nemotron'), null);
    assert.equal(recoveryAlerts().length, 1, `recovery: ${JSON.stringify(providers.telegram)}`);
    assert.equal(fake.get('credit:outage'), null);
    await callPoster(u, {}, '198.51.100.79');
    assert.equal(recoveryAlerts().length, 1, 'announced once');
    providers.mode.moderation = '402'; providers.mode['gemini-check'] = '402'; ctx.advance(6 * 60_000);   // credit runs out again (inside the old 30-min window)
    const again = await callPoster(u, {}, '198.51.100.80');
    assert.equal(again.body.code, 'SERVICE_UNAVAILABLE'); assert.equal(creditAlerts().length, 2, 'the new outage is announced, not swallowed by the old window');
    return { actual: `recovered after 11 min; recovery alerts 1; credit alerts ${creditAlerts().length}` };
  });

scenario('K10b', 'no flapping: a short blip (< 10 min) that recovers and fails again sends ONE recovery message and does NOT send a second failure alert inside the 30-min window',
  '1 credit alert, 1 recovery, no second credit alert', async () => {
    providers.mode.moderation = '402'; providers.mode['gemini-check'] = '402';
    const u = await makeUser('k10b', 'admin');
    await callPoster(u); assert.equal(creditAlerts().length, 1);
    delete providers.mode.moderation; delete providers.mode['gemini-check'];
    ctx.advance(2 * 60_000 + 4 * 60_000);                     // pause (5 min) over, outage lasted ~6 min
    const ok = await callPoster(u, {}, '198.51.100.82'); assert.equal(ok.body.isPlaceholder, undefined);
    assert.equal(recoveryAlerts().length, 1);
    providers.mode.moderation = '402'; providers.mode['gemini-check'] = '402'; ctx.advance(6 * 60_000);
    const again = await callPoster(u, {}, '198.51.100.83'); assert.equal(again.body.code, 'SERVICE_UNAVAILABLE');
    assert.equal(creditAlerts().length, 1, 'still the same 30-min window: no flap');
    return { actual: 'credit alerts 1, recovery 1' };
  });

scenario('K11', 'dedupe: many 402s on different paths inside 30 min → ONE alert; after 31 min the next one is sent; counters keep counting per path',
  '1 alert for script+storyboard+poster; +1 after 31 min', async () => {
    providers.mode['openrouter-text'] = '402'; providers.mode['storyboard-gemini'] = '402'; providers.mode.moderation = '402'; providers.mode['gemini-check'] = '402';
    const u = await makeUser('k11', 'paid');
    await callScript(u); await callStoryboard(u); await callPoster(u);
    assert.equal(creditAlerts().length, 1, `alerts: ${creditAlerts().length}`);
    assert.ok(counter('script') >= 1 && counter('storyboard') >= 1 && counter('image-check') >= 1);
    assert.ok(!/@test\.example|198\.51\.100|k11/.test(providers.telegram.join()), 'no user data in the alert');
    ctx.advance(31 * 60_000);
    await callScript(u, 'drama', '198.51.100.81');
    assert.equal(creditAlerts().length, 2, 'the window passed: a new alert');
    return { actual: 'one alert per 30 min' };
  });

// ── Per-API-key limit: OpenRouter answers HTTP 403 {error:{metadata:{scope:"key_limit", limit_source:"openrouter_key_limit"}}} (the exact body is in providers.mjs) ──
const noKeyDetails = () => assert.ok(!/workspaces|KEYID|settings\/keys|remedy|total limit/i.test(providers.telegram.join('\n')), 'the alert never repeats the key-management URL or the provider message');
const strikes = (name) => fake.get(`circuit:img:strikes:${name}`);

scenario('K13', 'KEY LIMIT (403 key_limit) on the script cascade behaves exactly like a 402: 503 SERVICE_UNAVAILABLE, quota back, ONE fixed-text alert, counter, 5-min circuit pause, no strikes',
  '503 SERVICE_UNAVAILABLE; 1 alert without key details; script counter; script_paid ≤ 5 min with lastError 402', async () => {
    providers.mode['openrouter-text'] = '403:keylimit';
    const u = await makeUser('k13', 'free');
    const warnings = []; const origWarn = console.warn; console.warn = (...x) => { warnings.push(x.join(' ')); };
    let r; try { r = await callScript(u); } finally { console.warn = origWarn; }
    assert.ok(!/workspaces|KEYID/.test(warnings.join('\n')), 'no key URL in the server logs (Gemma / DeepSeek / paid stage)');
    assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); clean(r.body);
    assert.equal(fake.num(`usage:script:${u.identifier}:${DAY}`), 0);
    assert.equal(creditAlerts().length, 1); noKeyDetails(); assert.equal(counter('script') >= 1, true);
    const st = JSON.parse(fake.get('circuit:img:script_paid')); assert.equal(st.lastError, 402);
    assert.ok(st.openUntil - Date.now() <= 5 * 60_000 + 1000);
    assert.equal(strikes('script_paid'), null, 'no strike counter for a key-limit 403');
    return { actual: '503 SERVICE_UNAVAILABLE, 1 alert, circuit 5 min' };
  });

scenario('K13b', 'KEY LIMIT: either marker alone counts (scope "key_limit" OR limit_source "openrouter_key_limit")',
  'both → 503 SERVICE_UNAVAILABLE', async () => {
    for (const mode of ['403:scope', '403:source']) {
      providers.mode['openrouter-text'] = mode; ctx.advance(6 * 60_000);
      const u = await makeUser(`k13b-${mode.slice(4)}`, 'free');
      const r = await callScript(u, 'drama', `198.51.100.${mode === '403:scope' ? 84 : 85}`);
      assert.equal(r.status, 503, mode); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE', mode);
    }
    return { actual: 'scope-only and source-only both counted' };
  });

scenario('K14', 'KEY LIMIT on the storyboard engines → 503 SERVICE_UNAVAILABLE, comic back, alert + counter',
  '503 SERVICE_UNAVAILABLE; comic 0; 1 alert', async () => {
    providers.mode['storyboard-gemini'] = '403:keylimit'; providers.mode['openrouter-text'] = '403:keylimit';
    const u = await makeUser('k14', 'free');
    const r = await callStoryboard(u);
    assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); clean(r.body);
    assert.equal(fake.num(`usage:comic:${u.identifier}:2026-10`), 0);
    assert.equal(creditAlerts().length, 1); noKeyDetails(); assert.equal(counter('storyboard') >= 1, true);
    assert.equal(JSON.parse(fake.get('circuit:img:storyboard_gemini')).lastError, 402);
    return { actual: '503 SERVICE_UNAVAILABLE' };
  });

scenario('K15', 'KEY LIMIT on BOTH image checkers (and later the second opinion) → placeholder SERVICE_UNAVAILABLE, nothing shown / stored / marked checked; the pause stays a flat 5 min however often it repeats',
  'placeholder SERVICE_UNAVAILABLE; imgok 0; r2 puts 0; no strikes; 2nd round still ≤ 5 min', async () => {
    providers.mode.moderation = '403:keylimit'; providers.mode['gemini-check'] = '403:keylimit';
    const u = await makeUser('k15', 'admin');
    const r = await callPoster(u);
    assert.equal(r.status, 200); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true);
    assert.ok(r.body.imageUrl.startsWith('data:image/svg+xml'));
    assert.deepEqual(fake.keys('imgok:'), []); assert.equal(providers.s3puts.length, 0);
    assert.equal(creditAlerts().length, 1); noKeyDetails(); assert.equal(counter('image-check') >= 1, true);
    ctx.advance(6 * 60_000);
    const again = await callPoster(u, {}, '198.51.100.86');
    assert.equal(again.body.code, 'SERVICE_UNAVAILABLE');
    assert.ok(openUntil('check_nemotron') - Date.now() <= 5 * 60_000 + 1000, 'still a 5-min pause, never midnight');
    assert.equal(strikes('check_nemotron'), null);
    delete providers.mode.moderation; delete providers.mode['gemini-check']; providers.mode['gemini-imgsafety'] = '403:keylimit'; ctx.advance(6 * 60_000);
    const second = await callPoster(u, {}, '198.51.100.87');
    assert.equal(second.body.code, 'SERVICE_UNAVAILABLE'); assert.deepEqual(fake.keys('imgok:'), []);
    return { actual: 'withheld every time, SERVICE_UNAVAILABLE' };
  });

scenario('K16', 'KEY LIMIT on Klein (cascade exhausted) and on the Star Yourself sheet generator → SERVICE_UNAVAILABLE; the thrown message carries the "(key limit)" marker but not the key URL',
  'poster placeholder SERVICE_UNAVAILABLE; sheet 503 SERVICE_UNAVAILABLE, raw deleted', async () => {
    const warnings = []; const origWarn = console.warn; console.warn = (...a) => { warnings.push(a.join(' ')); };
    try {
      providers.mode.cloudflare = '500'; providers.mode.klein = '403:keylimit'; providers.mode['gemini-image'] = '403:keylimit';
      const u = await makeUser('k16', 'free');
      const r = await callPoster(u);
      assert.equal(r.status, 200); assert.equal(r.body.code, 'SERVICE_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true);
      assert.equal(counter('poster-image'), 1);
      const up = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.88' });
      assert.equal(up.status, 503); assert.equal(up.body.code, 'SERVICE_UNAVAILABLE');
      assert.ok(providers.s3deletes.some((d) => /-raw\./.test(d.key)), 'raw selfie deleted');
      assert.equal(counter('character-sheet'), 1);
    } finally { console.warn = origWarn; }
    const log = warnings.join('\n');
    assert.match(log, /\(key limit\)/); assert.ok(!/workspaces|KEYID/.test(log), 'the logs do not repeat the key URL either');
    return { actual: 'Klein + sheet: SERVICE_UNAVAILABLE; marker in logs, no key URL' };
  });

scenario('K17', 'REGRESSION: a 403 that is NOT a key limit (plain forbidden, a different scope, an HTML body) keeps today\'s behaviour — no credit alert/counter, CONTENT_CHECK_UNAVAILABLE / SCRIPT_FAIL, and the two-strike rule (5 min, then until midnight)',
  'no credit signals; strike 1 → 5 min; strike 2 → midnight', async () => {
    for (const variant of ['403:plain', '403:otherscope', '403:garbage']) {
      ctx.fresh?.();
      providers.mode.moderation = variant; providers.mode['gemini-check'] = variant;
      const u = await makeUser(`k17-${variant.slice(4)}`, 'admin');
      const r = await callPoster(u, {}, '198.51.100.89');
      assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE', variant); assert.equal(r.body.serviceUnavailable, undefined);
      assert.equal(creditAlerts().length, 0, variant); assert.equal(fake.keys('stats:credit402').length, 0, variant);
      assert.ok(openUntil('check_nemotron') - Date.now() <= 5 * 60_000 + 1000, `${variant}: strike 1 = 5 min`); assert.equal(strikes('check_nemotron'), '1');
      ctx.advance(6 * 60_000);
      await callPoster(u, {}, '198.51.100.90');
      assert.equal(openUntil('check_nemotron'), Date.parse('2026-10-16T00:00:00Z'), `${variant}: strike 2 = until midnight (unchanged)`);
    }
    // the script cascade too: a plain 403 is an ordinary failure
    ctx.fresh?.(); providers.mode['openrouter-text'] = '403:plain';
    const su = await makeUser('k17-script', 'free');
    const sr = await callScript(su, 'drama', '198.51.100.91');
    assert.equal(sr.status, 500); assert.equal(sr.body.code, 'SCRIPT_FAIL'); assert.equal(creditAlerts().length, 0);
    return { actual: 'plain / other-scope / HTML 403: unchanged' };
  });

scenario('K12', 'copy: SERVICE_UNAVAILABLE has he + en text, is NOT retryable (no Try-again button), Hebrew in the existing masculine-singular style, and names no provider, balance or price',
  'both languages, not retryable, no "נסו", no internals', async () => {
    const en = getMsg(CODES.SERVICE_UNAVAILABLE, 'en'); const he = getMsg(CODES.SERVICE_UNAVAILABLE, 'he');
    assert.ok(en.length > 20 && he.length > 20 && en !== he);
    assert.equal(isRetryableError(CODES.SERVICE_UNAVAILABLE), false);
    assert.ok(he.includes('נסה') && !he.includes('נסו'), he);
    assert.ok(!/openrouter|credit|balance|price|\$|upgrade|pro\b|stripe/i.test(en + he), 'no internals, no pricing words (native-app policy)');
    return { actual: `${en} | ${he}` };
  });
