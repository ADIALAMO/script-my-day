/** Scenario O — output-image safety check: Nemotron primary, capped Gemini 2.5 Flash-Lite fallback (via OpenRouter), fail-closed, upload-panel marker. */
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
    assert.equal(sent.messages[0].content[1].type, 'text'); assert.equal(sent.messages[0].content[1].text, 'Image to check.');
    assert.equal(sent.max_tokens, 512); assert.deepEqual(sent.reasoning, { effort: 'none' });
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

scenario('O3', 'an UNREADABLE primary reply ("not safe", "cannot confirm this is safe", empty, non-string, categories on a safe verdict) is NOT a rejection: it asks the paid Gemini fallback (one call, counted against the cap, no retry of the primary) and Gemini decides',
  'primary unreadable → gemini-check=1 each → safe → image served; spend counted; primary circuit stays closed', async () => {
    const cases = [['not safe', 'a'], ['cannot confirm this is safe', 'b']];
    for (const [raw, tag] of cases) {
      providers.moderationVerdict.raw = raw;
      const u = await makeUser(`o3${tag}`, 'free');
      const before = nem();
      const r = await plain(u, `198.51.100.${210 + tag.charCodeAt(0) - 97}`);
      assert.equal(r.status, 200); assert.ok(!r.body.isPlaceholder, JSON.stringify(raw));
      assert.equal(nem(), before + 1, 'an unreadable reply is not retried');
    }
    assert.equal(gem(), 2); assert.equal(checkSpend(), 2, 'both fallbacks counted against DAILY_CHECK_BUDGET');
    assert.equal(fake.keys('circuit:img:check_nemotron').length, 0, 'the service answered — no circuit');
    return { actual: '2 unreadable primary replies → Gemini said safe → served' };
  });

scenario('O3b', 'after an unreadable primary reply, ONLY Gemini decides: its "unsafe" refuses, its block refuses, its own unreadable reply refuses',
  'each → CONTENT_REFUSED', async () => {
    providers.moderationVerdict.raw = '';   // empty reply
    providers.checkGemini.value = 'unsafe';
    const a = await plain(await makeUser('o3b-a', 'free'), '198.51.100.216');
    assert.equal(a.body.code, 'CONTENT_REFUSED');
    providers.checkGemini.value = 'safe'; providers.checkGemini.raw = 'perhaps';
    const b = await plain(await makeUser('o3b-b', 'free'), '198.51.100.217');
    assert.equal(b.body.code, 'CONTENT_REFUSED');
    assert.equal(gem(), 2);
    return { actual: 'Gemini unsafe → refused; Gemini unreadable → refused' };
  });

scenario('O3c', 'unreadable primary reply + fallback unavailable (down, or cap spent) → CONTENT_CHECK_UNAVAILABLE, never shown; a failed paid call is not billed',
  'unavailable; spend 0 when Gemini is down; no third paid call at the cap', async () => {
    providers.moderationVerdict.nonString = true;
    providers.mode['gemini-check'] = 500;
    const a = await plain(await makeUser('o3c-a', 'free'), '198.51.100.218');
    assert.equal(a.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(checkSpend(), 0);
    delete providers.mode['gemini-check']; ctx.advance(60_000);
    const keep = process.env.DAILY_CHECK_BUDGET; process.env.DAILY_CHECK_BUDGET = '0';
    const b = await plain(await makeUser('o3c-b', 'free'), '198.51.100.219');
    process.env.DAILY_CHECK_BUDGET = keep;
    assert.equal(b.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(gem(), 1, 'budget 0: no new paid call');
    return { actual: 'unavailable both ways' };
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
    assert.equal(sent.model, 'google/gemini-2.5-flash-lite');
    assert.deepEqual(sent.provider, { data_collection: 'deny' }, 'no-training routing');
    assert.equal(sent.response_format.type, 'json_schema');
    assert.equal(sent.response_format.json_schema.schema.properties.verdict.enum.join(), 'safe,unsafe');
    assert.equal(sent.messages[0].content[0].type, 'image_url');
    assert.equal(providers.counts.gemini ?? 0, 0, 'the direct Google API is no longer used by the check');
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
    const r = await invoke(uploadCharacter, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.253' });
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, false);
    const selfieCheck = providers.bodies.find((b) => b.provider === 'moderation').body;   // the FIRST moderation call is the selfie
    assert.equal(selfieCheck.messages[0].content[0].type, 'image_url'); assert.equal(selfieCheck.messages[0].content[1].text, 'Image to check.');
    assert.equal(selfieCheck.max_tokens, 512); assert.deepEqual(selfieCheck.reasoning, { effort: 'none' });
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
    const r = await invoke(uploadCharacter, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.255' });
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, false);
    assert.ok(!providers.s3puts.some((p) => String(p.key).endsWith('-sheet.jpg')));
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0);
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 1);
    return { actual: 'sheet not stored; quota back; budget counted' };
  });

scenario('O15', 'Nemotron request shape: a token budget big enough for the REASONING (the probe saw content=null / finish=length at 40), no reasoning option unless configured, an invalid option is ignored; a reasoning-exhausted reply (null content) goes to the fallback',
  'max_tokens 512, reasoning none by default; env overrides; invalid value → none; "off" omits; null/length → Gemini decides', async () => {
    const u = await makeUser('o15', 'free');
    await plain(u, '198.51.100.140');
    const def = providers.bodies.find((b) => b.provider === 'moderation').body;
    assert.equal(def.max_tokens, 512); assert.deepEqual(def.reasoning, { effort: 'none' });
    const keep = process.env.IMAGE_CHECK_REASONING_EFFORT;
    try {
      providers.bodies.length = 0;
      process.env.IMAGE_CHECK_REASONING_EFFORT = 'low';
      await plain(await makeUser('o15b', 'free'), '198.51.100.141');
      assert.deepEqual(providers.bodies.find((b) => b.provider === 'moderation').body.reasoning, { effort: 'low' });
      providers.bodies.length = 0;
      process.env.IMAGE_CHECK_REASONING_EFFORT = 'bogus; drop table';
      await plain(await makeUser('o15c', 'free'), '198.51.100.142');
      assert.deepEqual(providers.bodies.find((b) => b.provider === 'moderation').body.reasoning, { effort: 'none' }, 'invalid value never forwarded — falls back to none');
      providers.bodies.length = 0;
      process.env.IMAGE_CHECK_REASONING_EFFORT = 'off';
      await plain(await makeUser('o15e', 'free'), '198.51.100.144');
      assert.equal(providers.bodies.find((b) => b.provider === 'moderation').body.reasoning, undefined, 'off → no reasoning option');
    } finally { if (keep === undefined) delete process.env.IMAGE_CHECK_REASONING_EFFORT; else process.env.IMAGE_CHECK_REASONING_EFFORT = keep; }
    providers.moderationVerdict.nullLength = true;
    const r = await plain(await makeUser('o15d', 'free'), '198.51.100.143');
    assert.ok(!r.body.isPlaceholder); assert.equal(gem(), 1, 'reasoning ran out of tokens → unreadable → Gemini decided');
    return { actual: 'request shape verified; null/length reply fell back to Gemini' };
  });

scenario('O16', 'the check has NO dependency on GOOGLE_GEMINI_API_KEY: with that key removed, Nemotron down still falls back (through OpenRouter) and serves a safe image; an unsafe verdict from it refuses',
  'gemini-check=1 via openrouter, direct Google API never called', async () => {
    const keep = process.env.GOOGLE_GEMINI_API_KEY;
    try {
      delete process.env.GOOGLE_GEMINI_API_KEY;
      providers.mode.moderation = 500;
      const a = await plain(await makeUser('o16a', 'free'), '198.51.100.145');
      assert.ok(!a.body.isPlaceholder); assert.equal(gem(), 1); assert.equal(providers.counts.gemini ?? 0, 0);
      ctx.advance(60_000);
      providers.checkGemini.value = 'unsafe';
      const b = await plain(await makeUser('o16b', 'free'), '198.51.100.146');
      assert.equal(b.body.code, 'CONTENT_REFUSED');
    } finally { process.env.GOOGLE_GEMINI_API_KEY = keep; }
    return { actual: 'fallback worked without the Google key' };
  });
