/** Scenario T — text output safety (scripts + storyboards: blocklist, romance/horror classifier, one regeneration) and the apparent-minor screen. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '26-text-safety' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const script = await ctx.route('generate-script');
const storyboard = await ctx.route('generate-storyboard');
const upload = await ctx.route('upload-character');

const ENTRY = 'I walked along the beach with my family and we laughed all afternoon.';
const callScript = (u, genre, ip) => invoke(script, { body: { journalEntry: ENTRY, genre, gender: 'neutral' }, cookies: u.cookies, ip });
const SCRIPT_USED = (u) => fake.num(`usage:script:${u.identifier}:2026-10-15`);
const COMIC_USED = (u) => fake.num(`usage:comic:${u.identifier}:2026-10`);
const SPEND = () => fake.num('usage:check:paid:global:2026-10-15');            // IMAGE check budget (DAILY_CHECK_BUDGET)
const TEXT_SPEND = () => fake.num('usage:check:text:global:2026-10-15');        // text classifier budget (DAILY_TEXT_CHECK_BUDGET)
const MINOR_SPEND = () => fake.num('usage:check:minor:global:2026-10-15');      // minor screen budget (DAILY_MINOR_CHECK_BUDGET)
const IMGSAFETY_SPEND = () => fake.num('usage:check:imgsafety:global:2026-10-15'); // second-opinion image check budget (DAILY_IMAGE_SAFETY_BUDGET)
const DEGRADED = () => fake.num('stats:textcheck:degraded:2026-10-15');
const textChecks = () => providers.log.filter((l) => l.provider === 'gemini-check' && !l.hasImage).length;
const ageChecks = () => providers.log.filter((l) => l.provider === 'gemini-check' && l.hasImage).length;
/** a plausible English script (> 500 chars, no Hebrew) so the cascade accepts it */
const scriptWith = (extra) => `**TEST TITLE**\n\n**OPENING:** drama\n\nINT. KITCHEN - DAY\n(${'Scene one. The hero meets the day and discovers everything changes. '.repeat(10)} ${extra})\n\n**THE END**\n[image: a lone figure at dawn, cinematic]`;
const BLATANT = 'a nude woman on a beach';
const REMINDER = 'REMINDER: the previous draft';
const geminiScriptBodies = () => providers.bodies.filter((b) => b.provider === 'gemini').map((b) => JSON.stringify(b.body));
const SB_SCRIPT = 'INT. HALL - DAY. A calm person waits in a quiet hall while the rain falls over the empty street outside.';
let seq = 0; const seed = () => `${Date.now()}${++seq}${Math.floor(Math.random() * 1e6)}`;
const callStoryboard = (u, genre, ip) => invoke(storyboard, { body: { script: SB_SCRIPT, lang: 'en', genre, comicStyle: 'anime', comicSeed: seed() }, cookies: u.cookies, ip });

scenario('T1', 'a clean DRAMA script now also goes through the text classifier (every genre); spend lands on the TEXT budget only; returned and counted',
  'text classifier ×1, text spend 1, image/minor spend 0, 200, usage:script=1', async () => {
    const u = await makeUser('t1', 'free');
    const r = await callScript(u, 'drama', '198.51.100.201');
    assert.equal(r.status, 200); assert.ok(r.body.script);
    assert.equal(textChecks(), 1); assert.equal(TEXT_SPEND(), 1); assert.equal(SPEND(), 0); assert.equal(MINOR_SPEND(), 0); assert.equal(SCRIPT_USED(u), 1);
    assert.equal(DEGRADED(), 0);
    return { actual: 'every genre is classified; own budget' };
  });

scenario('T2', 'ROMANCE and HORROR scripts go through the classifier too (text only, strict JSON, no-training routing); safe → returned; the paid call is counted against the TEXT budget',
  'one text classifier call each, text spend 2, image spend 0', async () => {
    const a = await makeUser('t2a', 'free'); const b = await makeUser('t2b', 'free');
    const r1 = await callScript(a, 'romance', '198.51.100.202'); const r2 = await callScript(b, 'horror', '198.51.100.203');
    assert.equal(r1.status, 200); assert.equal(r2.status, 200);
    assert.equal(textChecks(), 2); assert.equal(ageChecks(), 0); assert.equal(TEXT_SPEND(), 2); assert.equal(SPEND(), 0);
    const sent = providers.bodies.find((x) => x.provider === 'gemini-check').body;
    assert.equal(sent.model, 'google/gemini-2.5-flash-lite'); assert.deepEqual(sent.provider, { data_collection: 'deny' });
    assert.equal(sent.response_format.json_schema.schema.properties.verdict.enum.join(), 'safe,unsafe');
    assert.ok(sent.messages[0].content.length === 1 && sent.messages[0].content[0].type === 'text');
    assert.match(sent.messages[0].content[0].text, /TEXT START/); assert.match(sent.messages[0].content[0].text, /Scene one/);
    return { actual: 'classifier for romance + horror, text budget' };
  });

scenario('T3', 'classifier says UNSAFE → ONE regeneration with the safety reminder; still unsafe → 422 CONTENT_REFUSED, the quota slot is returned',
  'classifier ×2, script generated ×2, reminder only in the 2nd, usage:script 0', async () => {
    providers.checkGemini.value = 'unsafe';
    const u = await makeUser('t3', 'free');
    const r = await callScript(u, 'horror', '198.51.100.204');
    assert.equal(r.status, 422); assert.equal(r.body.code, 'CONTENT_REFUSED');
    assert.equal(textChecks(), 2); assert.equal(SCRIPT_USED(u), 0);
    const bodies = geminiScriptBodies();
    assert.equal(bodies.length, 2, 'exactly one regeneration');
    assert.ok(!bodies[0].includes(REMINDER) && bodies[1].includes(REMINDER));
    return { actual: 'refused after one regeneration; quota back' };
  });

scenario('T4', 'unsafe once, safe after the regeneration → the SECOND script is returned and charged once',
  'classifier unsafe,safe; 200; usage:script 1; two script generations; text spend 2', async () => {
    providers.checkGemini.queue.push('unsafe', 'safe');
    const u = await makeUser('t4', 'free');
    const r = await callScript(u, 'romance', '198.51.100.205');
    assert.equal(r.status, 200); assert.equal(SCRIPT_USED(u), 1); assert.equal(geminiScriptBodies().length, 2); assert.equal(TEXT_SPEND(), 2);
    return { actual: 'regeneration passed' };
  });

scenario('T5', 'blocklisted wording in the OUTPUT (any genre): one regeneration; clean second try is returned; held back twice → CONTENT_REFUSED + quota returned; the classifier only judges text the blocklist let through',
  'drama: blocked → regen → classified → 200; blocked ×2 → 422 with no classifier call', async () => {
    providers.scriptOutputs.queue.push(scriptWith(BLATANT));
    const a = await makeUser('t5a', 'free');
    const r1 = await callScript(a, 'drama', '198.51.100.206');
    assert.equal(r1.status, 200); assert.ok(!r1.body.script.toLowerCase().includes('nude')); assert.equal(SCRIPT_USED(a), 1);
    assert.ok(geminiScriptBodies()[1].includes(REMINDER));
    assert.equal(textChecks(), 1, 'the blocked first output never reached the classifier; the clean regeneration did');
    const before = textChecks();
    providers.scriptOutputs.queue.push(scriptWith(BLATANT), scriptWith(BLATANT));
    const b = await makeUser('t5b', 'free');
    const r2 = await callScript(b, 'drama', '198.51.100.207');
    assert.equal(r2.status, 422); assert.equal(r2.body.code, 'CONTENT_REFUSED'); assert.equal(SCRIPT_USED(b), 0);
    assert.equal(textChecks(), before, 'two blocklisted outputs → no classifier call at all');
    return { actual: 'output blocklist first, classifier second' };
  });

scenario('T6', 'classifier UNAVAILABLE (down, own circuit open, own daily cap spent): ROMANCE / HORROR fail CLOSED (503 CONTENT_CHECK_UNAVAILABLE, script not returned, quota + paid slot returned); every OTHER genre returns on the blocklist alone and bumps a degradation counter',
  'romance/horror 503; drama 200 + counter, no text stored', async () => {
    providers.mode['gemini-check-text'] = 500;
    const a = await makeUser('t6a', 'free');
    const down = await callScript(a, 'romance', '198.51.100.208');
    assert.equal(down.status, 503); assert.equal(down.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(down.body.script, undefined);
    assert.equal(SCRIPT_USED(a), 0); assert.equal(TEXT_SPEND(), 0, 'a failed paid call is not billed');
    const again = await callScript(await makeUser('t6b', 'free'), 'horror', '198.51.100.209');   // text circuit now open
    assert.equal(again.status, 503); assert.equal(textChecks(), 1, 'circuit open → no second paid call');
    // a non-risk genre is returned (blocklist only) and the degradation is COUNTED — number only
    const d = await makeUser('t6d', 'free');
    const drama = await callScript(d, 'drama', '198.51.100.211');
    assert.equal(drama.status, 200); assert.ok(drama.body.script); assert.equal(SCRIPT_USED(d), 1); assert.equal(DEGRADED(), 1);
    assert.ok(!fake.keys('stats:textcheck').some((k) => /scene|script|hero/i.test(k)), 'the counter key carries no text');
    // cap spent (own budget = 0): the same split
    delete providers.mode['gemini-check-text']; ctx.advance(120_000);
    const keep = process.env.DAILY_TEXT_CHECK_BUDGET; process.env.DAILY_TEXT_CHECK_BUDGET = '0';
    try {
      const capped = await callScript(await makeUser('t6c', 'free'), 'romance', '198.51.100.210');
      assert.equal(capped.status, 503); assert.equal(textChecks(), 1);
      const capDrama = await callScript(await makeUser('t6e', 'free'), 'comedy', '198.51.100.212');
      assert.equal(capDrama.status, 200); assert.equal(DEGRADED(), 2);
    } finally { if (keep === undefined) delete process.env.DAILY_TEXT_CHECK_BUDGET; else process.env.DAILY_TEXT_CHECK_BUDGET = keep; }
    return { actual: 'fail-closed for romance/horror; degraded + counted for the rest' };
  });

scenario('T7', 'STORYBOARD: blocklisted output → one regeneration with the reminder in the system instruction; clean second try is returned; held back twice → 422 and the comic quota is returned',
  'regen once; second 422; usage:comic 0 after refusal', async () => {
    providers.sbVisuals.queue.push(`A ${BLATANT} under soft light, medium shot`);
    const a = await makeUser('t7a', 'free');
    const ok = await callStoryboard(a, 'drama', '198.51.100.212');
    assert.equal(ok.status, 200); assert.ok(!JSON.stringify(ok.body.panels).toLowerCase().includes('nude'));
    const sys = [...new Set(providers.bodies.map((b) => b.body))].map((b) => b?.messages?.find?.((m) => m.role === 'system')?.content ?? b?.systemInstruction?.parts?.[0]?.text).filter(Boolean); // one entry per storyboard model call (the mock records some calls under two provider names)
    assert.equal(sys.length, 2); assert.ok(!sys[0].includes(REMINDER) && sys[1].includes(REMINDER));
    assert.equal(COMIC_USED(a), 1);
    providers.sbVisuals.queue.push(`A ${BLATANT}, wide shot`, `A ${BLATANT}, close up`);
    const b = await makeUser('t7b', 'free');
    const no = await callStoryboard(b, 'drama', '198.51.100.213');
    assert.equal(no.status, 422); assert.equal(no.body.code, 'CONTENT_REFUSED'); assert.equal(COMIC_USED(b), 0);
    return { actual: 'regenerated once, then refused; quota back' };
  });

scenario('T8', 'STORYBOARD: classifier unsafe twice → CONTENT_REFUSED; unavailable → CONTENT_CHECK_UNAVAILABLE for romance/horror but the panels are returned (degraded) for other genres; all refusals release the comic quota',
  'unsafe → 422; romance down → 503; drama down → 200', async () => {
    const a = await makeUser('t8a', 'free');
    providers.checkGemini.value = 'unsafe';
    const unsafe = await callStoryboard(a, 'horror', '198.51.100.214');
    assert.equal(unsafe.status, 422); assert.equal(COMIC_USED(a), 0); assert.equal(textChecks(), 2);
    providers.checkGemini.value = 'safe';
    const safe = await callStoryboard(a, 'romance', '198.51.100.214');
    assert.equal(safe.status, 200); assert.equal(COMIC_USED(a), 1);
    providers.mode['gemini-check-text'] = 500; ctx.advance(120_000);
    const b = await makeUser('t8b', 'free');
    const down = await callStoryboard(b, 'romance', '198.51.100.215');
    assert.equal(down.status, 503); assert.equal(down.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(COMIC_USED(b), 0);
    const c = await makeUser('t8c', 'free');
    const drama = await callStoryboard(c, 'drama', '198.51.100.216');
    assert.equal(drama.status, 200); assert.equal(COMIC_USED(c), 1); assert.equal(DEGRADED(), 1);
    return { actual: 'classifier outcomes honoured, quota returned, degraded for non-risk genres' };
  });

// ── apparent-minor screen ────────────────────────────────────────────────────────────────────────────────────────────────────
const withEnvT10 = async (name, value, fn) => { const keep = process.env[name]; process.env[name] = value; try { return await fn(); } finally { if (keep === undefined) delete process.env[name]; else process.env[name] = keep; } };
const up = (u, ip, extra = {}) => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true, ...extra }, cookies: u.cookies, ip });

scenario('T9', 'a photo that CLEARLY shows a child is rejected (422 MINOR_REJECTED) before anything is stored or generated; the sheet quota and the global identity budget are returned',
  '422; no R2 put; gemini-image=0; usage:sheet 0; global identity 0', async () => {
    providers.ageVerdict.value = 'minor';
    const u = await makeUser('t9', 'free');
    const r = await up(u, '198.51.100.220');
    assert.equal(r.status, 422); assert.equal(r.body.code, 'MINOR_REJECTED');
    assert.equal(providers.s3puts.length, 0); assert.equal(providers.counts['gemini-image'] ?? 0, 0); assert.equal(providers.counts.grok ?? 0, 0);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0); assert.equal(fake.num('usage:identity:global:2026-10-15'), 0);
    assert.equal(ageChecks(), 1);
    const sent = providers.bodies.filter((b) => b.provider === 'gemini-check').at(-1).body;
    assert.equal(sent.response_format.json_schema.name, 'apparent_age'); assert.deepEqual(sent.provider, { data_collection: 'deny' });
    assert.match(sent.messages[0].content[1].text, /Do not identify/);
    return { actual: 'clear child → rejected, nothing spent' };
  });

scenario('T10', 'adult, unsure and a model REFUSAL allow the upload; a TECHNICAL failure FAILS CLOSED (unreadable reply, provider error, open circuit, spent or zero budget) → 503 PHOTO_CHECK_UNAVAILABLE, nothing stored, quota + budget back',
  'adult/unsure/refusal → 200; unreadable/500/circuit/budget → 503 retryable, no R2 put, no sheet call, usage:sheet 0', async () => {
    const reset = () => { providers.ageVerdict.value = 'adult'; providers.ageVerdict.raw = undefined; providers.ageVerdict.block = false; delete providers.mode['gemini-check-age']; ctx.advance(120_000); };
    let n = 0;
    for (const [label, set] of [['adult', () => {}], ['unsure', () => { providers.ageVerdict.value = 'unsure'; }], ['refusal', () => { providers.ageVerdict.block = true; }]]) {
      reset(); set();
      const r = await up(await makeUser(`t10-ok-${n++}`, 'free'), `198.51.100.${230 + n}`);
      assert.equal(r.status, 200, label); assert.equal(r.body.sheetGenerated, true, label);
    }
    const closed = async (label, u, ip) => {
      providers.s3puts.length = 0; const sheetCalls = (providers.counts['gemini-image'] ?? 0) + (providers.counts.grok ?? 0); const g0 = fake.num('usage:identity:global:2026-10-15');
      const r = await up(u, ip);
      assert.equal(r.status, 503, label); assert.deepEqual(r.body, { success: false, code: 'PHOTO_CHECK_UNAVAILABLE' }, label);
      assert.equal(providers.s3puts.length, 0, `${label}: nothing stored`);
      assert.equal((providers.counts['gemini-image'] ?? 0) + (providers.counts.grok ?? 0), sheetCalls, `${label}: no paid sheet call`);
      assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0, `${label}: sheet quota given back`);
      assert.equal(fake.num('usage:identity:global:2026-10-15'), g0, `${label}: global identity budget given back`);
      return r;
    };
    reset(); providers.ageVerdict.raw = 'probably a kid';
    await closed('unreadable', await makeUser('t10-unreadable', 'free'), '198.51.100.236');
    reset(); providers.mode['gemini-check-age'] = 500;
    await closed('http 500', await makeUser('t10-500', 'free'), '198.51.100.237');
    // circuit open (the 500 case above opened check_minor) → no call at all, still closed
    const before = ageChecks();
    await closed('circuit open', await makeUser('t10-circuit', 'free'), '198.51.100.240');
    assert.equal(ageChecks(), before, 'open circuit → no call');
    // budget spent / zero → no call, closed
    delete providers.mode['gemini-check-age']; ctx.advance(120_000);
    await withEnvT10('DAILY_MINOR_CHECK_BUDGET', '0', async () => {
      const b0 = ageChecks();
      await closed('budget 0', await makeUser('t10-budget', 'free'), '198.51.100.241');
      assert.equal(ageChecks(), b0, 'no budget → no call');
    });
    return { actual: 'only a clear "minor" rejects with 422; technical failures fail closed with a retryable 503' };
  });

scenario('T11', 'refused uploads cost nothing: a quota-refused or consent-refused upload never reaches the age screen',
  'no gemini-check call for 429 / 400', async () => {
    const u = await makeUser('t11', 'free');
    for (let i = 0; i < 3; i++) assert.equal((await up(u, '198.51.100.250')).status, 200);
    const before = providers.counts['gemini-check'] ?? 0;
    assert.equal((await up(u, '198.51.100.250')).status, 429);                                   // 4th: monthly sheet quota
    ctx.advance(11 * 60 * 1000);   // past the upload rate-limit window (4 per 5 minutes)
    assert.equal((await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, adult: true }, cookies: u.cookies, ip: '198.51.100.250' })).status, 400);   // no consent
    assert.equal(providers.counts['gemini-check'] ?? 0, before);
    return { actual: 'no paid call on refused uploads' };
  });

scenario('T12', 'the minor screen has its OWN circuit: a failing face-photo screen opens only `check_minor` — the image output checks (`check_gemini`) stay closed and still work when Nemotron is down',
  'circuit:img:check_minor open, check_gemini absent; poster with Nemotron 500 → served by the fallback', async () => {
    const poster = await ctx.route('generate-poster');
    providers.mode['gemini-check-age'] = 500;
    const u = await makeUser('t12', 'free');
    const r = await up(u, '198.51.100.251');
    assert.equal(r.status, 503, 'a failed screen now fails closed'); assert.equal(r.body.code, 'PHOTO_CHECK_UNAVAILABLE');
    assert.equal(fake.keys('circuit:img:check_minor').length, 1, 'the screen\'s own circuit opened');
    assert.equal(fake.keys('circuit:img:check_gemini').length, 0, 'the image-check fallback circuit is untouched');
    // …and the image fallback checker is still usable: Nemotron down → Gemini decides → the image is served
    providers.mode.moderation = 500;
    const p = await invoke(poster, { body: { prompt: 'A lone figure walks into the rain' }, cookies: (await makeUser('t12b', 'free')).cookies, ip: '198.51.100.252' });
    assert.equal(p.status, 200); assert.ok(!p.body.isPlaceholder, 'image check fallback works while the screen circuit is open');
    assert.ok(providers.log.some((l) => l.provider === 'gemini-check' && l.hasImage && l.model), 'the image fallback made its call');
    // and the other direction: the screen being open does not need the shared key to be open
    const circuitState = fake.keys('circuit:img:');
    assert.ok(circuitState.includes('circuit:img:check_minor') && !circuitState.includes('circuit:img:check_gemini'));
    return { actual: 'separate circuits' };
  });

// ── independence of the three paid-check budgets and circuits ───────────────────────────────────────────────────────────────────
const posterRoute = await ctx.route('generate-poster');
const withEnv = async (name, value, fn) => { const keep = process.env[name]; process.env[name] = value; try { return await fn(); } finally { if (keep === undefined) delete process.env[name]; else process.env[name] = keep; } };
const posterWithNemotronDown = async (label) => {
  providers.mode.moderation = 500;
  const r = await invoke(posterRoute, { body: { prompt: 'A lone figure walks into the rain' }, cookies: (await makeUser(`ind-${label}`, 'free')).cookies, ip: `198.51.100.${60 + (++seq % 150)}` });
  delete providers.mode.moderation; return r;
};

scenario('T13', 'budget independence: exhausting the IMAGE budget (DAILY_CHECK_BUDGET=0) leaves the text classifier and the minor screen fully working',
  'image fallback unavailable; romance script 200 (text spend); minor screen still rejects a child (minor spend)', async () => {
    await withEnv('DAILY_CHECK_BUDGET', '0', async () => {
      const img = await posterWithNemotronDown('a');
      assert.equal(img.body.code, 'CONTENT_CHECK_UNAVAILABLE', 'the image fallback has no budget');
      const txt = await callScript(await makeUser('t13a', 'free'), 'romance', '198.51.100.31'); assert.equal(txt.status, 200); assert.equal(TEXT_SPEND(), 1);
      ctx.advance(120_000);   // the poster's Nemotron failures opened that circuit; let it close so the selfie's own image check (now the full two-opinion check) runs normally
      providers.ageVerdict.value = 'minor';
      const age = await up(await makeUser('t13b', 'free'), '198.51.100.32'); assert.equal(age.status, 422); assert.equal(age.body.code, 'MINOR_REJECTED'); assert.equal(MINOR_SPEND(), 1, 'the screen ran on its own budget');
      assert.equal(SPEND(), 0);
    });
    return { actual: 'image budget empty; text and minor unaffected' };
  });

scenario('T14', 'budget independence: exhausting the TEXT budget (DAILY_TEXT_CHECK_BUDGET=0) leaves the image fallback and the minor screen working; non-risk text degrades, romance/horror fail closed',
  'image fallback serves; minor rejects; romance 503; drama 200 degraded', async () => {
    await withEnv('DAILY_TEXT_CHECK_BUDGET', '0', async () => {
      const img = await posterWithNemotronDown('b');
      assert.equal(img.status, 200); assert.ok(!img.body.isPlaceholder, 'the image fallback still has its own budget'); assert.equal(SPEND(), 1);
      providers.ageVerdict.value = 'minor';
      const age = await up(await makeUser('t14a', 'free'), '198.51.100.33'); assert.equal(age.status, 422);
      assert.equal((await callScript(await makeUser('t14b', 'free'), 'horror', '198.51.100.34')).status, 503);
      assert.equal((await callScript(await makeUser('t14c', 'free'), 'drama', '198.51.100.35')).status, 200); assert.equal(DEGRADED(), 1);
      assert.equal(TEXT_SPEND(), 0);
    });
    return { actual: 'text budget empty; image and minor unaffected' };
  });

scenario('T15', 'budget independence: exhausting the MINOR budget (DAILY_MINOR_CHECK_BUDGET=0) closes only Star Yourself uploads (503 PHOTO_CHECK_UNAVAILABLE, no age call); the image fallback and the text classifier keep working',
  'age call skipped, upload 503; image fallback + romance script fine', async () => {
    await withEnv('DAILY_MINOR_CHECK_BUDGET', '0', async () => {
      providers.ageVerdict.value = 'minor';
      const before = ageChecks();
      const age = await up(await makeUser('t15a', 'free'), '198.51.100.36'); assert.equal(age.status, 503); assert.equal(age.body.code, 'PHOTO_CHECK_UNAVAILABLE'); assert.equal(ageChecks(), before, 'no age call without budget');
      const img = await posterWithNemotronDown('c'); assert.ok(!img.body.isPlaceholder); assert.equal(SPEND(), 1);
      assert.equal((await callScript(await makeUser('t15b', 'free'), 'romance', '198.51.100.37')).status, 200); assert.equal(TEXT_SPEND(), 1);
      assert.equal(MINOR_SPEND(), 0);
    });
    return { actual: 'minor budget empty; image and text unaffected' };
  });

scenario('T16', 'the five counters are separate keys: one call of each kind moves only its own counter',
  'image 1, text 1, minor 1, image-safety second opinion 2 (selfie + sheet), Nemotron primary 2 (selfie + sheet; the poster\'s failed attempts gave their slots back) (each in its own key)', async () => {
    await posterWithNemotronDown('d');
    ctx.advance(120_000);   // let the Nemotron circuit that the poster's failures opened expire, so the upload's own image check uses Nemotron again
    await callScript(await makeUser('t16a', 'free'), 'drama', '198.51.100.38');
    await up(await makeUser('t16b', 'free'), '198.51.100.39');
    assert.deepEqual([SPEND(), TEXT_SPEND(), MINOR_SPEND(), IMGSAFETY_SPEND()], [1, 1, 1, 2], 'the upload makes TWO second opinions now: the selfie and the generated sheet');
    assert.equal(fake.num('usage:check:nemotron:global:2026-10-15'), 2, 'the paid primary checker counts its own verdicts (selfie + sheet); the poster\'s technical failures released their slots');
    assert.deepEqual(fake.keys('usage:check:').sort(), ['usage:check:imgsafety:global:2026-10-15', 'usage:check:minor:global:2026-10-15', 'usage:check:nemotron:global:2026-10-15', 'usage:check:paid:global:2026-10-15', 'usage:check:text:global:2026-10-15']);
    return { actual: 'five independent counters' };
  });

scenario('T17', 'circuit independence: a failing text classifier opens ONLY check_text, a failing image fallback ONLY check_gemini, a failing screen ONLY check_minor — and the others keep serving',
  'each failure opens its own key only', async () => {
    const open = () => fake.keys('circuit:img:check_').map((k) => k.replace('circuit:img:', '')).sort();
    providers.mode['gemini-check-text'] = 500;
    await callScript(await makeUser('t17a', 'free'), 'romance', '198.51.100.40');
    assert.deepEqual(open(), ['check_text']);
    delete providers.mode['gemini-check-text']; fake.flush(); ctx.advance(120_000);
    providers.mode['gemini-check'] = 500; providers.mode.moderation = 500;
    const dead = await invoke(posterRoute, { body: { prompt: 'A lone figure walks into the rain' }, cookies: (await makeUser('t17b', 'free')).cookies, ip: '198.51.100.41' });
    assert.equal(dead.body.code, 'CONTENT_CHECK_UNAVAILABLE');
    assert.deepEqual(open().filter((k) => k !== 'check_nemotron'), ['check_gemini']);
    // with the image fallback circuit open, text + minor still work
    providers.mode.moderation = 0; delete providers.mode.moderation;
    assert.equal((await callScript(await makeUser('t17c', 'free'), 'romance', '198.51.100.42')).status, 200);
    ctx.advance(120_000);   // let the check_nemotron circuit opened by the dead poster above expire
    providers.ageVerdict.value = 'minor';
    assert.equal((await up(await makeUser('t17d', 'free'), '198.51.100.43')).status, 422);
    delete providers.mode['gemini-check']; fake.flush(); ctx.advance(120_000); providers.ageVerdict.value = 'adult';
    providers.mode['gemini-check-age'] = 500;
    await up(await makeUser('t17e', 'free'), '198.51.100.44');
    assert.deepEqual(open(), ['check_minor']);
    return { actual: 'three circuits, three keys' };
  });

scenario('T18', '"unsure" (e.g. a landscape with no person) is treated EXACTLY like "adult": the upload succeeds, the same objects are stored and cleaned up, the same quota and budget are spent, nothing is downgraded — and the screen result never reaches the response',
  'adult / unsure / refusal → identical outcome; unreadable → fail closed (503, nothing stored)', async () => {
    const outcome = async (label, set) => {
      providers.s3puts.length = 0; providers.s3deletes.length = 0; providers.ageVerdict.value = 'adult'; providers.ageVerdict.raw = undefined; providers.ageVerdict.block = false;
      set();
      const u = await makeUser(`t18-${label}`, 'free');
      const before = { global: fake.num('usage:identity:global:2026-10-15') };
      const r = await up(u, `198.51.100.${70 + (++seq % 100)}`);
      ctx.advance(11 * 60 * 1000);
      return {
        status: r.status,
        keys: Object.keys(r.body).sort().join(','),
        sheetGenerated: r.body.sheetGenerated, success: r.body.success,
        hasReference: typeof r.body.characterImageUrl === 'string' && r.body.characterImageUrl.endsWith('-sheet.jpg'),
        stored: providers.s3puts.map((p) => p.key.replace(/^characters\/[0-9a-f]{32}\/[0-9a-f-]{36}/, 'characters/<owner>/<id>')).sort().join('|'),
        deletedRaw: providers.s3deletes.length,
        sheetQuota: fake.num(`usage:sheet:${u.identifier}:2026-10`),
        identityBudgetDelta: fake.num('usage:identity:global:2026-10-15') - before.global,
        pointer: JSON.parse(fake.get(`character:${u.identifier}`)).status,
      };
    };
    const adult = await outcome('adult', () => { providers.ageVerdict.value = 'adult'; });
    const unsure = await outcome('unsure', () => { providers.ageVerdict.value = 'unsure'; });
    const refusal = await outcome('refusal', () => { providers.ageVerdict.block = true; });
    providers.s3puts.length = 0; providers.ageVerdict.value = 'adult'; providers.ageVerdict.block = false; providers.ageVerdict.raw = 'a landscape, no people';
    const unreadableR = await up(await makeUser('t18-unreadable', 'free'), `198.51.100.${70 + (++seq % 100)}`);
    providers.ageVerdict.raw = undefined; ctx.advance(11 * 60 * 1000);
    assert.equal(adult.status, 200); assert.equal(adult.sheetGenerated, true); assert.equal(adult.hasReference, true);
    assert.deepEqual(unsure, adult, '"unsure" changes nothing compared with "adult"');
    assert.deepEqual(refusal, adult);
    assert.equal(unreadableR.status, 503); assert.equal(unreadableR.body.code, 'PHOTO_CHECK_UNAVAILABLE'); assert.equal(providers.s3puts.length, 0, 'unreadable: nothing stored');
    assert.ok(!/apparent|minor|unsure|adult/i.test(adult.keys), 'the screen result is never part of the response');
    assert.equal(unsure.sheetQuota, 1); assert.equal(unsure.identityBudgetDelta, 1);
    return { actual: 'unsure = adult in every observable respect' };
  });
