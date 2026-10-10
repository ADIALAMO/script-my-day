/** Scenarios D (comics, Free) and E (comics, regeneration limits, all tiers). */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '04-comics' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const storyboard = await ctx.route('generate-storyboard');
const poster = await ctx.route('generate-poster');
const SCRIPT = 'INT. BEACH - DAY. A family laughs together by the water while the sun sets over the quiet sea.';
let seq = 0;
const newSeed = () => `${Date.now()}${++seq}${Math.floor(Math.random() * 1e6)}`;

/** open a comic (storyboard step); returns the parsed response */
async function openComic(u, { seed = newSeed(), ip = '198.51.100.40' } = {}) {
  const r = await invoke(storyboard, { body: { script: SCRIPT, lang: 'en', genre: 'drama', comicStyle: 'anime', comicSeed: seed }, cookies: u.cookies, ip });
  return { r, seed, status: r.status, body: r.body };
}
/** one panel request exactly as the browser would send it (or as a direct API call would, without the UI) */
const panel = (u, seed, idx, { ip = '198.51.100.40', extra = {} } = {}) =>
  invoke(poster, { body: { prompt: 'A calm person near a window, soft light, medium shot', genre: 'drama', lang: 'en', requestType: 'comic', panelIndex: idx, comicSeed: seed, ...extra }, cookies: u.cookies, ip });
const month = () => '2026-10';
const kleinCalls = () => providers.counts.klein || 0;

scenario('D1', 'Free: 1st comic ever has 7 unlocked panels, 2nd and 3rd have 3, the 4th in the month is blocked (QUOTA_COMIC_MONTH, zero provider calls)',
  'unlocked 7,3,3; 4th → 429 QUOTA_COMIC_MONTH; no storyboard model called; counter stays 3', async () => {
    const u = await makeUser('d1', 'free');
    const c1 = await openComic(u); const c2 = await openComic(u); const c3 = await openComic(u);
    assert.deepEqual([c1.status, c2.status, c3.status], [200, 200, 200]);
    assert.deepEqual([c1.body.unlockedPanels, c2.body.unlockedPanels, c3.body.unlockedPanels], [7, 3, 3]);
    assert.equal(c1.body.panels.length, 7);
    assert.equal(c1.body.panels.filter((p) => p.isLocked).length, 0);
    assert.equal(c2.body.panels.filter((p) => p.isLocked).length, 4);
    const sb = providers.counts['openrouter-text'];
    const c4 = await openComic(u);
    assert.equal(c4.status, 429); assert.equal(c4.body.code, 'QUOTA_COMIC_MONTH');
    assert.equal(providers.counts['openrouter-text'], sb, 'blocked 4th comic must call no storyboard model');
    assert.equal(fake.num(`usage:comic:${u.identifier}:${month()}`), 3, 'refused request rolled back');
    assert.equal(fake.get(`comic:meta:${c4.seed}`), null, 'no comic session for the blocked comic');
    const { getMsg } = await import('../../lib/messages.js');
    assert.match(getMsg('QUOTA_COMIC_MONTH', 'he'), /החודש/); assert.match(getMsg('QUOTA_COMIC_MONTH', 'en'), /this month/);
    return { actual: 'unlocked 7/3/3; 4th 429 QUOTA_COMIC_MONTH; storyboard calls 3 (none for the 4th)', evidence: `monthly key usage:comic:<id>:${month()} = 3` };
  });

scenario('D2', 'Month rollover: the monthly comic count resets on the 1st (UTC) — and not a second earlier; "first comic" does not return',
  'blocked at 2026-10-31T23:59:59Z, allowed at 2026-11-01T00:00:01Z with 3 unlocked panels', async () => {
    const u = await makeUser('d2', 'free');
    for (let i = 0; i < 3; i++) assert.equal((await openComic(u)).status, 200);
    ctx.setNow('2026-10-31T23:59:59Z');
    assert.equal((await openComic(u)).status, 429);
    ctx.setNow('2026-11-01T00:00:01Z');
    const c = await openComic(u);
    assert.equal(c.status, 200);
    assert.equal(c.body.unlockedPanels, 3, 'the lifetime "first comic" bonus is not given again');
    assert.equal(fake.num(`usage:comic:${u.identifier}:2026-11`), 1);
    return { actual: '429 at 23:59:59Z; 200 at 00:00:01Z; unlocked 3; new key usage:comic:<id>:2026-11 = 1' };
  });

scenario('D3', 'locked panels cannot be fetched: direct panel route, changed index, string/float/negative/odd indexes — all refused with zero provider calls; locked prompts never reach the client',
  'indexes ≥3 on the 2nd comic → 403; locked panels carry no `visual`', async () => {
    const u = await makeUser('d3', 'free');
    await openComic(u);                                  // consume the "first comic" bonus
    const c2 = await openComic(u);
    assert.equal(c2.body.unlockedPanels, 3);
    for (const p of c2.body.panels.slice(3)) { assert.equal(p.isLocked, true); assert.equal('visual' in p, false, 'locked panel must not expose its image prompt'); }
    const kl = kleinCalls();
    const bad = [3, 4, 5, 6, 7, 99, -1, '3', '4', 3.5, '3.9', NaN, null, undefined, '', 'abc', true, [3], { x: 1 }, '../3', 1e9];
    const results = [];
    for (const idx of bad) {
      const r = await panel(u, c2.seed, idx, { ip: '198.51.100.41' });
      results.push([String(idx), r.status]);
      assert.ok(r.status === 403, `panelIndex ${JSON.stringify(idx)} was not refused (status ${r.status})`);
      if (results.length % 15 === 0) ctx.advance(70_000);
    }
    assert.equal(kleinCalls(), kl, 'refused panel requests must not call a provider');
    // control: the unlocked ones work
    ctx.advance(70_000);
    for (const idx of [0, 1, 2]) assert.equal((await panel(u, c2.seed, idx, { ip: '198.51.100.41' })).status, 200);
    assert.equal(kleinCalls(), kl + 3);
    return { actual: `${bad.length}/${bad.length} locked/odd indexes refused; 3 unlocked panels served (3 klein calls)`, evidence: 'comic-guard.js:80-104' };
  });

scenario('D4', 'a comic id the user did not create (made-up, expired, or another user\'s) cannot be used to fetch panels',
  '403 COMIC_SESSION_EXPIRED for every case, zero provider calls', async () => {
    const a = await makeUser('d4a', 'free'); const b = await makeUser('d4b', 'free');
    const ca = await openComic(a, { ip: '198.51.100.42' });
    const kl = kleinCalls();
    for (const [who, seed] of [[b, ca.seed], [a, '11111111111'], [a, 'x'], [a, '../../etc'], [a, undefined]]) {
      const r = await panel(who, seed, 0, { ip: '198.51.100.43' });
      assert.equal(r.status, 403, String(seed)); assert.equal(r.body.code, 'COMIC_SESSION_EXPIRED');
    }
    assert.equal(kleinCalls(), kl);
    ctx.advance(25 * 3600_000);                     // session TTL (24h) elapses
    const expired = await panel(a, ca.seed, 0, { ip: '198.51.100.44' });
    assert.equal(expired.status, 403); assert.equal(expired.body.code, 'COMIC_SESSION_EXPIRED');
    return { actual: 'foreign/made-up/malformed/expired seeds → 403 COMIC_SESSION_EXPIRED, 0 klein calls' };
  });

scenario('D5', 'Free cannot get extra panels by regenerating: the total image budget is Σ(unlocked + 2 regens) over the 3 monthly comics = 19, however many requests are made',
  'exactly 19 Klein calls when every panel of 3 comics is requested repeatedly', async () => {
    const u = await makeUser('d5', 'free');
    const comics = [];
    for (let i = 0; i < 3; i++) { comics.push(await openComic(u, { ip: '198.51.100.45' })); ctx.advance(70_000); }
    let ok = 0, refused = 0;
    for (const c of comics) {
      for (let round = 0; round < 6; round++) {
        for (let idx = 0; idx < 7; idx++) {
          const r = await panel(u, c.seed, idx, { ip: '198.51.100.45' });
          if (r.status === 200) ok++; else refused++;
          ctx.advance(4_000);                       // keeps ≤ 20 requests/min so the limiter is not what stops us
        }
      }
    }
    assert.equal(ok, 7 + 2 + 3 + 2 + 3 + 2);
    assert.equal(kleinCalls(), 19);
    assert.ok(refused > 0);
    return { actual: `allowed ${ok}, refused ${refused}; Klein calls ${kleinCalls()} (= 7+2 + 3+2 + 3+2)`, evidence: 'per-comic counters comic:pc / comic:rg' };
  });

scenario('E1', 'regeneration limit is enforced SERVER-side with the client limit ignored: panel 0 + 2 replacements OK, 3rd refused (QUOTA_PANEL_REGEN) for Free and both kinds of Pro; same panel repeated makes zero provider calls',
  'for each tier: panel 0 ×3 → 200 (1 + 2 replacements); 10 more on panel 0 → 429 QUOTA_PANEL_REGEN; another panel\'s first image still allowed, its replacement refused', async () => {
    for (const kind of ['free', 'paid', 'adminGranted']) {
      const u = await makeUser(`e1-${kind}`, kind);
      const c = await openComic(u, { ip: `198.51.100.${kind === 'free' ? 46 : kind === 'paid' ? 47 : 48}` });
      assert.equal(c.status, 200);
      const ip = `198.51.100.${kind === 'free' ? 46 : kind === 'paid' ? 47 : 48}`;
      const before = kleinCalls();
      const first = await panel(u, c.seed, 0, { ip }); assert.equal(first.status, 200);
      assert.equal((await panel(u, c.seed, 0, { ip })).status, 200);   // replacement 1
      assert.equal((await panel(u, c.seed, 0, { ip })).status, 200);   // replacement 2
      assert.equal(kleinCalls() - before, 3, `${kind}: 1 + 2 replacements`);
      for (let i = 0; i < 10; i++) {
        const r = await panel(u, c.seed, 0, { ip });                   // the same panel, again and again
        assert.equal(r.status, 429, `${kind} attempt ${i}`); assert.equal(r.body.code, 'QUOTA_PANEL_REGEN');
      }
      assert.equal(kleinCalls() - before, 3, `${kind}: refused calls spent nothing`);
      // by design a panel that was never generated still gets its FIRST image; its replacement then hits the same shared budget
      assert.equal((await panel(u, c.seed, 1, { ip })).status, 200, `${kind}: first image of another panel`);
      const rep = await panel(u, c.seed, 1, { ip });
      assert.equal(rep.status, 429, `${kind}: its replacement`); assert.equal(rep.body.code, 'QUOTA_PANEL_REGEN');
      assert.equal(kleinCalls() - before, 4, `${kind}: exactly one more image (panel 1 first image)`);
      assert.equal(fake.num(`comic:rg:${c.seed}`), 2, `${kind}: replacement counter did not run past the limit`);
      ctx.advance(70_000);
    }
    return { actual: 'Free, Pro(paid), Pro(admin-granted): 3 images on panel 0, then 429 QUOTA_PANEL_REGEN ×10 with 0 provider calls; replacement budget shared by the whole comic', evidence: 'client REGEN_LIMIT (hooks/useStoryboardGeneration.js:38) is display only' };
  });

scenario('E2', 'storyboard reports the server limit to the client (regenLimit = 2) and a refused attempt does not burn it (placeholder gives the slot back)',
  'response.regenLimit === 2; a failed provider cascade returns the reservation', async () => {
    const u = await makeUser('e2', 'free');
    const c = await openComic(u, { ip: '198.51.100.49' });
    assert.equal(c.body.regenLimit, 2);
    providers.mode.klein = 500; providers.mode.cloudflare = 500; providers.mode.pollinations = 500;
    const failed = await panel(u, c.seed, 0, { ip: '198.51.100.49' });
    assert.equal(failed.body.isPlaceholder, true);
    assert.equal(fake.num(`comic:pc:${c.seed}:0`), 0, 'failed attempt released the per-panel counter');
    providers.reset();
    const ok = await panel(u, c.seed, 0, { ip: '198.51.100.49' });
    assert.equal(ok.status, 200);
    assert.equal(fake.num(`comic:rg:${c.seed}`), 0, 'first real image of the panel is not a replacement');
    return { actual: 'regenLimit 2 delivered; placeholder released counters (pc=0) so the retry is still a first image' };
  });

scenario('E3', 'the panel counter cannot be reset by creating a new comic id for the same story: a new id costs a comic quota slot, and re-using an old id keeps its counters',
  '(a) re-using the same seed in a 2nd storyboard keeps comic:pc/rg; (b) new ids exist only up to the monthly quota; (c) re-using the 7-panel seed cannot raise a later comic above 3', async () => {
    const u = await makeUser('e3', 'free');
    const ip = '198.51.100.50';
    const seed = newSeed();
    const c1 = await openComic(u, { seed, ip });
    assert.equal(c1.body.unlockedPanels, 7);
    assert.equal((await panel(u, seed, 0, { ip })).status, 200);              // pc:0 = 1
    const again = await openComic(u, { seed, ip });                            // same id, second storyboard
    assert.equal(again.status, 200);
    assert.equal(again.body.unlockedPanels, 3, '(c) re-using the first comic\'s id does not keep 7 unlocked');
    assert.equal(fake.num(`comic:pc:${seed}:0`), 1, '(a) per-panel counter preserved across the re-opened session');
    assert.equal((await panel(u, seed, 0, { ip })).status, 200);              // replacement 1 (not a free first image)
    assert.equal(fake.num(`comic:rg:${seed}`), 1);
    assert.equal((await panel(u, seed, 5, { ip })).status, 403, '(c) panel 5 is locked now');
    const used = fake.num(`usage:comic:${u.identifier}:${month()}`);
    assert.equal(used, 2, 'each storyboard (even with a repeated id) consumed one monthly comic');
    assert.equal((await openComic(u, { ip })).status, 200);
    assert.equal((await openComic(u, { ip })).status, 429, '(b) a 4th id is impossible this month');
    return { actual: 'counters survive id re-use; every new/re-opened comic spends one of the 3 monthly slots', evidence: 'comic-guard.js counters keyed by seed; storyboard reserves quota before opening a session' };
  });

scenario('E4', 'Pro comics: 2/day (3rd → QUOTA_COMIC daily message), all 7 panels, total images/day ≤ 2×(7+2)=18',
  'Pro: unlocked 7,7; 3rd 429 QUOTA_COMIC; Klein calls when every panel is requested repeatedly = 18', async () => {
    const u = await makeUser('e4', 'paid');
    const ip = '198.51.100.51';
    const cs = [await openComic(u, { ip }), await openComic(u, { ip })];
    assert.deepEqual(cs.map((c) => c.body.unlockedPanels), [7, 7]);
    const third = await openComic(u, { ip });
    assert.equal(third.status, 429); assert.equal(third.body.code, 'QUOTA_COMIC');
    for (const c of cs) for (let round = 0; round < 4; round++) for (let idx = 0; idx < 7; idx++) { await panel(u, c.seed, idx, { ip }); ctx.advance(4_000); }
    assert.equal(kleinCalls(), 18);
    ctx.setNow('2026-10-16T00:00:01Z');
    assert.equal((await openComic(u, { ip })).status, 200, 'daily window for Pro');
    return { actual: 'Pro: 7/7 unlocked, 3rd comic refused with the DAILY message, 18 images max, resets next day' };
  });

scenario('D6', 'Pro monthly comic cap: 2/day AND 6/month — the 7th comic is refused with the MONTHLY message even with day room, zero provider calls, both counters rolled back, resets on the 1st',
  '6 allowed over 3 days, 7th 429 QUOTA_COMIC_PRO_MONTH (limit 6), blocked to the last second of October, new month allowed', async () => {
    for (const kind of ['paid', 'adminGranted']) {
      fake.flush(); providers.reset(); ctx.setNow('2026-10-01T00:05:00Z');
      const u = await makeUser(`d6-${kind}`, kind);
      const ip = kind === 'paid' ? '198.51.100.46' : '198.51.100.47';
      let allowed = 0;
      for (let day = 1; day <= 3; day++) {
        ctx.setNow(`2026-10-0${day}T00:05:00Z`);
        for (let i = 0; i < 2; i++) { const c = await openComic(u, { ip }); assert.equal(c.status, 200, `${kind} day ${day} #${i + 1}`); allowed++; ctx.advance(70_000); }
      }
      assert.equal(allowed, 6);
      assert.equal(fake.num(`usage:comic-month:${u.identifier}:2026-10`), 6);
      const sb = providers.counts['openrouter-text'];
      ctx.setNow('2026-10-04T00:05:00Z');
      const c = await openComic(u, { ip });
      assert.equal(c.status, 429, kind); assert.equal(c.body.code, 'QUOTA_COMIC_PRO_MONTH'); assert.equal(c.body.limit, 6);
      assert.equal(c.body.resetsAt, '2026-11-01T00:00:00.000Z');
      assert.equal(providers.counts['openrouter-text'], sb, 'refused comic calls no storyboard model');
      assert.equal(fake.num(`usage:comic-month:${u.identifier}:2026-10`), 6, 'monthly counter rolled back');
      assert.ok(!fake.num(`usage:comic:${u.identifier}:2026-10-04`), 'the day slot was returned too');
      ctx.setNow('2026-10-31T23:59:59Z'); assert.equal((await openComic(u, { ip })).status, 429);
      ctx.setNow('2026-11-01T00:00:05Z'); assert.equal((await openComic(u, { ip })).status, 200, 'new month');
      assert.equal(fake.num(`usage:comic-month:${u.identifier}:2026-11`), 1);
    }
    const { getMsg } = await import('../../lib/messages.js');
    return { actual: '6 comics allowed; 7th → 429 QUOTA_COMIC_PRO_MONTH limit 6, resets 2026-11-01', evidence: `EN: ${getMsg('QUOTA_COMIC_PRO_MONTH', 'en')}  HE: ${getMsg('QUOTA_COMIC_PRO_MONTH', 'he')}` };
  });
