/**
 * Scenario N — the PRIMARY image checker is the PAID nvidia/nemotron-3.5-content-safety with provider.data_collection "deny" (DeepInfra: no training, no retention
 * published), metered by DAILY_NEMOTRON_BUDGET; Klein / Grok / Gemini-image send "deny" too. A 404 "No endpoints found matching your data policy" is a TECHNICAL
 * failure on every path (existing fallbacks, never a content refusal, never an unchecked image) and is counted + announced.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

// $0.0004 / $0.0002 per call = a cap of 2 Nemotron checks a day (the 80% warning fires at the 2nd). Production mode: the Telegram alerts only send there.
const ctx = await boot({ file: '41-nemotron-paid-deny', nodeEnv: 'production', env: { DAILY_NEMOTRON_BUDGET: '0.0004' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const poster = await ctx.route('generate-poster');
const upload = await ctx.route('upload-character');
const { _resetBudgetAlertMemory } = await import('../../lib/budget-alerts.js');

const DAY = '2026-10-15';
const callPoster = (u, extra = {}, ip = '198.51.100.110') => invoke(poster, { body: { prompt: 'A lone figure walks into a neon-lit rainy street', ...extra }, cookies: u.cookies, ip });
const callUpload = (u, ip = '198.51.100.111') => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip });
const slot = () => fake.num(`usage:check:nemotron:global:${DAY}`);
const calls = (k) => providers.counts[k] ?? 0;
const sent = (model) => providers.bodies.filter((b) => b.provider === model).map((b) => b.body);
const policy404 = (label) => fake.num(`stats:policy404:${DAY}:${label}`);
const policyAlerts = () => providers.telegram.filter((t) => /no longer satisfies our privacy routing/.test(t));
const open = (name) => { const v = fake.get(`circuit:img:${name}`); return v ? JSON.parse(v).openUntil - Date.now() : null; };

scenario('N1', 'request shape: the paid slug + provider.data_collection "deny" for Nemotron, Klein, Grok and Gemini-image — and NO request ever reaches the ":free" slug',
  'deny on all four bodies; moderation-free-deny 0', async () => {
    _resetBudgetAlertMemory();
    providers.mode.cloudflare = '500';                                     // → Klein serves the poster
    const u = await makeUser('n1', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.provider, 'OpenRouter-Klein');
    const nemo = sent('moderation'); assert.ok(nemo.length >= 1);
    for (const b of nemo) { assert.equal(b.model, 'nvidia/nemotron-3.5-content-safety'); assert.deepEqual(b.provider, { data_collection: 'deny' }); assert.deepEqual(b.reasoning, { effort: 'none' }); }
    assert.deepEqual(sent('black-forest-labs/flux.2-klein-4b')[0].provider, { data_collection: 'deny' });
    delete providers.mode.cloudflare;
    const paid = await makeUser('n1b', 'paid');
    const face = await callPoster(paid, { characterImageUrl: ctx.FACE_URL }, '198.51.100.112');
    assert.equal(face.body.provider, 'Grok-Identity');
    assert.deepEqual(sent('x-ai/grok-imagine-image-quality')[0].provider, { data_collection: 'deny' });
    const free = await makeUser('n1c', 'free');
    const up = await callUpload(free, '198.51.100.113');   // free tier: the sheet is made by Gemini-image, and the selfie goes through the Nemotron check
    assert.equal(up.status, 200);
    assert.deepEqual(sent('google/gemini-2.5-flash-image')[0].provider, { data_collection: 'deny' });
    assert.equal(calls('moderation-free-deny'), 0, 'nothing is sent to the :free slug (it cannot be combined with deny)');
    return { actual: 'deny everywhere; free slug never called' };
  });

scenario('N2', 'budget accounting: a verdict keeps its slot; a technical failure (5xx) gives it back; the selfie path is metered too',
  'poster: 1 slot; 5xx: 0 slots; selfie + sheet: 2 slots', async () => {
    _resetBudgetAlertMemory();
    const u = await makeUser('n2', 'admin');
    await callPoster(u);
    assert.equal(slot(), 1);
    ctx.fresh(); _resetBudgetAlertMemory();
    providers.mode.moderation = '500';                                    // Nemotron down: both attempts release their slot, the Gemini fallback checks
    const u2 = await makeUser('n2b', 'admin');
    const r = await callPoster(u2);
    assert.equal(r.body.isPlaceholder, undefined, 'the fallback approved it'); assert.equal(calls('moderation'), 2); assert.equal(slot(), 0, 'no billed call = no slot');
    ctx.fresh(); _resetBudgetAlertMemory();
    const u3 = await makeUser('n2c', 'free');
    const up = await callUpload(u3);
    assert.equal(up.status, 200); assert.equal(slot(), 2, 'the raw selfie and the generated sheet each get a Nemotron check');
    return { actual: 'slots 1 / 0 / 2' };
  });

scenario('N3', 'cap reached: the 3rd image skips Nemotron (no call), the Gemini fallback decides, the 80% warning and the "budget reached" alert are each sent once',
  'moderation calls 2; the 3rd served via gemini-check; warning + reached alerts', async () => {
    _resetBudgetAlertMemory();
    const u = await makeUser('n3', 'admin');
    await callPoster(u); await callPoster(u, {}, '198.51.100.114');
    assert.equal(calls('moderation'), 2); assert.equal(slot(), 2);
    assert.ok(providers.telegram.some((t) => /Budget at 80%/.test(t) && /DAILY\\_NEMOTRON\\_BUDGET/.test(t) && /Gemini fallback checks every image/.test(t)), JSON.stringify(providers.telegram));
    const before = { moderation: calls('moderation'), check: calls('gemini-check') };
    const third = await callPoster(u, {}, '198.51.100.115');
    assert.equal(third.status, 200); assert.equal(third.body.isPlaceholder, undefined, 'approved by the fallback');
    assert.equal(calls('moderation'), before.moderation, 'no Nemotron call once the cap is reached'); assert.equal(calls('gemini-check'), before.check + 1, 'the Gemini fallback decided');
    assert.equal(slot(), 2, 'the refused reservation was rolled back');
    assert.equal(providers.telegram.filter((t) => /Budget reached/.test(t) && /DAILY\\_NEMOTRON\\_BUDGET/.test(t)).length, 1);
    await callPoster(u, {}, '198.51.100.116');
    assert.equal(providers.telegram.filter((t) => /Budget reached/.test(t)).length, 1, 'once per day');
    return { actual: 'cap respected, fallback decided' };
  });

scenario('N4', 'FAIL-CLOSED: when the Nemotron budget cannot be verified (Redis counter fails) nothing is approved — no Nemotron call, no fallback call, the image is withheld',
  'CONTENT_CHECK_UNAVAILABLE; moderation 0; gemini-check 0; no marker', async () => {
    _resetBudgetAlertMemory();
    const u = await makeUser('n4', 'admin');
    fake.control.failCommands.add('INCR');
    const r = await callPoster(u);
    fake.control.failCommands.delete('INCR');
    assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(r.body.isPlaceholder, true);
    assert.equal(calls('moderation'), 0); assert.equal(calls('gemini-check'), 0); assert.equal(calls('gemini-imgsafety'), 0);
    assert.deepEqual(fake.keys('imgok:'), []); assert.equal(providers.s3puts.length, 0);
    return { actual: 'withheld, no paid call' };
  });

scenario('N5', 'circuits: a Nemotron SUCCESS clears a credit outage and announces the recovery once (it is a paid check now); a Nemotron 429 pauses 10 s',
  'recovery message once; flag cleared', async () => {
    _resetBudgetAlertMemory();
    fake.set('credit:outage', String(Date.now() - 11 * 60_000)); fake.set('alert:credit-402', '1');
    providers.moderationVerdict.value = 'unsafe';                          // Nemotron answers "unsafe" → only check_nemotron succeeds (no second opinion), the poster is refused
    const u = await makeUser('n5', 'admin');
    const r = await callPoster(u);
    assert.equal(r.body.code, 'CONTENT_REFUSED');
    assert.equal(fake.get('credit:outage'), null);
    assert.equal(providers.telegram.filter((t) => /succeeding again/.test(t)).length, 1);
    providers.moderationVerdict.value = 'safe';
    return { actual: 'recovered via check_nemotron' };
  });

scenario('N6', 'deny-404 on NEMOTRON: technical failure → the Gemini fallback decides (an unsafe verdict still withholds); counted, ONE alert, 15 s pause, slots given back, nothing unchecked',
  'fallback decides; policy404 counter; 1 alert; pause ≤ 15 s; slot 0', async () => {
    _resetBudgetAlertMemory();
    providers.mode.moderation = '404:policy';
    const u = await makeUser('n6', 'admin');
    const ok = await callPoster(u);
    assert.equal(ok.body.isPlaceholder, undefined, 'the Gemini fallback approved it'); assert.equal(calls('gemini-check'), 1);
    assert.equal(slot(), 0); assert.equal(calls('moderation'), 1, 'a permanent routing failure is not retried'); assert.equal(policy404('check_nemotron'), 1, 'counted once per image');
    const left = open('check_nemotron'); assert.ok(left > 10_000 && left <= 15_000 + 1000, `pause ${left}`);
    assert.equal(policyAlerts().length, 1);
    ctx.advance(16_000); providers.checkGemini.value = 'unsafe';
    const bad = await callPoster(u, {}, '198.51.100.117');
    assert.equal(bad.body.code, 'CONTENT_REFUSED', 'the fallback verdict alone decides'); assert.deepEqual(fake.keys('imgok:').length, 1, 'only the first (approved) image carries a marker');
    assert.equal(policyAlerts().length, 1, 'deduped for an hour');
    ctx.fresh(); providers.mode.moderation = '404:policy'; providers.mode['gemini-check'] = '500';
    const u2 = await makeUser('n6b', 'admin');
    const none = await callPoster(u2);
    assert.equal(none.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.deepEqual(fake.keys('imgok:'), []); assert.equal(providers.s3puts.length, 0);
    return { actual: 'fallback decides, fail-closed otherwise' };
  });

scenario('N7', 'deny-404 on the IMAGE models: Klein → next provider / placeholder (a variant text naming "safety" is NOT a content refusal); Grok → Gemini identity, no credit lost; sheet generator → CHARACTER_SHEET_FAILED',
  'PROVIDERS_BUSY placeholder; Gemini-Identity serves; 503 CHARACTER_SHEET_FAILED; counters + 1 alert', async () => {
    _resetBudgetAlertMemory();
    providers.mode.cloudflare = '500'; providers.mode.klein = '404:policysafety';
    const u = await makeUser('n7', 'admin');
    const k = await callPoster(u);
    assert.equal(k.body.isPlaceholder, true); assert.equal(k.body.code, 'PROVIDERS_BUSY'); assert.notEqual(k.body.code, 'CONTENT_REFUSED'); assert.equal(k.body.contentRefused, undefined);
    assert.equal(policy404('openrouter'), 1); assert.deepEqual(fake.keys('imgok:'), []);
    ctx.fresh(); _resetBudgetAlertMemory();
    providers.mode.grok = '404:policy';
    const paid = await makeUser('n7b', 'paid');
    const g = await callPoster(paid, { characterImageUrl: ctx.FACE_URL }, '198.51.100.118');
    assert.equal(g.status, 200); assert.equal(g.body.provider, 'Gemini-Identity'); assert.equal(g.body.isPlaceholder, undefined);
    assert.equal(policy404('grok_identity'), 1); assert.equal(policyAlerts().length, 1);
    ctx.fresh(); _resetBudgetAlertMemory();
    providers.mode['gemini-image'] = '404:policy';
    const free = await makeUser('n7c', 'free');
    const up = await callUpload(free, '198.51.100.119');
    assert.equal(up.status, 503); assert.equal(up.body.code, 'CHARACTER_SHEET_FAILED');
    assert.ok(providers.s3deletes.some((d) => /-raw\./.test(d.key)), 'raw selfie deleted'); assert.equal(policy404('gemini_identity'), 1);
    return { actual: 'technical failures everywhere; counted' };
  });
