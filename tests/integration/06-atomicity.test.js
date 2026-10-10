/**
 * Scenario G — atomicity under parallel requests (G5–G7 were red before the poster quota / identity credit became atomic).
 * The per-minute sliding-window limiter is switched OFF for these (the fake Redis refuses EVAL, which the
 * app treats as an Upstash outage and fails open) so that the QUOTA logic itself — not the limiter — has to
 * stop the burst. G1–G4 are the owner's list; G5–G6 are extra probes for counters that are not reserved atomically.
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '06-atomicity' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const upload = await ctx.route('upload-character');
const poster = await ctx.route('generate-poster');
const storyboard = await ctx.route('generate-storyboard');
const script = await ctx.route('generate-script');
const SCRIPT = 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.';
const limiterOff = () => fake.control.failCommands.add('EVAL');
const count = (rs, code) => rs.filter((r) => r.body?.code === code).length;
const ok = (rs) => rs.filter((r) => r.status === 200).length;
const FACE = 'https://pub-test.r2.dev/characters/face.jpg';

scenario('G1', '25 PARALLEL identity uploads for one Free user (quota 3): exactly 3 reach a paid provider',
  '3×200, 22×429 QUOTA_SHEET, gemini-image=3, global budget=3, sheet counter=3', async () => {
    limiterOff();
    const u = await makeUser('g1', 'free');
    const rs = await Promise.all(Array.from({ length: 25 }, () => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: u.cookies, ip: '198.51.100.70' })));
    assert.equal(ok(rs), 3); assert.equal(count(rs, 'QUOTA_SHEET'), 22);
    assert.equal(providers.counts['gemini-image'], 3);
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 3);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 3);
    return { actual: `200×${ok(rs)}, QUOTA_SHEET×${count(rs, 'QUOTA_SHEET')}; paid gemini-image calls ${providers.counts['gemini-image']}; moderation (free) ${providers.counts.moderation}` };
  });

scenario('G1b', 'same burst with the rate limiter ON: still exactly 3 paid calls (4 pass the limiter, the rest are RATE_LIMITED)',
  'gemini-image=3', async () => {
    const u = await makeUser('g1b', 'free');
    const rs = await Promise.all(Array.from({ length: 25 }, () => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: u.cookies, ip: '198.51.100.71' })));
    assert.equal(providers.counts['gemini-image'], 3);
    return { actual: `200×${ok(rs)}, QUOTA_SHEET×${count(rs, 'QUOTA_SHEET')}, RATE_LIMITED×${count(rs, 'RATE_LIMITED')}` };
  });

scenario('G2', '25 PARALLEL regenerations of one panel (limit 2): exactly 2 reach the provider; 25 parallel FIRST images of a new panel: exactly 1 + 2',
  'regen burst: 2×200; first-image burst: 3×200; Klein calls match', async () => {
    limiterOff();
    const u = await makeUser('g2', 'free');
    const cs = await invoke(storyboard, { body: { script: SCRIPT, lang: 'en', genre: 'drama', comicSeed: '90000000001' }, cookies: u.cookies, ip: '198.51.100.72' });
    assert.equal(cs.status, 200);
    const panel = (idx) => invoke(poster, { body: { prompt: 'a calm person', requestType: 'comic', panelIndex: idx, comicSeed: '90000000001' }, cookies: u.cookies, ip: '198.51.100.72' });
    assert.equal((await panel(0)).status, 200);
    const k0 = providers.counts.klein;
    const regen = await Promise.all(Array.from({ length: 25 }, () => panel(0)));
    assert.equal(ok(regen), 2); assert.equal(count(regen, 'QUOTA_PANEL_REGEN'), 23);
    assert.equal(providers.counts.klein - k0, 2);
    // a fresh comic: 25 parallel requests for a never-generated panel
    const cs2 = await invoke(storyboard, { body: { script: SCRIPT, lang: 'en', genre: 'drama', comicSeed: '90000000002' }, cookies: u.cookies, ip: '198.51.100.72' });
    assert.equal(cs2.status, 200);
    const k1 = providers.counts.klein;
    const first = await Promise.all(Array.from({ length: 25 }, () => invoke(poster, { body: { prompt: 'a calm person', requestType: 'comic', panelIndex: 1, comicSeed: '90000000002' }, cookies: u.cookies, ip: '198.51.100.72' })));
    assert.equal(ok(first), 3); assert.equal(providers.counts.klein - k1, 3);
    return { actual: `regen burst: 200×${ok(regen)}/429×${count(regen, 'QUOTA_PANEL_REGEN')} (+${providers.counts.klein - k0 - 0 - 3} klein beyond); first-image burst: 200×${ok(first)}` };
  });

scenario('G3', 'PARALLEL Pro scripts near the cap (18 used, 10 in flight): exactly 2 reach a provider; 40 in flight from zero: exactly 20',
  '2×200 + 8×429 QUOTA_SCRIPT_PRO; then 20×200', async () => {
    limiterOff();
    const u = await makeUser('g3', 'paid');
    fake.set(`usage:script:${u.identifier}:2026-10-15`, 18);
    const B = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama' };
    const rs = await Promise.all(Array.from({ length: 10 }, () => invoke(script, { body: B, cookies: u.cookies, ip: '198.51.100.73' })));
    assert.equal(ok(rs), 2); assert.equal(count(rs, 'QUOTA_SCRIPT_PRO'), 8);
    assert.equal(providers.counts.gemini, 2, '2 scripts × 1 call each (hedged Gemini: the second model only starts for slow/failed answers)');
    fake.del(`usage:script:${u.identifier}:2026-10-15`);
    providers.reset();
    const many = await Promise.all(Array.from({ length: 40 }, () => invoke(script, { body: B, cookies: u.cookies, ip: '198.51.100.73' })));
    assert.equal(ok(many), 20); assert.equal(count(many, 'QUOTA_SCRIPT_PRO'), 20);
    return { actual: 'near-cap burst: 2 allowed; from-zero burst of 40: exactly 20 allowed' };
  });

scenario('G4', '10 PARALLEL storyboards for a Free user (3 comics/month): exactly 3 call the storyboard model',
  '3×200, 7×429 QUOTA_COMIC_MONTH, storyboard model calls 3', async () => {
    limiterOff();
    const u = await makeUser('g4', 'free');
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => invoke(storyboard, { body: { script: SCRIPT, lang: 'en', genre: 'drama', comicSeed: `9100000000${i}` }, cookies: u.cookies, ip: '198.51.100.74' })));
    assert.equal(ok(rs), 3); assert.equal(count(rs, 'QUOTA_COMIC_MONTH'), 7);
    assert.equal(providers.counts['openrouter-text'], 3);
    const unlocked = rs.filter((r) => r.status === 200).map((r) => r.body.unlockedPanels).sort();
    assert.deepEqual(unlocked, [3, 3, 7], '"first comic" bonus granted exactly once even in a race');
    return { actual: `200×3 (unlocked ${unlocked}), 429×7; model calls ${providers.counts['openrouter-text']}` };
  });

scenario('G5', '25 PARALLEL standalone posters for a Free user (limit 2/day)',
  'at most 2 successful posters (quota counted atomically)', async () => {
    limiterOff();
    providers.mode.cloudflare = 500;                                   // force the PAID Klein fallback so overshoot costs money
    const u = await makeUser('g5', 'free');
    const rs = await Promise.all(Array.from({ length: 25 }, () => invoke(poster, { body: { prompt: 'A lone figure at dawn' }, cookies: u.cookies, ip: '198.51.100.75' })));
    const good = rs.filter((r) => r.status === 200 && r.body.success && !r.body.isPlaceholder).length;
    assert.equal(good, 2, `${good} posters succeeded for a quota of 2 (Klein paid calls: ${providers.counts.klein})`);
    assert.equal(providers.counts.klein, 2, 'only the 2 allowed posters reached the paid fallback');
    assert.equal(fake.num(`usage:poster:${u.identifier}:2026-10-15`), 2, 'counter ends exactly at the limit (refusals rolled back)');
    return { actual: `${good} succeeded, ${count(rs, 'QUOTA_POSTER')} refused with QUOTA_POSTER; Klein calls ${providers.counts.klein}` };
  });

scenario('G6', '25 PARALLEL face posters for a Free user whose single lifetime identity credit is unused',
  'exactly 1 paid identity generation; the other face posters are served faceless with the explanation', async () => {
    limiterOff();
    const u = await makeUser('g6', 'free');
    const rs = await Promise.all(Array.from({ length: 25 }, () => invoke(poster, { body: { prompt: 'A hero', characterImageUrl: FACE }, cookies: u.cookies, ip: '198.51.100.76' })));
    const paid = (providers.counts['gemini-image'] || 0) + (providers.counts.grok || 0);
    assert.equal(paid, 1, `${paid} paid identity generations for 1 lifetime credit (lifetime counter ends at ${fake.num(`usage:identity:lifetime:${u.identifier}`)})`);
    assert.equal(fake.num(`usage:identity:lifetime:${u.identifier}`), 1);
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 1, 'global identity budget counted exactly once');
    const faced = rs.filter((r) => r.body?.faceApplied).length;
    assert.equal(faced, 1);
    return { actual: `${paid} paid generation; faceApplied ×${faced}; degraded-with-explanation ×${rs.filter((r) => r.body?.identityDegraded).length}` };
  });

scenario('G7', '25 PARALLEL face posters for Pro with ONE monthly identity credit left',
  'exactly 1 paid identity generation; monthly counter ends at 30', async () => {
    limiterOff();
    const u = await makeUser('g7', 'paid');
    fake.set(`usage:identity:${u.identifier}:2026-10`, 29);
    const rs = await Promise.all(Array.from({ length: 25 }, () => invoke(poster, { body: { prompt: 'A hero', characterImageUrl: FACE }, cookies: u.cookies, ip: '198.51.100.77' })));
    const paid = (providers.counts['gemini-image'] || 0) + (providers.counts.grok || 0);
    assert.equal(paid, 1, `${paid} paid identity generations with 1 credit left (monthly counter ends at ${fake.num(`usage:identity:${u.identifier}:2026-10`)})`);
    assert.equal(fake.num(`usage:identity:${u.identifier}:2026-10`), 30);
    return { actual: `${paid} paid generation; monthly credit counter 30 (never above the limit)` };
  });

scenario('G8', 'a face poster whose identity providers all fail is served faceless and the credit + global budget slot are GIVEN BACK (a failed paid call costs nothing)',
  'credit counter 0, global counter 0, poster still counted', async () => {
    const u = await makeUser('g8', 'free');
    providers.mode['gemini-image'] = 500; providers.mode.grok = 500;
    const r = await invoke(poster, { body: { prompt: 'A hero', characterImageUrl: FACE }, cookies: u.cookies, ip: '198.51.100.78' });
    assert.equal(r.status, 200); assert.notEqual(r.body.faceApplied, true);
    assert.equal(fake.num(`usage:identity:lifetime:${u.identifier}`), 0);
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 0);
    assert.equal(fake.num(`usage:poster:${u.identifier}:2026-10-15`), 1, 'the faceless poster itself used the poster quota');
    return { actual: 'faceless poster delivered; credit and budget returned' };
  });

scenario('G9', 'when nothing can be produced (placeholder) the poster slot is returned too',
  'poster counter 0 after a placeholder; the next poster works', async () => {
    const u = await makeUser('g9', 'free');
    providers.mode.cloudflare = 500; providers.mode.klein = 500; providers.mode.pollinations = 500;
    const r = await invoke(poster, { body: { prompt: 'x' }, cookies: u.cookies, ip: '198.51.100.79' });
    assert.equal(r.body.isPlaceholder, true);
    assert.equal(fake.num(`usage:poster:${u.identifier}:2026-10-15`), 0);
    providers.reset();
    ctx.advance(130_000);
    assert.equal((await invoke(poster, { body: { prompt: 'x' }, cookies: u.cookies, ip: '198.51.100.79' })).status, 200);
    return { actual: 'counter 0 after the placeholder; retry succeeds' };
  });
