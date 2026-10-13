/** The raw selfie exists only to feed the sheet generator; it is deleted after EVERY attempt (R2 is mocked and recorded) and is never the user's reference. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '20-raw-selfie' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const upload = await ctx.route('upload-character');
const up = (u, ip) => invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip });
const ptr = (u) => JSON.parse(fake.get(`character:${u.identifier}`));
const RAW = /-raw\.(png|jpg|webp)$/;
const SHEET_Q = (u) => `usage:sheet:${u.identifier}:2026-10`;

scenario('S1', 'success: raw selfie stored → sheet generated and stored → pointer saved → raw object DELETED; the response and the pointer reference only the sheet',
  'puts [raw, sheet]; one delete = the raw key; pointer url == styledUrl == sheet URL', async () => {
    const u = await makeUser('s1', 'free');
    const r = await up(u, '198.51.100.100');
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, true);
    const [raw, sheet] = providers.s3puts.map((p) => p.key);
    assert.match(raw, RAW); assert.match(sheet, /-sheet\.jpg$/);
    assert.deepEqual(providers.s3deletes.map((d) => d.key), [raw]);
    assert.ok(r.body.characterImageUrl.endsWith(sheet));
    const p = ptr(u); assert.equal(p.url, p.styledUrl); assert.ok(!/-raw\./.test(JSON.stringify(p)), 'no pointer to the deleted raw photo');
    return { actual: `puts ${raw}, ${sheet}; deleted ${raw}` };
  });

scenario('S2', 'the raw delete keeps FAILING (R2 error): 3 tries, the user still gets the sheet (200), the leftover is marked hidden for the daily sweep (the owner alert is tested in 31-ugc-media, which runs as production)',
  '200 + sheet URL; 3 delete attempts; report:hidden:<raw> set', async () => {
    const u = await makeUser('s2', 'free'); providers.mode.s3delete = 500;
    const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
    let r; try { r = await up(u, '198.51.100.101'); } finally { console.error = orig; }
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, true); assert.ok(r.body.characterImageUrl.endsWith('-sheet.jpg'));
    const raw = providers.s3puts.find((p) => RAW.test(p.key)).key;
    assert.equal(providers.s3deletes.filter((d) => d.key === raw).length, 3);
    assert.ok(fake.get(`report:hidden:${raw}`), 'marked hidden so the sweep moves it to the private bucket');
    assert.ok(errs.some((e) => e.includes('raw selfie could not be deleted')) && !errs.join('\n').includes(raw), 'the log names no key');
    return { actual: '200 with the sheet; hidden mark + alert' };
  });

scenario('S3', 'sheet generation FAILS (provider down): 503 CHARACTER_SHEET_FAILED, the raw selfie is DELETED (never the reference), quota + budget slot given back, no pointer',
  '503, one delete = the raw key, usage:sheet 0, global 0, no character pointer', async () => {
    const u = await makeUser('s3', 'free'); providers.mode['gemini-image'] = 500; providers.mode.grok = 500;
    const r = await up(u, '198.51.100.102');
    assert.equal(r.status, 503); assert.equal(r.body.code, 'CHARACTER_SHEET_FAILED'); assert.equal(r.body.characterImageUrl, undefined);
    const raw = providers.s3puts.find((p) => RAW.test(p.key)).key;
    assert.deepEqual(providers.s3deletes.map((d) => d.key), [raw]);
    assert.equal(fake.num(SHEET_Q(u)), 0); assert.equal(fake.num('usage:identity:global:2026-10-15'), 0);
    assert.ok(!/characters\/[0-9a-f]{32}\//.test(fake.get(`character:${u.identifier}`) || ''), 'no pointer to a new object');
    return { actual: 'error, raw deleted, nothing charged' };
  });

scenario('S4', 'the sheet cannot be STORED (R2 put fails after a successful paid generation): 503, raw deleted, the user\'s sheet quota is back, the global slot keeps the real cost, no pointer',
  '503 CHARACTER_SHEET_FAILED; usage:sheet 0; global 1; raw deleted', async () => {
    const u = await makeUser('s4', 'free'); providers.mode.s3putSheet = 1;
    const r = await up(u, '198.51.100.103');
    assert.equal(r.status, 503); assert.equal(r.body.code, 'CHARACTER_SHEET_FAILED');
    const raw = providers.s3puts.find((p) => RAW.test(p.key)).key;
    assert.deepEqual(providers.s3deletes.map((d) => d.key), [raw]);
    assert.equal(fake.num(SHEET_Q(u)), 0); assert.equal(fake.num('usage:identity:global:2026-10-15'), 1);
    assert.ok(!/characters\/[0-9a-f]{32}\//.test(fake.get(`character:${u.identifier}`) || ''), 'no pointer to a new object');
    return { actual: 'error; raw deleted; user quota back' };
  });

scenario('S5', 'the RAW upload itself fails (R2 down before any paid call): 500, every reservation handed back, nothing to delete, nothing generated',
  '500 SERVER_ERROR; usage:sheet 0; global 0; no sheet-provider call', async () => {
    const u = await makeUser('s5', 'free'); providers.mode.s3putRaw = 1;
    const errs = []; const orig = console.error; console.error = (...a) => errs.push(a.join(' '));
    let r; try { r = await up(u, '198.51.100.104'); } finally { console.error = orig; }
    assert.equal(r.status, 500); assert.equal(r.body.code, 'SERVER_ERROR');
    assert.equal(fake.num(SHEET_Q(u)), 0); assert.equal(fake.num('usage:identity:global:2026-10-15'), 0);
    assert.ok(!providers.counts.grok && !providers.counts['gemini-image']);
    assert.equal(providers.s3deletes.length, 0);
    return { actual: 'reservations released; no paid call' };
  });
