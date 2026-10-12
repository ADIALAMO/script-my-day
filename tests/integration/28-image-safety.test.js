/** Scenario I — the SECOND-OPINION image safety check (nudity / sexualized / sexualized minor-looking), after Nemotron says "safe".
 *  Own budget DAILY_IMAGE_SAFETY_BUDGET, own circuit check_imgsafety; fail-closed; cached by the imgok marker. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

// 10 second-opinion calls per UTC day: 0.0015 / 0.00015. Every OTHER budget stays at its default so independence can be proven.
const ctx = await boot({ file: '28-image-safety', env: { DAILY_IMAGE_SAFETY_BUDGET: '0.0015' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const poster = await ctx.route('generate-poster');
const uploadPanel = await ctx.route('upload-panel');
const uploadCharacter = await ctx.route('upload-character');
const script = await ctx.route('generate-script');
const { imageHash } = await import('../../lib/image-check.js');

const plain = (u, ip) => invoke(poster, { body: { prompt: 'A lone figure walks into the rain' }, cookies: u.cookies, ip });
const posterCount = (u) => fake.num(`usage:poster:${u.identifier}:2026-10-15`);
const nem = () => providers.counts.moderation ?? 0;
const sec = () => providers.counts['gemini-imgsafety'] ?? 0;          // second-opinion calls
const fb = () => providers.counts['gemini-check'] ?? 0;               // fallback / text / minor calls (the other three checks)
const SAFETY_SPEND = () => fake.num('usage:check:imgsafety:global:2026-10-15');
const OTHER_SPENDS = () => ['paid', 'text', 'minor'].map((k) => fake.num(`usage:check:${k}:global:2026-10-15`));
const circuits = () => fake.keys('circuit:img:check_').map((k) => k.replace('circuit:img:', '')).sort();
const marker = (uri = PNG_DATA_URI) => fake.get(`imgok:${imageHash(uri)}`);
const ENTRY = 'I walked along the beach with my family and we laughed all afternoon.';
const callScript = (u, genre, ip) => invoke(script, { body: { journalEntry: ENTRY, genre, gender: 'neutral' }, cookies: u.cookies, ip });
const refused = (r, code = 'CONTENT_REFUSED') => { assert.equal(r.status, 200); assert.equal(r.body.isPlaceholder, true); assert.equal(r.body.code, code); assert.ok(r.body.imageUrl.startsWith('data:image/svg+xml')); };

scenario('I1', 'the request is exactly the documented question: image first, the nudity/sexualized/minor question, strict json_schema "image_safety", data_collection deny, Flash-Lite — and it runs AFTER Nemotron says safe',
  'one Nemotron call, then one second-opinion call with the pinned body', async () => {
    const u = await makeUser('i1', 'free');
    const r = await plain(u, '198.51.100.101');
    assert.equal(r.status, 200); assert.ok(!r.body.isPlaceholder);
    assert.equal(nem(), 1); assert.equal(sec(), 1); assert.equal(fb(), 0);
    const sent = providers.bodies.find((b) => b.provider === 'gemini-imgsafety').body;
    assert.equal(sent.model, 'google/gemini-2.5-flash-lite'); assert.deepEqual(sent.provider, { data_collection: 'deny' });
    assert.equal(sent.response_format.json_schema.name, 'image_safety'); assert.equal(sent.response_format.json_schema.strict, true);
    assert.equal(sent.messages[0].content[0].type, 'image_url', 'image first');
    assert.match(sent.messages[0].content[1].text, /nudity or sexualized content, or any sexualized depiction of a person who looks like a minor/);
    assert.equal(SAFETY_SPEND(), 1); assert.deepEqual(OTHER_SPENDS(), [0, 0, 0], 'the other three budgets are untouched');
    assert.ok(marker(r.body.imageUrl), 'approved by both checks → marker written');
    return { actual: 'Nemotron safe → one second-opinion call with the pinned body → served and marked' };
  });

scenario('I2', 'ONE image costs ONE extra call: generating it and then uploading the same bytes does not ask again (the imgok marker carries the result)',
  'second-opinion calls stay at 1 after the upload', async () => {
    const u = await makeUser('i2', 'free');
    const g = await plain(u, '198.51.100.102');
    const before = SAFETY_SPEND();
    const up = await invoke(uploadPanel, { body: { imageData: g.body.imageUrl, key: 'panels/x_00.png' }, cookies: u.cookies, ip: '198.51.100.102' });
    assert.ok(up.body.url);
    assert.equal(SAFETY_SPEND(), before); assert.equal(sec(), 1); assert.equal(nem(), 1);
    return { actual: 'generate + upload = 1 Nemotron + 1 second opinion' };
  });

scenario('I3', '"unsafe" from the second opinion holds the image back: placeholder + CONTENT_REFUSED, no other provider tried, poster slot returned, NO marker, nothing uploadable',
  'CONTENT_REFUSED; klein=0; usage:poster=0; no imgok; upload stores nothing', async () => {
    providers.imgSafety.value = 'unsafe';
    const u = await makeUser('i3', 'free');
    const r = await plain(u, '198.51.100.103');
    refused(r); assert.equal(r.body.contentRefused, true);
    assert.equal(providers.counts.klein ?? 0, 0); assert.equal(posterCount(u), 0); assert.equal(fake.keys('imgok:').length, 0);
    const up = await invoke(uploadPanel, { body: { imageData: PNG_DATA_URI, key: 'panels/x_00.png' }, cookies: u.cookies, ip: '198.51.100.103' });
    assert.equal(up.body.url, null); assert.equal(providers.s3puts.length, 0);
    return { actual: 'rejected by the second opinion, nothing stored' };
  });

scenario('I4', 'an UNREADABLE second-opinion reply (empty, prose, extra keys, wrong value, array, non-JSON) holds the image back — never "safe" — (the alert itself is the shared alertOnce helper, production-only like the other checks)',
  'each → CONTENT_REFUSED', async () => {
    const raws = ['', 'perhaps', '{"verdict":"safe","note":"x"}', '{"verdict":"maybe"}', '["safe"]', '{"verdict":true}'];
    let n = 0;
    for (const raw of raws) {
      providers.imgSafety.raw = raw;
      const r = await plain(await makeUser(`i4-${n}`, 'free'), `198.51.100.${110 + n++}`);
      refused(r);
    }
    assert.equal(fake.keys('imgok:').length, 0);
    assert.equal(circuits().length, 0, 'the service answered — no circuit');
    providers.imgSafety.raw = undefined;
    return { actual: `${raws.length} unreadable replies all refused` };
  });

scenario('I5', 'a REFUSAL by the second-opinion model itself (content_filter / IMAGE_SAFETY) holds the image back as a content refusal',
  'CONTENT_REFUSED', async () => {
    providers.imgSafety.block = true;
    const r = await plain(await makeUser('i5', 'free'), '198.51.100.120');
    refused(r);
    providers.imgSafety.block = false;
    return { actual: 'model refusal → refused' };
  });

scenario('I6', 'Nemotron "unsafe" is final and the second opinion is never consulted (no paid call for an image already rejected)',
  'sec=0', async () => {
    providers.moderationVerdict.value = 'unsafe';
    const before = sec();
    refused(await plain(await makeUser('i6', 'free'), '198.51.100.121'));
    assert.equal(sec(), before);
    providers.moderationVerdict.value = 'safe';
    return { actual: 'primary unsafe → no second opinion' };
  });

scenario('I7', 'an image the Gemini FALLBACK already approved (Nemotron down) is not asked twice: the fallback uses the image budget, the second opinion is skipped',
  'gemini-check=1, second opinion 0, DAILY_CHECK_BUDGET counter 1, image-safety counter unchanged', async () => {
    providers.mode.moderation = 500;
    const before = sec(); const spendBefore = SAFETY_SPEND();
    const r = await plain(await makeUser('i7', 'free'), '198.51.100.122');
    assert.ok(!r.body.isPlaceholder);
    assert.equal(fb(), 1); assert.equal(sec(), before); assert.equal(SAFETY_SPEND(), spendBefore);
    delete providers.mode.moderation; ctx.advance(120_000);
    return { actual: 'fallback approval stands on its own' };
  });

scenario('I8', 'BUDGET SPENT → fail-closed: CONTENT_CHECK_UNAVAILABLE placeholder (retryable, poster slot returned, nothing stored, no new paid call); the other three checks keep working',
  'cap of 10 reached → 4th image unavailable; counters of the other budgets unmoved by it; script classifier + minor screen + image fallback still serve', async () => {
    // I1, I2, I3(unsafe), I4(6 replies), I5 ... have consumed calls; set the counter to the cap explicitly so the test does not depend on that history
    fake.set('usage:check:imgsafety:global:2026-10-15', '10');
    const callsBefore = sec();
    const u = await makeUser('i8', 'free');
    const r = await plain(u, '198.51.100.123');
    refused(r, 'CONTENT_CHECK_UNAVAILABLE');
    assert.equal(sec(), callsBefore, 'no paid call once the cap is reached'); assert.equal(SAFETY_SPEND(), 10);
    assert.equal(posterCount(u), 0, 'quota returned'); assert.equal(fake.keys('imgok:').length, 0);
    // independence: the text classifier, the image fallback and the minor screen are unaffected
    const t = await callScript(await makeUser('i8t', 'free'), 'drama', '198.51.100.124');
    assert.equal(t.status, 200); assert.ok(t.body.script);
    providers.mode.moderation = 500;   // Nemotron down → the FALLBACK path answers, with the second opinion not needed
    const f = await plain(await makeUser('i8f', 'free'), '198.51.100.125');
    assert.ok(!f.body.isPlaceholder, 'the image fallback still serves');
    delete providers.mode.moderation; ctx.advance(120_000);
    const c = await invoke(uploadCharacter, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: (await makeUser('i8c', 'free')).cookies, ip: '198.51.100.126' });
    assert.ok(c.status === 200 || c.status === 422 || c.status === 503, 'the minor screen ran (its own budget) — the route answered');
    assert.ok((providers.counts['gemini-check'] ?? 0) >= 2);
    fake.set('usage:check:imgsafety:global:2026-10-15', '0');
    return { actual: 'cap reached → unavailable; text, fallback and minor budgets keep serving' };
  });

scenario('I9', 'DAILY_IMAGE_SAFETY_BUDGET=0 disables the paid call → fail-closed (every image unavailable, no spend); the other three budgets are not involved',
  '0 → CONTENT_CHECK_UNAVAILABLE, no call', async () => {
    ctx.env.DAILY_IMAGE_SAFETY_BUDGET = '0';
    const before = sec();
    refused(await plain(await makeUser('i9', 'free'), '198.51.100.127'), 'CONTENT_CHECK_UNAVAILABLE');
    assert.equal(sec(), before); assert.equal(SAFETY_SPEND(), 0);
    const t = await callScript(await makeUser('i9t', 'free'), 'romance', '198.51.100.128');
    assert.equal(t.status, 200, 'the text classifier (own budget) is unaffected');
    ctx.env.DAILY_IMAGE_SAFETY_BUDGET = '0.0015';
    return { actual: '0 = off = fail closed, others unaffected' };
  });

scenario('I10', 'SECOND-OPINION OUTAGE (500s) → CONTENT_CHECK_UNAVAILABLE, the slot is released (not billed), and ONLY check_imgsafety opens; then the open circuit makes no further call',
  'unavailable; circuits = [check_imgsafety]; counter back to 0; 2nd image → no call', async () => {
    providers.mode['gemini-imgsafety'] = 500;
    const u = await makeUser('i10', 'free');
    for (let i = 0; i < 3; i++) refused(await plain(u, `198.51.100.${130 + i}`), 'CONTENT_CHECK_UNAVAILABLE');
    assert.deepEqual(circuits(), ['check_imgsafety'], 'no other circuit moved');
    assert.equal(SAFETY_SPEND(), 0, 'failed technically → every reserved slot returned');
    const calls = sec();
    refused(await plain(u, '198.51.100.140'), 'CONTENT_CHECK_UNAVAILABLE');
    assert.equal(sec(), calls, 'circuit open → no call at all');
    assert.equal(posterCount(u), 0);
    return { actual: 'outage fail-closed, own circuit only' };
  });

scenario('I11', 'CIRCUIT INDEPENDENCE (both directions): with check_imgsafety OPEN the script classifier and the minor screen still run; and with check_text, check_minor and check_gemini failing/open the second opinion still answers',
  'imgsafety open: text ok; text/minor/fallback broken: image ok', async () => {
    // direction 1: open check_imgsafety by failing the second opinion
    providers.mode['gemini-imgsafety'] = 500;
    refused(await plain(await makeUser('i11o', 'free'), '198.51.100.150'), 'CONTENT_CHECK_UNAVAILABLE');
    assert.deepEqual(circuits(), ['check_imgsafety']);
    const t = await callScript(await makeUser('i11t', 'free'), 'horror', '198.51.100.141');
    assert.equal(t.status, 200, 'text classifier unaffected by the open image-safety circuit');
    // direction 2: break the other three, repair the second opinion, let its circuit expire
    delete providers.mode['gemini-imgsafety']; ctx.advance(120_000);
    providers.mode['gemini-check-text'] = 500; providers.mode['gemini-check-age'] = 500; providers.mode['gemini-check'] = 500;
    await callScript(await makeUser('i11t2', 'free'), 'romance', '198.51.100.142');     // opens check_text
    providers.mode.moderation = 500;                                                    // opens check_nemotron, forces the (broken) fallback → check_gemini
    await plain(await makeUser('i11p', 'free'), '198.51.100.143');
    delete providers.mode.moderation; ctx.advance(60_000);
    const before = sec();
    const r = await plain(await makeUser('i11p2', 'free'), '198.51.100.144');
    assert.ok(!r.body.isPlaceholder, 'Nemotron safe + second opinion safe → served although the other three checks are failing');
    assert.equal(sec(), before + 1);
    for (const k of ['gemini-check-text', 'gemini-check-age', 'gemini-check']) delete providers.mode[k];
    return { actual: 'circuits are independent in both directions' };
  });

scenario('I12', 'budgets are independent in the other direction too: exhausting the image-fallback, text and minor budgets does not stop the second opinion',
  'DAILY_CHECK_BUDGET/TEXT/MINOR spent → second opinion still answers', async () => {
    const day = '2026-10-15';
    fake.set(`usage:check:paid:global:${day}`, '100000'); fake.set(`usage:check:text:global:${day}`, '100000'); fake.set(`usage:check:minor:global:${day}`, '100000');
    fake.set(`usage:check:imgsafety:global:${day}`, '0'); ctx.advance(120_000);
    const before = sec();
    const r = await plain(await makeUser('i12', 'free'), '198.51.100.145');
    assert.ok(!r.body.isPlaceholder); assert.equal(sec(), before + 1);
    assert.deepEqual(OTHER_SPENDS(), [100000, 100000, 100000], 'the other counters were not touched');
    for (const k of ['paid', 'text', 'minor']) fake.set(`usage:check:${k}:global:${day}`, '0');
    return { actual: 'second opinion unaffected by the other three budgets' };
  });

scenario('I13', 'TIMEOUT of the second opinion → unavailable (fail-closed), slot released; a Character Sheet goes through the same second opinion (unsafe → sheet not stored)',
  'timeout → unavailable; sheet unsafe → no -sheet.jpg put', async () => {
    ctx.advance(300_000);
    providers.mode['gemini-imgsafety'] = 'timeout';
    refused(await plain(await makeUser('i13', 'free'), '198.51.100.146'), 'CONTENT_CHECK_UNAVAILABLE');
    delete providers.mode['gemini-imgsafety']; ctx.advance(300_000);
    providers.imgSafety.queue.push('unsafe');   // the first second-opinion call of the upload is the generated sheet
    const u = await makeUser('i13c', 'free');
    const before = providers.s3puts.length;
    await invoke(uploadCharacter, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.147' });
    const keys = providers.s3puts.slice(before).map((p) => p.key);
    assert.ok(!keys.some((k) => k.endsWith('-sheet.jpg')), 'an unsafe sheet is never stored');
    return { actual: 'timeout fail-closed; sheet goes through the second opinion' };
  });
