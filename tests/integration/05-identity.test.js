/** Scenario F — Star Yourself character uploads: monthly quota (Free 3 / Pro 30), lifetime-credit rule, global budget accounting. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '05-identity' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const upload = await ctx.route('upload-character');
const poster = await ctx.route('generate-poster');
const { getMsg } = await import('../../lib/messages.js');
const GLOBAL = (d = '2026-10-15') => `usage:identity:global:${d}`;
const up = (u, ip = '198.51.100.60', body = { selfieBase64: PNG_DATA_URI, consent: true }) => invoke(upload, { body, cookies: u.cookies, ip });
const FACE = 'https://pub-test.r2.dev/characters/face.jpg';

/** how CharacterModal.jsx builds the {reset} text (UTC, locale dependent) — mirrored so the message can be checked end to end */
const resetText = (iso, he) => new Date(iso).toLocaleDateString(he ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

scenario('F1', 'Free: 3 uploads per month; the 4th is refused with the included number AND the reset date (he + en), zero paid calls; each allowed upload bumps the global identity budget exactly once',
  '3×200 (gemini-image ×3), 4th 429 QUOTA_SHEET limit=3 resetsAt=2026-11-01T00:00:00Z; global counter 3', async () => {
    const u = await makeUser('f1', 'free');
    for (let i = 1; i <= 3; i++) {
      const r = await up(u); assert.equal(r.status, 200, `upload ${i}`); assert.equal(r.body.sheetGenerated, true);
      assert.equal(fake.num(GLOBAL()), i, `global budget after upload ${i}`);
    }
    assert.equal(providers.counts['gemini-image'], 3);
    const paidBefore = providers.paidTotal(); const putsBefore = providers.s3puts.length;
    const r4 = await up(u);
    assert.equal(r4.status, 429); assert.equal(r4.body.code, 'QUOTA_SHEET');
    assert.equal(r4.body.limit, 3); assert.equal(r4.body.resetsAt, '2026-11-01T00:00:00.000Z');
    assert.equal(providers.paidTotal(), paidBefore, 'the refused upload made zero paid calls');
    assert.equal(providers.s3puts.length, putsBefore, 'and wrote nothing to R2 (no silent raw-selfie fallback)');
    assert.equal(fake.num(GLOBAL()), 3, 'refused upload did not touch the global budget');
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 3);
    const en = getMsg('QUOTA_SHEET', 'en', { limit: r4.body.limit, reset: resetText(r4.body.resetsAt, false) });
    const he = getMsg('QUOTA_SHEET', 'he', { limit: r4.body.limit, reset: resetText(r4.body.resetsAt, true) });
    assert.ok(en.includes('3') && en.includes('1 November 2026'), en);
    assert.ok(he.includes('3') && he.includes('1 בנובמבר 2026'), he);
    return { actual: `4th → 429 QUOTA_SHEET (limit 3, resets 2026-11-01). EN: "${en}"  HE: "${he}"`, evidence: `moderation calls ${providers.counts.moderation} (4 — the free moderation call precedes the quota check)` };
  });

scenario('F2', 'Free: the monthly window resets on the 1st (UTC) — and not before',
  'blocked 2026-10-31T23:59:59Z; allowed 2026-11-01T00:00:01Z; new month key', async () => {
    const u = await makeUser('f2', 'free');
    for (let i = 0; i < 3; i++) assert.equal((await up(u)).status, 200);
    ctx.setNow('2026-10-31T23:59:59Z');                                   // > 5 min after the uploads: the upload rate limiter is not what refuses
    assert.equal((await up(u)).status, 429);
    ctx.setNow('2026-11-01T00:00:01Z');
    const r = await up(u);
    assert.equal(r.status, 200);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-11`), 1);
    assert.ok(fake.ttl(`usage:sheet:${u.identifier}:2026-10`) > 0, 'old key outlives the month a few days (garbage-collected later)');
    return { actual: '429 on Oct 31 23:59:59Z, 200 on Nov 1 00:00:01Z; usage:sheet:<id>:2026-11 = 1' };
  });

scenario('F3', 'Pro: 30 uploads per month, 31st refused with limit=30 + reset date; global budget +1 per allowed upload; month rollover resets',
  '30×200 (grok ×30), 31st 429 QUOTA_SHEET limit 30; global counter 30 (not 31); Nov 1 → allowed', async () => {
    for (const kind of ['paid', 'adminGranted']) {
      fake.flush(); providers.reset(); ctx.setNow('2026-10-15T12:00:00Z');
      const u = await makeUser(`f3-${kind}`, kind);
      for (let i = 1; i <= 30; i++) {
        const r = await up(u, '198.51.100.61'); assert.equal(r.status, 200, `${kind} upload ${i}: ${JSON.stringify(r.body)}`);
        if (i % 4 === 0) ctx.advance(11 * 60_000);                                         // sliding 4 uploads / 5 min limiter: wait out two windows
      }
      assert.equal(providers.counts.grok, 30, `${kind}: Pro sheets use Grok`);
      assert.equal(fake.num(GLOBAL()), 30, `${kind}: global budget counted each upload exactly once`);
      const r31 = await up(u, '198.51.100.61');
      assert.equal(r31.status, 429, kind); assert.equal(r31.body.code, 'QUOTA_SHEET'); assert.equal(r31.body.limit, 30);
      assert.equal(providers.counts.grok, 30); assert.equal(fake.num(GLOBAL()), 30);
      const msg = getMsg('QUOTA_SHEET', 'en', { limit: r31.body.limit, reset: resetText(r31.body.resetsAt, false) });
      assert.ok(msg.includes('30') && msg.includes('1 November 2026'), msg);
      ctx.setNow('2026-11-01T00:00:02Z');
      assert.equal((await up(u, '198.51.100.61')).status, 200, `${kind}: new month`);
    }
    return { actual: 'Pro (paid & admin-granted): 30 allowed, 31st 429 limit=30, global counter exactly 30, next month allowed' };
  });

scenario('F4', 'Free lifetime-credit rule: once the single free identity poster is used, uploads are refused with IDENTITY_LIFETIME_USED (he/en text), before ANY provider call — even with sheet quota left',
  'poster-with-face spends the credit; then upload → 429 IDENTITY_LIFETIME_USED; moderation/paid calls 0', async () => {
    const u = await makeUser('f4', 'free');
    const p = await invoke(poster, { body: { prompt: 'A hero walks forward', characterImageUrl: FACE }, cookies: u.cookies, ip: '198.51.100.62' });
    assert.equal(p.status, 200); assert.equal(p.body.faceApplied, true);
    assert.equal(providers.counts['gemini-image'], 1, 'Free taste runs the cheap identity provider first');
    assert.equal(fake.num(`usage:identity:lifetime:${u.identifier}`), 1);
    const before = { ...providers.counts };
    const r = await up(u, '198.51.100.62');
    assert.equal(r.status, 429); assert.equal(r.body.code, 'IDENTITY_LIFETIME_USED');
    assert.deepEqual(providers.counts, before, 'zero provider calls (not even moderation)');
    assert.equal(providers.s3puts.length, 0);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0, 'sheet quota untouched');
    const en = getMsg('IDENTITY_LIFETIME_USED', 'en'); const he = getMsg('IDENTITY_LIFETIME_USED', 'he');
    assert.ok(en.length > 20 && he.length > 20);
    // and a second poster with a face is NOT refused: it degrades to a faceless poster with the explanation
    ctx.advance(61_000);
    const p2 = await invoke(poster, { body: { prompt: 'Another hero', characterImageUrl: FACE }, cookies: u.cookies, ip: '198.51.100.62' });
    assert.equal(p2.status, 200); assert.equal(p2.body.identityDegraded, true); assert.equal(p2.body.code, 'IDENTITY_LIFETIME_USED');
    return { actual: `upload → 429 IDENTITY_LIFETIME_USED; EN: "${en.slice(0, 70)}…"  HE: "${he.slice(0, 40)}…"; 2nd face poster → faceless + identityDegraded` };
  });

scenario('F5', 'a Free user who has NOT used the free poster can upload up to 3 times and the lifetime credit is untouched by uploads',
  'uploads never consume usage:identity:lifetime', async () => {
    const u = await makeUser('f5', 'free');
    for (let i = 0; i < 3; i++) assert.equal((await up(u, '198.51.100.63')).status, 200);
    assert.equal(fake.num(`usage:identity:lifetime:${u.identifier}`), 0);
    const p = await invoke(poster, { body: { prompt: 'A hero', characterImageUrl: FACE }, cookies: u.cookies, ip: '198.51.100.63' });
    assert.equal(p.body.faceApplied, true);
    return { actual: '3 uploads, lifetime credit still available, then the face poster works' };
  });

scenario('F6', 'Pro whose monthly identity credits (30) are used up is refused at upload with QUOTA_IDENTITY (separate from the sheet quota)',
  '429 QUOTA_IDENTITY, zero provider calls', async () => {
    const u = await makeUser('f6', 'paid');
    fake.set(`usage:identity:${u.identifier}:2026-10`, 30);
    const r = await up(u, '198.51.100.64');
    assert.equal(r.status, 429); assert.equal(r.body.code, 'QUOTA_IDENTITY');
    assert.deepEqual(providers.counts, {});
    return { actual: `${r.status} ${r.body.code}; two different monthly counters guard the feature (credits for posters, uploads for sheets)` };
  });

scenario('F7', 'moderation: an unsafe photo → 422 SAFETY_REJECTED with no reservation, no paid call, no R2 write; moderation outage fails CLOSED',
  '422 both times; global counter 0; sheet counter 0', async () => {
    const u = await makeUser('f7', 'free');
    providers.moderationVerdict.value = 'unsafe';
    const r = await up(u, '198.51.100.65');
    assert.equal(r.status, 422); assert.equal(r.body.code, 'SAFETY_REJECTED');
    providers.moderationVerdict.value = 'safe'; providers.mode.moderation = 500;
    const r2 = await up(u, '198.51.100.65');
    assert.equal(r2.status, 422);
    assert.equal(providers.paidTotal(), 0); assert.equal(providers.s3puts.length, 0);
    assert.equal(fake.num(GLOBAL()), 0); assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0);
    return { actual: 'unsafe + moderation outage both 422; nothing reserved or stored' };
  });

scenario('F8', 'consent is mandatory server-side; invalid payloads cost nothing',
  '400 CONSENT_REQUIRED / 400 for bad data URI, 0 calls', async () => {
    const u = await makeUser('f8', 'free');
    const a = await up(u, '198.51.100.66', { selfieBase64: PNG_DATA_URI }); assert.equal(a.status, 400); assert.equal(a.body.code, 'CONSENT_REQUIRED');
    const b = await up(u, '198.51.100.66', { selfieBase64: 'not-an-image', consent: true }); assert.equal(b.status, 400);
    assert.deepEqual(providers.counts, {});
    return { actual: `${a.status} CONSENT_REQUIRED, ${b.status} bad payload; 0 calls` };
  });

scenario('F9', 'provider failure: the sheet quota AND the global budget slot are given back (user is not charged for a failed paid call); behaviour = silent fallback to the raw selfie (documented)',
  'success:true sheetGenerated:false, usage:sheet 0, global 0', async () => {
    const u = await makeUser('f9', 'free');
    providers.mode['gemini-image'] = 500; providers.mode.grok = 500;
    const r = await up(u, '198.51.100.67');
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, false);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0); assert.equal(fake.num(GLOBAL()), 0);
    return { actual: '200 sheetGenerated:false (raw selfie used as reference); counters released', evidence: 'pages/api/upload-character.js provider-failure branch (design: degrade, do not charge)' };
  });

scenario('F10', 'upload rate limit: 5th request within 5 minutes → RATE_LIMITED (separate from the monthly quota), zero provider calls',
  '4 pass the limiter (3 ok + 1 QUOTA_SHEET), 5th is 429 RATE_LIMITED', async () => {
    const u = await makeUser('f10', 'free');
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await up(u, '198.51.100.68'));
    assert.deepEqual(out.map((r) => r.status), [200, 200, 200, 429, 429]);
    assert.deepEqual(out.map((r) => r.body.code).slice(3), ['QUOTA_SHEET', 'RATE_LIMITED']);
    return { actual: 'statuses 200,200,200,429(QUOTA_SHEET),429(RATE_LIMITED)' };
  });
