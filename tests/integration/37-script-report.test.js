/** Scenario Z — "Report this script" (generated TEXT): ok + Telegram alert with reason / genre / language ONLY, no text accepted or stored, nothing hidden globally,
 *  unknown genre / language refused, the same reporter repeating alerts once, the same rate limit as every other report. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '37-script-report', nodeEnv: 'production', env: { R2_QUARANTINE_BUCKET_NAME: 'q-private-bucket' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const report = await ctx.route('report-content');

let ipN = 0;
const ip = () => `198.51.100.${30 + (++ipN % 200)}`;
const tg = () => providers.telegram.filter((t) => t.includes('Script report'));
const rep = (u, refs, extra = {}, address = ip()) => invoke(report, { body: { kind: 'script', reason: 'sexual', refs, ...extra }, cookies: u?.cookies ?? {}, ip: address });
const CANARY = 'CANARY-SECRET-SCRIPT-TEXT-9f3a';

scenario('Z1', 'a script report is accepted: 200, the owner is alerted with reason / genre / language, NO text anywhere (even if the client sends some), nothing hidden globally',
  '200; one "Script report" alert; canary text absent from alert + Redis; counters bumped; no hidden mark, no R2 move', async () => {
    const u = await makeUser('z1', 'free');
    const r = await rep(u, [{ script: { genre: 'Romance', lang: 'he', text: CANARY } }], { text: CANARY, note: CANARY });
    assert.equal(r.status, 200); assert.equal(r.body.success, true); assert.equal(r.body.results[0].ok, true); assert.equal(r.body.results[0].hidden, false);
    assert.equal(tg().length, 1);
    assert.match(tg()[0], /Reason: sexual/); assert.match(tg()[0], /Genre: romance/); assert.match(tg()[0], /Language: he/); assert.match(tg()[0], /The text is NOT stored or sent/);
    assert.ok(!providers.telegram.join('\n').includes(CANARY), 'no script text in any alert');
    const everything = JSON.stringify(fake.keys('').map((k) => [k, fake.get(k)]));
    assert.ok(!everything.includes(CANARY), 'no script text in Redis');
    assert.equal(fake.keys('report:hidden:').length, 0); assert.equal(fake.keys('report:who:').length, 0);
    assert.equal(providers.s3copies.length + providers.s3deletes.length + providers.s3puts.length, 0, 'nothing touched in R2');
    assert.equal(fake.num('stats:report:total'), 1); assert.equal(fake.num('stats:report:reason:sexual'), 1);
    assert.equal(fake.keys('stats:report:script:').length, 1, 'a per-day script counter exists');
    return { actual: 'alerted with reason/genre/lang; no text stored or sent' };
  });

scenario('Z2', 'the same reporter repeating the same script kind within a day alerts once; a different reporter alerts again; guests can report too',
  '1 alert for the repeat, 2 after a second reporter', async () => {
    providers.telegram.length = 0;
    const a = await makeUser('z2a', 'free'); const b = await makeUser('z2b', 'free');
    await rep(a, [{ script: { genre: 'horror', lang: 'en' } }], { reason: 'violent' });
    await rep(a, [{ script: { genre: 'horror', lang: 'en' } }], { reason: 'violent' });
    assert.equal(tg().length, 1);
    await rep(b, [{ script: { genre: 'horror', lang: 'en' } }], { reason: 'violent' });
    assert.equal(tg().length, 2);
    const guest = await rep(null, [{ script: { genre: 'drama', lang: 'he' } }], { reason: 'other' });
    assert.equal(guest.status, 200); assert.equal(tg().length, 3);
    return { actual: 'dedupe per reporter / script kind / day' };
  });

scenario('Z3', 'invalid input is refused with 400: unknown genre, unknown language, no genre, extra shapes, a url/hash/gallery ref mixed with a script ref, missing kind',
  '400 for each', async () => {
    const u = await makeUser('z3', 'free'); providers.telegram.length = 0;
    const bad = [
      [{ script: { genre: 'porn', lang: 'en' } }], [{ script: { genre: 'drama', lang: 'fr' } }], [{ script: { lang: 'en' } }], [{ script: 'drama' }], [{ script: null }], [{ script: { genre: ['drama'], lang: 'en' } }],
      [{ script: { genre: '__proto__', lang: 'en' } }], [{ script: { genre: 'constructor', lang: 'en' } }],
    ];
    for (const refs of bad) assert.equal((await rep(u, refs)).status, 400, JSON.stringify(refs));
    assert.equal((await invoke(report, { body: { kind: 'essay', reason: 'sexual', refs: [{ script: { genre: 'drama', lang: 'en' } }] }, cookies: u.cookies, ip: ip() })).status, 400);
    assert.equal(tg().length, 0, 'nothing alerted');
    return { actual: '400 for every malformed script ref' };
  });

scenario('Z4', 'the script report shares the report rate limit (10 per 10 minutes per reporter)',
  '429 after the limit', async () => {
    const u = await makeUser('z4', 'free'); const same = ip(); const codes = [];
    for (let i = 0; i < 12; i++) codes.push((await rep(u, [{ script: { genre: 'action', lang: 'en' } }], {}, same)).status);
    assert.ok(codes.includes(429), codes.join(','));
    return { actual: codes.join(',') };
  });
