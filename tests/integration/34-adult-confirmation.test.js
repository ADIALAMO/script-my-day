/** Scenario A — "Star Yourself" adult confirmation: stored per ACCOUNT with a time, enforced by upload-character (403), asked once, everything else unaffected, existing users keep their character. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '34-adult-confirmation' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake, anonymous } = ctx;
const upload = await ctx.route('upload-character');
const confirm = await ctx.route('adult-confirmation');
const character = await ctx.route('character');
const script = await ctx.route('generate-script');
const poster = await ctx.route('generate-poster');
const { getMsg } = await import('../../lib/messages.js');
const FACE = 'https://pub-test.r2.dev/characters/face.jpg';
let n = 0;
const ip = () => `198.51.101.${++n}`;
const up = (u, body = { selfieBase64: PNG_DATA_URI, consent: true }) => invoke(upload, { body, cookies: u.cookies, ip: ip() });
const sayYes = (u, body = { adult: true }) => invoke(confirm, { method: 'POST', body, cookies: u.cookies, ip: ip() });
const record = (u) => { const raw = fake.get(`user:adult:${u.id}`); return raw ? JSON.parse(raw) : null; };

scenario('A1', 'an account without the confirmation is refused with 403 ADULT_CONFIRMATION_REQUIRED before ANY quota, storage or provider call; a forged client flag changes nothing',
  '403 ×3, no provider calls, no R2 writes, sheet quota 0, no identity budget', async () => {
    const u = await makeUser('a1', 'free', { adult: false });
    for (const body of [{ selfieBase64: PNG_DATA_URI, consent: true }, { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, { selfieBase64: PNG_DATA_URI, consent: true, adultConfirmed: true }]) {
      const r = await up(u, body); assert.equal(r.status, 403); assert.equal(r.body.code, 'ADULT_CONFIRMATION_REQUIRED');
    }
    assert.deepEqual(providers.counts, {}); assert.equal(providers.s3puts.length, 0);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0);
    assert.equal(fake.num('usage:identity:global:2026-10-15'), 0);
    for (const l of ['en', 'he']) assert.match(getMsg('ADULT_CONFIRMATION_REQUIRED', l), /18/);
    assert.match(getMsg('ADULT_CONFIRMATION_REQUIRED', 'en'), /without a photo/);
  });

scenario('A2', 'POST /api/adult-confirmation stores the confirmation per account with a timestamp; the second call keeps the FIRST time; then the upload works and nothing is asked again',
  'record {at,v:1}; same at after a day; upload 200 twice', async () => {
    const u = await makeUser('a2', 'free', { adult: false });
    assert.equal((await sayYes(u)).status, 200);
    const first = record(u); assert.ok(first && !Number.isNaN(Date.parse(first.at)) && first.v === 1);
    ctx.advance(24 * 3600 * 1000);
    assert.equal((await sayYes(u)).status, 200);
    assert.equal(record(u).at, first.at, 'first timestamp kept');
    assert.equal((await up(u)).status, 200);
    assert.equal((await up(u)).status, 200);   // the declaration is NOT repeated on later uploads
    assert.equal(fake.get(`user:adult:${u.id}`) !== null, true);
  });

scenario('A3', 'the declaration needs a signed-in account and a real boolean true: anonymous → 401, missing / "true" / false → 400, nothing stored',
  '401 / 400 ×3', async () => {
    const a = anonymous(ip());
    const r0 = await invoke(confirm, { method: 'POST', body: { adult: true }, ip: a.ip }); assert.equal(r0.status, 401);
    const u = await makeUser('a3', 'free', { adult: false });
    for (const body of [{}, { adult: 'true' }, { adult: false }]) assert.equal((await sayYes(u, body)).status, 400);
    assert.equal(record(u), null);
    assert.equal((await invoke(confirm, { method: 'GET', cookies: u.cookies, ip: ip() })).status, 405);
  });

scenario('A4', 'per ACCOUNT, not per device or neighbour: confirming user A does not confirm user B (same IP and device header)',
  'A uploads 200, B 403', async () => {
    const A = await makeUser('a4a', 'free', { adult: false }); const B = await makeUser('a4b', 'free', { adult: false });
    const same = '198.51.101.250';
    await invoke(confirm, { method: 'POST', body: { adult: true }, cookies: A.cookies, ip: same, headers: { 'x-device-id': 'dev-1' } });
    assert.equal((await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: A.cookies, ip: same, headers: { 'x-device-id': 'dev-1' } })).status, 200);
    const rb = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, cookies: B.cookies, ip: same, headers: { 'x-device-id': 'dev-1' } });
    assert.equal(rb.status, 403); assert.equal(rb.body.code, 'ADULT_CONFIRMATION_REQUIRED');
  });

scenario('A5', 'an unconfirmed user still uses everything else: scripts, faceless posters work; anonymous uploads keep the old NEEDS_PRO answer',
  'script 200, poster 200, anonymous upload 403 NEEDS_PRO', async () => {
    const u = await makeUser('a5', 'free', { adult: false });
    const s = await invoke(script, { body: { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama', gender: 'neutral' }, cookies: u.cookies, ip: ip() });
    assert.equal(s.status, 200);
    const p = await invoke(poster, { body: { prompt: 'A lighthouse at dawn' }, cookies: u.cookies, ip: ip() });
    assert.equal(p.status, 200);
    const anon = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, ip: ip() });
    assert.equal(anon.status, 403); assert.equal(anon.body.code, 'NEEDS_PRO');
  });

scenario('A6', 'EXISTING user with a saved character and no record: the character is still returned and still used for generation; GET /api/character says adultConfirmed:false so the app asks next time the feature is opened; uploading is refused until confirmed',
  'GET → url + adultConfirmed false; poster with the face 200; upload 403; after confirming GET → true', async () => {
    const u = await makeUser('a6', 'free', { adult: false });   // makeUser seeds a character pointer for every test user
    const g = await invoke(character, { method: 'GET', cookies: u.cookies, ip: ip() });
    assert.equal(g.status, 200); assert.equal(g.body.characterImageUrl, FACE); assert.equal(g.body.adultConfirmed, false);
    const p = await invoke(poster, { body: { prompt: 'A hero walks forward', characterImageUrl: FACE }, cookies: u.cookies, ip: ip() });
    assert.equal(p.status, 200, 'the existing character keeps working in generation');
    assert.equal((await up(u)).status, 403);
    await sayYes(u);
    const g2 = await invoke(character, { method: 'GET', cookies: u.cookies, ip: ip() });
    assert.equal(g2.body.adultConfirmed, true); assert.equal(g2.body.characterImageUrl, FACE);
  });

scenario('A7', 'Redis cannot answer the confirmation read → the upload FAILS CLOSED (503), no provider call, nothing stored',
  '503 SERVER_ERROR', async () => {
    const u = await makeUser('a7', 'free', { adult: false });
    const oe = console.error; console.error = () => {};
    try {
      fake.control.failCommands.add('GET');
      const r = await up(u);
      fake.control.failCommands.delete('GET');
      assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVER_ERROR');
    } finally { console.error = oe; fake.control.failCommands.clear(); }
    assert.deepEqual(providers.counts, {}); assert.equal(providers.s3puts.length, 0);
  });

scenario('A8', 'admin key (the owner testing) is not blocked; an admin-TIER account is treated like everyone else until it confirms',
  'key → 200; tier admin without record → 403', async () => {
    const k = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true }, headers: ctx.adminKeyHeader, ip: ip() });
    assert.equal(k.status, 200);
    const a = await makeUser('a8', 'admin', { adult: false });
    assert.equal((await up(a)).status, 403);
  });
