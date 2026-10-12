/** Scenario Y — report on a STATIC gallery item: ok + Telegram alert with the file path on every distinct report, unknown ids refused,
 *  nothing hidden globally (no Redis hidden mark, no R2 move), same rate limit as every other report. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '29-gallery-report', nodeEnv: 'production', env: { R2_QUARANTINE_BUCKET_NAME: 'q-private-bucket' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const report = await ctx.route('report-content');
const { SHOWCASE_POSTERS, SHOWCASE_REELS } = await import('../../constants/showcase.js');
const { getMsg } = await import('../../lib/messages.js');

let ipN = 0;
const ip = () => `198.51.100.${40 + (++ipN % 200)}`;
const POSTER = SHOWCASE_POSTERS.find((p) => p.src && p.type === 'comic');   // a comic panel from the gallery
const REEL = SHOWCASE_REELS[0];
const rep = (u, refs, extra = {}, address = ip()) => invoke(report, { body: { kind: 'poster', reason: 'sexual', refs, ...extra }, cookies: u?.cookies ?? {}, ip: address });
const tg = () => providers.telegram.filter((t) => t.includes('Gallery report'));

scenario('Y1', 'a gallery report is accepted: 200 ok, the owner is alerted with the item and the FILE PATH (from our list), nothing is hidden globally',
  '200; one "Gallery report" alert naming public/gallery/..; no report:hidden key; no R2 copy/delete', async () => {
    const u = await makeUser('y1', 'free');
    const r = await rep(u, [{ gallery: `poster:${POSTER.id}` }], { kind: 'panel' });
    assert.equal(r.status, 200); assert.equal(r.body.success, true); assert.equal(r.body.results[0].ok, true); assert.equal(r.body.results[0].hidden, false);
    assert.equal(tg().length, 1);
    assert.match(tg()[0], new RegExp(`poster:${POSTER.id}`)); assert.ok(tg()[0].includes(`public${POSTER.src}`), 'file path in the alert');
    assert.match(tg()[0], /Hidden only on the reporter's device/);
    assert.equal(fake.keys('report:hidden:').length, 0, 'no global hidden mark'); assert.equal(fake.keys('report:who:').length, 0);
    assert.equal(providers.s3copies.length + providers.s3deletes.length, 0, 'nothing moved in R2');
    assert.equal(fake.num('stats:report:total'), 1, 'counted in the report stats');
    return { actual: 'ok, alerted with the path, nothing hidden globally' };
  });

scenario('Y2', 'a reel report works the same: the alert names the reel file and its poster image',
  'alert lists /reels/..mp4 and the poster file', async () => {
    const u = await makeUser('y2', 'free');
    const r = await rep(u, [{ gallery: `reel:${REEL.id}` }], { kind: 'reel' });
    assert.equal(r.status, 200);
    assert.ok(tg()[0].includes(`public${REEL.src}`)); if (REEL.poster) assert.ok(tg()[0].includes(`public${REEL.poster}`));
    return { actual: 'reel + poster files named' };
  });

scenario('Y3', 'EVERY distinct reporter alerts (no threshold): three reporters → three alerts; the same reporter repeating alerts once',
  '3 alerts for 3 reporters, still 3 after a repeat', async () => {
    const a = await makeUser('y3a', 'free'); const b = await makeUser('y3b', 'free'); const c = await makeUser('y3c', 'free');
    for (const u of [a, b, c]) assert.equal((await rep(u, [{ gallery: `poster:${POSTER.id}` }])).status, 200);
    assert.equal(tg().length, 3);
    assert.equal((await rep(a, [{ gallery: `poster:${POSTER.id}` }])).status, 200);
    assert.equal(tg().length, 3, 'the same reporter again does not alert again');
    return { actual: '3 reporters → 3 alerts; repeat → no extra alert' };
  });

scenario('Y4', 'unknown ids, traversal, a path or URL as the "gallery" value, and non-strings → 400 REPORT_INVALID; no alert, nothing stored',
  'each → 400', async () => {
    // 11 bad refs: spread over two reporters, because every request (valid or not) counts against the per-reporter rate limit of 10
    const users = [await makeUser('y4a', 'free'), await makeUser('y4b', 'free')];
    let n = 0;
    for (const bad of ['poster:999999', 'reel:nope', '../etc/passwd', 'poster:../49', '/gallery/sample-2.webp', 'public/gallery/sample-2.webp', 'https://evil.example/a.png', 5, {}, null, '']) {
      const r = await rep(users[n++ % 2], [{ gallery: bad }]);
      assert.equal(r.status, 400, JSON.stringify(bad)); assert.equal(r.body.code, 'REPORT_INVALID');
    }
    assert.equal(tg().length, 0); assert.equal(fake.num('stats:report:total'), 0);
    return { actual: 'every bad gallery ref → 400, nothing sent' };
  });

scenario('Y5', 'the removed comic (id 64, toon-07) can no longer be reported — it is not in the list any more; and a mixed request keeps the valid ref',
  '64 → 400; [bad, good] → 200', async () => {
    const u = await makeUser('y5', 'free');
    assert.equal((await rep(u, [{ gallery: 'poster:64' }])).status, 400);
    const m = await rep(u, [{ gallery: 'poster:zzz' }, { gallery: `poster:${POSTER.id}` }]);
    assert.equal(m.status, 200); assert.deepEqual(m.body.results.map((x) => x.ok), [false, true]);
    return { actual: 'removed item refused; mixed request partially ok' };
  });

scenario('Y6', 'the SAME rate limit as every report: 10 per 10 minutes per reporter, the 11th → 429 RATE_LIMITED (gallery and R2 reports share the bucket)',
  '10 × 200, then 429', async () => {
    const u = await makeUser('y6', 'free'); const addr = ip();
    for (let i = 0; i < 10; i++) assert.equal((await rep(u, [{ gallery: `poster:${POSTER.id}` }], {}, addr)).status, 200);
    const last = await rep(u, [{ gallery: `poster:${POSTER.id}` }], {}, addr);
    assert.equal(last.status, 429); assert.equal(last.body.code, 'RATE_LIMITED');
    return { actual: '11th → 429' };
  });

scenario('Y7', 'the success/dialog copy is accurate for gallery items (hidden for you, team notified) and exists in both languages',
  'doneGallery/introGallery he+en, no global-removal claim', async () => {
    const { REPORT_COPY } = await import('../../constants/report-copy.js');
    for (const k of ['doneGallery', 'introGallery']) { assert.ok(REPORT_COPY[k].en && REPORT_COPY[k].he); assert.doesNotMatch(REPORT_COPY[k].en, /removed|deleted|everyone/i); }
    assert.ok(getMsg('REPORT_INVALID', 'en'));
    return { actual: 'copy accurate' };
  });
