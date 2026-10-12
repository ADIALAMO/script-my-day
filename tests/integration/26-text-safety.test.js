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
const SPEND = () => fake.num('usage:check:paid:global:2026-10-15');
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

scenario('T1', 'a clean DRAMA script is blocklist-checked only: no classifier call, no paid spend, returned and counted',
  'gemini-check=0, 200, usage:script=1', async () => {
    const u = await makeUser('t1', 'free');
    const r = await callScript(u, 'drama', '198.51.100.201');
    assert.equal(r.status, 200); assert.ok(r.body.script);
    assert.equal(providers.counts['gemini-check'] ?? 0, 0); assert.equal(SPEND(), 0); assert.equal(SCRIPT_USED(u), 1);
    return { actual: 'blocklist only, $0' };
  });

scenario('T2', 'ROMANCE and HORROR scripts go through the classifier (text only, strict JSON, no-training routing); safe → returned; the paid call is counted against DAILY_CHECK_BUDGET',
  'one text classifier call each, spend 2', async () => {
    const a = await makeUser('t2a', 'free'); const b = await makeUser('t2b', 'free');
    const r1 = await callScript(a, 'romance', '198.51.100.202'); const r2 = await callScript(b, 'horror', '198.51.100.203');
    assert.equal(r1.status, 200); assert.equal(r2.status, 200);
    assert.equal(textChecks(), 2); assert.equal(ageChecks(), 0); assert.equal(SPEND(), 2);
    const sent = providers.bodies.find((x) => x.provider === 'gemini-check').body;
    assert.equal(sent.model, 'google/gemini-2.5-flash-lite'); assert.deepEqual(sent.provider, { data_collection: 'deny' });
    assert.equal(sent.response_format.json_schema.schema.properties.verdict.enum.join(), 'safe,unsafe');
    assert.ok(sent.messages[0].content.length === 1 && sent.messages[0].content[0].type === 'text');
    assert.match(sent.messages[0].content[0].text, /TEXT START/); assert.match(sent.messages[0].content[0].text, /Scene one/);
    return { actual: 'classifier for romance + horror only' };
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
  'classifier unsafe,safe; 200; usage:script 1; two script generations', async () => {
    providers.checkGemini.queue.push('unsafe', 'safe');
    const u = await makeUser('t4', 'free');
    const r = await callScript(u, 'romance', '198.51.100.205');
    assert.equal(r.status, 200); assert.equal(SCRIPT_USED(u), 1); assert.equal(geminiScriptBodies().length, 2); assert.equal(SPEND(), 2);
    return { actual: 'regeneration passed' };
  });

scenario('T5', 'blocklisted wording in the OUTPUT (any genre): one regeneration; clean second try is returned; held back twice → CONTENT_REFUSED + quota returned; the classifier is not involved for drama',
  'drama: blocked → regen → 200; blocked ×2 → 422', async () => {
    providers.scriptOutputs.queue.push(scriptWith(BLATANT));
    const a = await makeUser('t5a', 'free');
    const r1 = await callScript(a, 'drama', '198.51.100.206');
    assert.equal(r1.status, 200); assert.ok(!r1.body.script.toLowerCase().includes('nude')); assert.equal(SCRIPT_USED(a), 1);
    assert.ok(geminiScriptBodies()[1].includes(REMINDER));
    providers.scriptOutputs.queue.push(scriptWith(BLATANT), scriptWith(BLATANT));
    const b = await makeUser('t5b', 'free');
    const r2 = await callScript(b, 'drama', '198.51.100.207');
    assert.equal(r2.status, 422); assert.equal(r2.body.code, 'CONTENT_REFUSED'); assert.equal(SCRIPT_USED(b), 0);
    assert.equal(providers.counts['gemini-check'] ?? 0, 0, 'no classifier for drama');
    return { actual: 'output blocklist works for every genre' };
  });

scenario('T6', 'classifier required but UNAVAILABLE (down, circuit, or daily cap spent) → 503 CONTENT_CHECK_UNAVAILABLE, the script is NOT returned, quota and the paid slot are given back',
  '503 each time; usage:script 0; spend 0', async () => {
    providers.mode['gemini-check'] = 500;
    const a = await makeUser('t6a', 'free');
    const down = await callScript(a, 'romance', '198.51.100.208');
    assert.equal(down.status, 503); assert.equal(down.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(down.body.script, undefined);
    assert.equal(SCRIPT_USED(a), 0); assert.equal(SPEND(), 0, 'a failed paid call is not billed');
    const again = await callScript(await makeUser('t6b', 'free'), 'horror', '198.51.100.209');   // circuit now open
    assert.equal(again.status, 503); assert.equal(textChecks(), 1, 'circuit open → no second paid call');
    delete providers.mode['gemini-check']; ctx.advance(120_000);
    const keep = process.env.DAILY_CHECK_BUDGET; process.env.DAILY_CHECK_BUDGET = '0';
    const capped = await callScript(await makeUser('t6c', 'free'), 'romance', '198.51.100.210');
    process.env.DAILY_CHECK_BUDGET = keep;
    assert.equal(capped.status, 503); assert.equal(textChecks(), 1);
    // a non-classifier genre is unaffected while the classifier is down
    providers.mode['gemini-check'] = 500; ctx.advance(120_000);
    assert.equal((await callScript(await makeUser('t6d', 'free'), 'drama', '198.51.100.211')).status, 200);
    return { actual: 'fail-closed for romance/horror only' };
  });

scenario('T7', 'STORYBOARD: blocklisted output → one regeneration with the reminder in the system instruction; clean second try is returned; held back twice → 422 and the comic quota is returned',
  'regen once; second 422; usage:comic 0 after refusal', async () => {
    providers.sbVisuals.queue.push(`A ${BLATANT} under soft light, medium shot`);
    const a = await makeUser('t7a', 'free');
    const ok = await callStoryboard(a, 'drama', '198.51.100.212');
    assert.equal(ok.status, 200); assert.ok(!JSON.stringify(ok.body.panels).toLowerCase().includes('nude'));
    const sys = providers.bodies.filter((b) => b.body?.messages?.some?.((m) => m.role === 'system')).map((b) => b.body.messages.find((m) => m.role === 'system').content);
    assert.equal(sys.length, 2); assert.ok(!sys[0].includes(REMINDER) && sys[1].includes(REMINDER));
    assert.equal(COMIC_USED(a), 1);
    providers.sbVisuals.queue.push(`A ${BLATANT}, wide shot`, `A ${BLATANT}, close up`);
    const b = await makeUser('t7b', 'free');
    const no = await callStoryboard(b, 'drama', '198.51.100.213');
    assert.equal(no.status, 422); assert.equal(no.body.code, 'CONTENT_REFUSED'); assert.equal(COMIC_USED(b), 0);
    return { actual: 'regenerated once, then refused; quota back' };
  });

scenario('T8', 'STORYBOARD romance/horror: classifier unsafe twice → CONTENT_REFUSED; unavailable → CONTENT_CHECK_UNAVAILABLE; both release the comic quota; a safe verdict returns the panels',
  'unsafe → 422; down → 503; safe → 200', async () => {
    const a = await makeUser('t8a', 'free');
    providers.checkGemini.value = 'unsafe';
    const unsafe = await callStoryboard(a, 'horror', '198.51.100.214');
    assert.equal(unsafe.status, 422); assert.equal(COMIC_USED(a), 0); assert.equal(textChecks(), 2);
    providers.checkGemini.value = 'safe';
    const safe = await callStoryboard(a, 'romance', '198.51.100.214');
    assert.equal(safe.status, 200); assert.equal(COMIC_USED(a), 1);
    providers.mode['gemini-check'] = 500; ctx.advance(120_000);
    const b = await makeUser('t8b', 'free');
    const down = await callStoryboard(b, 'romance', '198.51.100.215');
    assert.equal(down.status, 503); assert.equal(down.body.code, 'CONTENT_CHECK_UNAVAILABLE'); assert.equal(COMIC_USED(b), 0);
    return { actual: 'classifier outcomes honoured, quota returned' };
  });

// ── apparent-minor screen ────────────────────────────────────────────────────────────────────────────────────────────────────
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

scenario('T10', 'everything else ALLOWS the upload (it is a best-effort screen, not a gate): adult, unsure, unreadable, a model refusal, a technical failure, an open circuit, a spent daily budget',
  'every case → 200 sheetGenerated', async () => {
    const cases = [
      ['adult', () => { providers.ageVerdict.value = 'adult'; }],
      ['unsure', () => { providers.ageVerdict.value = 'unsure'; }],
      ['unreadable', () => { providers.ageVerdict.raw = 'probably a kid'; }],
      ['refusal', () => { providers.ageVerdict.block = true; }],
      ['http 500', () => { providers.mode['gemini-check'] = 500; }],
    ];
    let n = 0;
    for (const [label, set] of cases) {
      providers.ageVerdict.value = 'adult'; providers.ageVerdict.raw = undefined; providers.ageVerdict.block = false; delete providers.mode['gemini-check']; ctx.advance(120_000);
      set();
      const u = await makeUser(`t10-${n++}`, 'free');
      const r = await up(u, `198.51.100.${230 + n}`);
      assert.equal(r.status, 200, label); assert.equal(r.body.sheetGenerated, true, label);
    }
    // circuit open (the 500 case above opened it) → the screen is skipped without a call
    const before = ageChecks();
    const u2 = await makeUser('t10-circuit', 'free'); const r2 = await up(u2, '198.51.100.240');
    assert.equal(r2.status, 200); assert.equal(ageChecks(), before, 'open circuit → no call');
    // budget spent → skipped without a call
    delete providers.mode['gemini-check']; ctx.advance(120_000);
    const keep = process.env.DAILY_CHECK_BUDGET; process.env.DAILY_CHECK_BUDGET = '0';
    const u3 = await makeUser('t10-budget', 'free'); const r3 = await up(u3, '198.51.100.241');
    process.env.DAILY_CHECK_BUDGET = keep;
    assert.equal(r3.status, 200); assert.equal(ageChecks(), before, 'cap spent → no call');
    return { actual: 'only an unambiguous "minor" rejects' };
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
