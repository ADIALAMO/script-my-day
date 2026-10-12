/** The raw selfie exists only to feed the sheet generator; it is deleted once the sheet is stored (R2 is mocked and recorded). */
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

scenario('S1', 'success: raw selfie stored → sheet generated and stored → pointer saved → raw object DELETED; the response and the pointer reference only the sheet',
  'puts [raw, sheet]; one delete = the raw key; pointer url == styledUrl == sheet URL', async () => {
    const u = await makeUser('s1', 'free');
    const r = await up(u, '198.51.100.100');
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, true);
    const [raw, sheet] = providers.s3puts.map((p) => p.key);
    assert.match(raw, /-raw\.jpg$/); assert.match(sheet, /-sheet\.jpg$/);
    assert.deepEqual(providers.s3deletes.map((d) => d.key), [raw]);
    assert.ok(r.body.characterImageUrl.endsWith(sheet));
    const p = ptr(u); assert.equal(p.url, p.styledUrl); assert.ok(!JSON.stringify(p).includes('-raw.jpg'), 'no pointer to the deleted raw photo');
    return { actual: `puts ${raw}, ${sheet}; deleted ${raw}` };
  });

scenario('S2', 'the raw delete FAILS (R2 error): the user still gets the sheet (200, sheetGenerated true) — a cleanup problem never costs the user their result',
  '200 + sheet URL; the failed delete is only logged', async () => {
    const u = await makeUser('s2', 'free'); providers.mode.s3delete = 500;
    const warns = []; const orig = console.warn; console.warn = (...a) => warns.push(a.join(' '));
    let r; try { r = await up(u, '198.51.100.101'); } finally { console.warn = orig; }
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, true); assert.ok(r.body.characterImageUrl.endsWith('-sheet.jpg'));
    assert.equal(providers.s3deletes.length, 1);
    assert.ok(warns.some((w) => w.includes('Raw selfie could not be deleted')), warns.join('\n'));
    return { actual: '200 with the sheet; delete failure logged' };
  });

scenario('S3', 'sheet generation FAILS (provider down): the raw selfie is the only reference the user has, so it is KEPT (no delete) and the pointer references it',
  'sheetGenerated false, 0 deletes, characterImageUrl = raw URL', async () => {
    const u = await makeUser('s3', 'free'); providers.mode['gemini-image'] = 500; providers.mode.grok = 500;
    const r = await up(u, '198.51.100.102');
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, false);
    assert.equal(providers.s3deletes.length, 0);
    assert.ok(r.body.characterImageUrl.endsWith('-raw.jpg'));
    assert.equal(ptr(u).url, r.body.characterImageUrl);
    return { actual: 'raw kept as the reference; no delete' };
  });

scenario('S4', 'the sheet cannot be STORED (R2 put fails after a successful paid generation): raw kept as the reference, no delete',
  'sheetGenerated false, 0 deletes', async () => {
    const u = await makeUser('s4', 'free'); providers.mode.s3putSheet = 1;
    const r = await up(u, '198.51.100.103');
    assert.equal(r.status, 200); assert.equal(r.body.sheetGenerated, false);
    assert.equal(providers.s3deletes.length, 0); assert.ok(r.body.characterImageUrl.endsWith('-raw.jpg'));
    return { actual: 'raw kept; user still has a reference' };
  });
