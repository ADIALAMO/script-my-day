/** Scenario O — output-image safety check: Nemotron primary, capped Gemini Flash-Lite fallback, fail-closed, upload-panel marker. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

// 2 paid checks per UTC day: 0.0003 / 0.00015
const ctx = await boot({ file: '23-output-check', env: { DAILY_CHECK_BUDGET: '0.0003' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake, makeReq } = ctx;
const poster = await ctx.route('generate-poster');
const uploadPanel = await ctx.route('upload-panel');
const uploadCharacter = await ctx.route('upload-character');
const { getMsg } = await import('../../lib/messages.js');
const { imageHash } = await import('../../lib/image-check.js');

const plain = (u, ip, body = {}) => invoke(poster, { body: { prompt: 'A lone figure walks into the rain', ...body }, cookies: u.cookies, ip });
const posterCount = (u) => fake.num(`usage:poster:${u.identifier}:2026-10-15`);
const checkSpend = () => fake.num('usage:check:paid:global:2026-10-15');
const nem = () => providers.counts.moderation ?? 0;
const gem = () => providers.counts['gemini-check'] ?? 0;
const up = (u, ip, imageData = PNG_DATA_URI, key = 'panels/x_00.png') => invoke(uploadPanel, { body: { imageData, key }, cookies: u.cookies, ip });
const marker = (uri = PNG_DATA_URI) => fake.get(`imgok:${imageHash(uri)}`);

scenario('O1', 'a clean image: ONE free Nemotron call (image first, then the neutral text), no paid call, imgok marker written, the poster is returned and counted',
  'moderation=1, gemini-check=0, 200 with imageUrl, marker present, usage:poster=1', async () => {
    const u = await makeUser('o1', 'free');
    const r = await plain(u, '198.51.100.201');
    assert.equal(r.status, 200); assert.equal(r.body.provider, 'Cloudflare-Flux'); assert.ok(!r.body.isPlaceholder);
    assert.equal(nem(), 1); assert.equal(gem(), 0); assert.equal(providers.paidTotal(), 0);
    const sent = providers.bodies.find((b) => b.provider === 'moderation').body;
    assert.equal(sent.model, 'nvidia/nemotron-3.5-content-safety:free');
    assert.equal(sent.messages[0].content[0].type, 'image_url', 'image first');
    assert.equal(sent.messages[0].content[1].type, 'text');
    assert.ok(marker(r.body.imageUrl), 'imgok marker written for the exact bytes');
    assert.equal(posterCount(u), 1);
    return { actual: '1 free check, 0 paid, marker written' };
  });

scenario('O2', 'an image the checker calls UNSAFE is never returned: placeholder + CONTENT_REFUSED, no second provider, no paid fallback, poster slot returned, no marker',
  'code CONTENT_REFUSED; klein=0; gemini-check=0; usage:poster=0', async () => {
    providers.moderationVerdict.value = 'unsafe';
    const u = await makeUser('o2', 'free');
    const r = await plain(u, '198.51.100.202');
    assert.equal(r.status, 200); assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.code, 'CONTENT_REFUSED'); assert.equal(r.body.contentRefused, true);
    assert.ok(r.body.imageUrl.startsWith('data:image/svg+xml'), 'only the placeholder SVG goes out');
    assert.equal(providers.counts.cloudflare, 1); assert.equal(providers.counts.klein ?? 0, 0); assert.equal(gem(), 0);
    assert.equal(posterCount(u), 0); assert.equal(fake.keys('imgok:').length, 0);
    return { actual: 'rejected, nothing else tried, slot returned' };
  });

scenario('O3', 'UNREADABLE verdicts ("not safe", "cannot confirm this is safe", empty, non-string) are rejected as unsafe and do NOT trigger the paid fallback',
  'each → CONTENT_REFUSED, gemini-check=0', async () => {
    const cases = [['not safe', 'a'], ['cannot confirm this is safe', 'b'], ['', 'c'], [null, 'd'], ['safe', 'e'], ['User Safety: safe\nSafety Categories: Sexual', 'f']];
    for (const [raw, tag] of cases) {
      providers.moderationVerdict.raw = raw ?? undefined; providers.moderationVerdict.nonString = raw === null;
      const u = await makeUser(`o3${tag}`, 'free');
      const r = await plain(u, `198.51.100.${210 + tag.charCodeAt(0) - 97}`);
      assert.equal(r.body.code, 'CONTENT_REFUSED', JSON.stringify(raw)); assert.ok(r.body.isPlaceholder);
    }
    assert.equal(gem(), 0, 'an unreadable answer is a rejection, not a reason to spend money');
    return { actual: `${cases.length} malformed replies, all rejected, 0 paid calls` };
  });

scenario('O4', 'Nemotron 5xx → ONE short retry (2 calls) → paid Gemini fallback says safe → the image is served; the paid spend is counted against the daily cap',
  'moderation=2, gemini-check=1 (hasImage), 200 image, usage:check:paid:global=1', async () => {
    providers.mode.moderation = 503;
    const u = await makeUser('o4', 'free');
    const r = await plain(u, '198.51.100.220');
    assert.equal(r.status, 200); assert.ok(!r.body.isPlaceholder);
    assert.equal(nem(), 2, 'one attempt + one retry'); assert.equal(gem(), 1);
    assert.ok(providers.log.find((l) => l.provider === 'gemini-check').hasImage);
    assert.equal(checkSpend(), 1);
    const sent = providers.bodies.find((b) => b.provider === 'gemini-check').body;
    assert.equal(sent.generationConfig.responseSchema.properties.verdict.enum.join(), 'safe,unsafe');
    assert.ok(sent.safetySettings.some((s) => s.category === 'HARM_CATEGORY_SEXUALLY_EXPLICIT'));
    return { actual: 'fell back after the retry; 1 paid check counted' };
  });

scenario('O5', 'Nemotron 429 and Nemotron TIMEOUT also reach the fallback; a Nemotron "unsafe" never does',
  '429 → gemini-check=1; timeout → gemini-check=2 total', async () => {
    providers.mode.moderation = 429;
    const a = await plain(await makeUser('o5a', 'free'), '198.51.100.221'); assert.ok(!a.body.isPlaceholder);
    assert.equal(gem(), 1);
    ctx.advance(60_000);   // let the short circuit window pass; the point of this case is the timeout path
    providers.mode.moderation = 'timeout';
    const b = await plain(await makeUser('o5b', 'free'), '198.51.100.222'); assert.ok(!b.body.isPlaceholder);
    assert.equal(gem(), 2);
    return { actual: '429 and timeout both fell back to Gemini' };
  });

scenario('O6', 'both checkers down → CONTENT_CHECK_UNAVAILABLE placeholder (HTTP 200, isPlaceholder), quota released, image not shown; the circuit then skips the dead primary',
  'placeholder with code CONTENT_CHECK_UNAVAILABLE; usage:poster=0; next request: moderation calls unchanged', async () => {
    providers.mode.moderation = 500; providers.mode['gemini-check'] = 500;
    const u = await makeUser('o6', 'free');
    const r = await plain(u, '198.51.100.230');
    assert.equal(r.status, 200); assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(r.body.checkUnavailable, true);
    assert.equal(posterCount(u), 0);
    assert.equal(checkSpend(), 0, 'the failed paid call was not billed → slot returned');
    assert.equal(fake.keys('imgok:').length, 0);
    assert.ok(getMsg('CONTENT_CHECK_UNAVAILABLE', 'he').length > 20 && /Nothing was charged/.test(getMsg('CONTENT_CHECK_UNAVAILABLE', 'en')));
    const before = nem();
    const r2 = await plain(u, '198.51.100.230');
    assert.equal(r2.body.code, 'CONTENT_CHECK_UNAVAILABLE');
    assert.equal(nem(), before, 'circuit open: the dead primary is not called again');
    return { actual: 'unavailable placeholder, quota back, circuit skipped the primary' };
  });

scenario('O7', 'a Gemini block reason on the image is UNSAFE; an unreadable Gemini reply is UNSAFE; neither is retried elsewhere',
  'both → CONTENT_REFUSED', async () => {
    providers.mode.moderation = 500;
    providers.checkGemini.block = true;
    const a = await plain(await makeUser('o7a', 'free'), '198.51.100.231'); assert.equal(a.body.code, 'CONTENT_REFUSED');
    providers.checkGemini.block = false; providers.checkGemini.raw = 'maybe';
    ctx.advance(60_000);
    const b = await plain(await makeUser('o7b', 'free'), '198.51.100.232'); assert.equal(b.body.code, 'CONTENT_REFUSED');
    return { actual: 'block → refused; unreadable → refused' };
  });

scenario('O8', 'the paid fallback has a daily cap (here 2): the 3rd fallback is NOT made → unavailable; DAILY_CHECK_BUDGET=0 switches the fallback off; one log line + one Telegram per day',
  'gemini-check=2 then 0 more; third → CONTENT_CHECK_UNAVAILABLE', async () => {
    providers.mode.moderation = 500;
    const users = []; for (let i = 0; i < 3; i++) users.push(await makeUser(`o8-${i}`, 'free'));
    const r1 = await plain(users[0], '198.51.100.233'); const r2 = await plain(users[1], '198.51.100.234');
    assert.ok(!r1.body.isPlaceholder && !r2.body.isPlaceholder); assert.equal(gem(), 2);
    const r3 = await plain(users[2], '198.51.100.235');
    assert.equal(r3.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(gem(), 2, 'cap reached: no third paid call'); assert.equal(checkSpend(), 2);
    const keep = process.env.DAILY_CHECK_BUDGET;
    process.env.DAILY_CHECK_BUDGET = '0'; ctx.setNow('2026-10-16T00:05:00Z'); ctx.advance(0);
    const u4 = await makeUser('o8-4', 'free'); const r4 = await plain(u4, '198.51.100.236');
    process.env.DAILY_CHECK_BUDGET = keep;
    assert.equal(r4.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(gem(), 2, 'budget 0: fallback off');
    return { actual: 'cap enforced at 2, then off at 0' };
  });

scenario('O9', 'Star Yourself: an UNSAFE paid identity image keeps the charge (credit + global budget stay spent); an UNAVAILABLE checker hands back the user credit but the global budget slot stays counted',
  'unsafe → credit 1, budget 1; unavailable → credit 0, budget 1', async () => {
    const a = await makeUser('o9a', 'paid');
    providers.moderationVerdict.value = 'unsafe';
    const r = await plain(a, '198.51.100.240', { characterImageUrl: ctx.FACE_URL });
    assert.equal(r.body.code, 'CONTENT_REFUSED'); assert.equal(providers.counts.grok, 1);
    assert.equal(fake.num(`usage:identity:${a.identifier}:2026-10`), 1, 'rejected paid image is not a free retry');
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 1);
    providers.moderationVerdict.value = 'safe'; providers.mode.moderation = 500; providers.mode['gemini-check'] = 500;
    const b = await makeUser('o9b', 'paid');
    const r2 = await plain(b, '198.51.100.241', { characterImageUrl: ctx.FACE_URL });
    assert.equal(r2.body.code, 'CONTENT_CHECK_UNAVAILABLE');
    assert.equal(fake.num(`usage:identity:${b.identifier}:2026-10`), 0, 'user credit handed back');
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 2, 'but the money was spent: global budget still counts it');
    return { actual: 'unsafe: charged; unavailable: user refunded, budget counted' };
  });

scenario('O10', 'upload-panel: the bytes generate-poster just approved are stored with NO second model call (imgok marker hit)',
  'moderation unchanged by the upload; r2 put 1', async () => {
    const u = await makeUser('o10', 'free');
    const g = await plain(u, '198.51.100.250'); assert.ok(!g.body.isPlaceholder);
    const before = nem();
    const r = await up(u, '198.51.100.250', g.body.imageUrl);
    assert.equal(r.status, 200); assert.ok(r.body.url);
    assert.equal(nem(), before, 'no second check'); assert.equal(providers.s3puts.length, 1);
    return { actual: 'stored without a second check' };
  });

scenario('O11', 'upload-panel: a direct upload with no marker is checked first — unsafe → 422 and NOT stored; unavailable → 503 and NOT stored; safe → stored and marked. Upload quota untouched by rejections',
  'unsafe: 422, no put; unavailable: 503, no put; safe: put', async () => {
    const u = await makeUser('o11', 'free');
    providers.moderationVerdict.value = 'unsafe';
    const a = await up(u, '198.51.100.251');
    assert.equal(a.status, 422); assert.equal(a.body.code, 'CONTENT_REFUSED'); assert.equal(providers.s3puts.length, 0);
    providers.moderationVerdict.value = 'safe'; providers.mode.moderation = 500; providers.mode['gemini-check'] = 500;
    const b = await up(u, '198.51.100.251');
    assert.equal(b.status, 503); assert.equal(b.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(providers.s3puts.length, 0);
    assert.equal(fake.num(`upload:posters:${u.identifier}`), 0, 'rejections cost no upload quota');
    delete providers.mode.moderation; delete providers.mode['gemini-check']; ctx.advance(60_000);
    const c = await up(u, '198.51.100.251');
    assert.equal(c.status, 200); assert.equal(providers.s3puts.length, 1); assert.ok(marker());
    return { actual: '422 / 503 / 200 as designed' };
  });

scenario('O12', 'upload-panel: different bytes (even one byte more) do not inherit the marker — they are checked on their own',
  'moderation +1 for the second image; marker only for the approved bytes', async () => {
    const u = await makeUser('o12', 'free');
    const g = await plain(u, '198.51.100.252');
    const approved = marker(g.body.imageUrl);
    assert.ok(approved);
    const bytes = Buffer.concat([Buffer.from(PNG_DATA_URI.split(',')[1], 'base64'), Buffer.from([1])]);
    const other = `data:image/png;base64,${bytes.toString('base64')}`;
    assert.equal(marker(other), null, 'no marker for the other bytes');
    const before = nem();
    const r = await up(u, '198.51.100.252', other);
    assert.equal(r.status, 200); assert.equal(nem(), before + 1, 'checked on its own');
    return { actual: 'the extra byte forced a fresh check' };
  });

scenario('O13', 'Character Sheet: an UNSAFE generated sheet is not stored — the moderated raw selfie stays the reference (sheetGenerated false) and the charge stays',
  'selfie passes, sheet unsafe → no -sheet.jpg put, raw kept, sheet quota 1', async () => {
    const u = await makeUser('o13', 'free');
    providers.moderationVerdict.queue.push('User Safety: safe', 'User Safety: unsafe\nSafety Categories: Sexual');
    const r = await invoke(uploadCharacter, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: u.cookies, ip: '198.51.100.253' });
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, false);
    assert.ok(!providers.s3puts.some((p) => String(p.key).endsWith('-sheet.jpg')), 'sheet never stored');
    assert.ok(providers.s3puts.some((p) => String(p.key).endsWith('-raw.jpg')) && providers.s3deletes.length === 0, 'raw selfie kept as the reference');
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 1, 'the paid call was made → the charge stays');
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 1);
    return { actual: 'unsafe sheet dropped; raw selfie is the reference' };
  });

scenario('O14', 'Character Sheet: when no checker can answer, the sheet is not stored either; the sheet quota is handed back, the global budget slot stays counted (money was spent)',
  'sheet quota 0, global identity 1, raw kept', async () => {
    const u = await makeUser('o14', 'free');
    providers.moderationVerdict.queue.push('User Safety: safe', 500, 500);   // selfie ok; sheet check: attempt + retry fail
    providers.mode['gemini-check'] = 500;
    const r = await invoke(uploadCharacter, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: u.cookies, ip: '198.51.100.255' });
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, false);
    assert.ok(!providers.s3puts.some((p) => String(p.key).endsWith('-sheet.jpg')));
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0);
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 1);
    return { actual: 'sheet not stored; quota back; budget counted' };
  });
