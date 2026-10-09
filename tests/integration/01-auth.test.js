/** Scenario A — paid routes vs anonymous callers (zero provider calls where rejected). */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '01-auth' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, anonymous } = ctx;

const script = await ctx.route('generate-script');
const poster = await ctx.route('generate-poster');
const storyboard = await ctx.route('generate-storyboard');
const upload = await ctx.route('upload-character');

const JOURNAL = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama', gender: 'neutral' };
const FACE = 'https://pub-test.r2.dev/characters/face.jpg';

scenario('A1', 'storyboard (comic) rejects anonymous, zero provider calls',
  '403 NEEDS_ACCOUNT, 0 provider calls', async () => {
    const r = await invoke(storyboard, { body: { script: 'x'.repeat(60), lang: 'en', genre: 'drama' }, ip: '203.0.113.11' });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'NEEDS_ACCOUNT');
    assert.deepEqual(providers.counts, {});
    return { actual: `${r.status} ${r.body.code}, provider calls: none`, evidence: 'pages/api/generate-storyboard.js:301 (comicLimit===0)' };
  });

scenario('A2', 'comic panel route rejects anonymous (any index/seed), zero provider calls',
  '403 NEEDS_ACCOUNT for every attempt, 0 provider calls', async () => {
    for (const body of [
      { requestType: 'comic', panelIndex: 0, comicSeed: '123456', prompt: 'a cat' },
      { requestType: 'storyboard', panelIndex: 0, comicSeed: '123456', prompt: 'a cat' },
      { requestType: 'comic', panelIndex: 6, comicSeed: '9999999999', prompt: 'a cat' },
      { requestType: 'comic', panelIndex: 0, prompt: 'a cat' },
    ]) {
      const r = await invoke(poster, { body, ip: '203.0.113.12' });
      assert.equal(r.status, 403, JSON.stringify(body)); assert.equal(r.body.code, 'NEEDS_ACCOUNT');
    }
    assert.deepEqual(providers.counts, {});
    return { actual: '4/4 rejected with 403 NEEDS_ACCOUNT, provider calls: none' };
  });

scenario('A3', 'identity upload rejects anonymous (even with consent + valid selfie), zero provider calls',
  '403 NEEDS_PRO, 0 provider calls (not even moderation)', async () => {
    const r = await invoke(upload, { body: { consent: true, selfieBase64: 'data:image/png;base64,AAAA' }, ip: '203.0.113.13' });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'NEEDS_PRO');
    assert.deepEqual(providers.counts, {});
    assert.equal(providers.s3puts.length, 0);
    return { actual: `${r.status} ${r.body.code}; no moderation call, no R2 write` };
  });

scenario('A4', 'poster with a face reference is refused for anonymous before any paid call',
  '403 NEEDS_PRO, 0 provider calls', async () => {
    const r = await invoke(poster, { body: { prompt: 'a hero', characterImageUrl: FACE }, ip: '203.0.113.14' });
    assert.equal(r.status, 403); assert.equal(r.body.code, 'NEEDS_PRO');
    assert.deepEqual(providers.counts, {});
    return { actual: `${r.status} ${r.body.code}; provider calls: none` };
  });

scenario('A5', 'GUEST POLICY BY DESIGN (documented, expected): anonymous visitors are NOT rejected — they get 2 scripts/day and 1 lifetime poster per IP, and those calls are real provider calls',
  'anonymous script and poster return 200 and spend provider calls; the cost is bounded by the per-IP limits (A6), the global guest budget (P1) and the image budget (N4)', async () => {
    const s = await invoke(script, { body: JOURNAL, ip: '203.0.113.15' });
    const p = await invoke(poster, { body: { prompt: 'a lone figure at dawn' }, ip: '203.0.113.15' });
    // Policy decision (lib/quota.js guest tier): a guest taste is part of the funnel. This is NOT a bug; the earlier
    // "owner premise" that guests are rejected was wrong. If the policy ever changes, change this test deliberately.
    assert.equal(s.status, 200, 'guest script is allowed by design');
    assert.equal(p.status, 200, 'guest poster is allowed by design');
    assert.ok(providers.paidTotal() > 0, 'a guest script spends a (paid-plan) Gemini call');
    return { actual: 'guest script 200 + guest poster 200 (by design); spend bounded by A6 / P1 / N4' };
  });

scenario('A6', 'guest limits as DESIGNED: script 2/day (3rd → QUOTA_SCRIPT_GUEST, 0 new calls), poster 1 lifetime (2nd → QUOTA_POSTER_GUEST)',
  'script 200,200,429(QUOTA_SCRIPT_GUEST); poster 200 then 429(QUOTA_POSTER_GUEST); 4th/2nd spend nothing', async () => {
    const ip = '203.0.113.16';
    const a = await invoke(script, { body: JOURNAL, ip }); const b = await invoke(script, { body: JOURNAL, ip });
    assert.deepEqual([a.status, b.status], [200, 200]);
    const gemini2 = providers.counts.gemini;
    const c = await invoke(script, { body: JOURNAL, ip });
    assert.equal(c.status, 429); assert.equal(c.body.code, 'QUOTA_SCRIPT_GUEST');
    assert.equal(providers.counts.gemini, gemini2, 'the refused request must not call a provider');
    const p1 = await invoke(poster, { body: { prompt: 'a lone figure at dawn' }, ip });
    assert.equal(p1.status, 200); assert.equal(p1.body.success, true);
    const before = { ...providers.counts };
    const p2 = await invoke(poster, { body: { prompt: 'a lone figure at dawn' }, ip });
    assert.equal(p2.status, 429); assert.equal(p2.body.code, 'QUOTA_POSTER_GUEST');
    assert.deepEqual(providers.counts, before);
    // next UTC day: scripts reset, the lifetime poster does NOT
    ctx.setNow('2026-10-16T00:00:05Z');
    assert.equal((await invoke(script, { body: JOURNAL, ip })).status, 200);
    assert.equal((await invoke(poster, { body: { prompt: 'again' }, ip })).status, 429);
    return { actual: `script 200/200/429, poster 200/429 (lifetime); gemini calls for 2 scripts = ${gemini2} (2 models raced per script)`, evidence: 'guest quota lib/quota.js; usage:poster:lifetime:<ip>' };
  });

scenario('A7', 'a tampered/garbage session cookie is treated as anonymous (no tier escalation)',
  'storyboard 403 NEEDS_ACCOUNT, 0 provider calls', async () => {
    const r = await invoke(storyboard, { body: { script: 'x'.repeat(60), lang: 'en' }, cookies: { 'next-auth.session-token': 'eyJhbGciOiJIUzI1NiJ9.e30.forged' }, ip: '203.0.113.17' });
    assert.equal(r.status, 403);
    assert.deepEqual(providers.counts, {});
    return { actual: `${r.status} ${r.body.code}` };
  });

scenario('A8', 'client-supplied tier/user hints are ignored (x-dev-tier, body tier/userId, x-device-id)',
  'still anonymous: storyboard 403', async () => {
    const r = await invoke(storyboard, { body: { script: 'x'.repeat(60), lang: 'en', tier: 'pro', userId: 'someone', isAdmin: true }, headers: { 'x-dev-tier': 'pro', 'x-device-id': 'u:victim' }, ip: '203.0.113.18' });
    assert.equal(r.status, 403);
    assert.deepEqual(providers.counts, {});
    return { actual: `${r.status}; no escalation via headers/body` };
  });

scenario('A9', 'signed-in Free user is accepted (control): script 200 spends provider calls',
  'script 200, gemini called', async () => {
    const u = await makeUser('a9', 'free');
    const r = await invoke(script, { body: JOURNAL, cookies: u.cookies, ip: '203.0.113.19' });
    assert.equal(r.status, 200);
    assert.ok(providers.counts.gemini >= 1);
    return { actual: `200, gemini calls ${providers.counts.gemini}` };
  });
