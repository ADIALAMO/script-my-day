/** Production without OBJECT_KEY_SECRET must fail CLOSED: no photo is stored, no paid call, no quota burned. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '19-object-key-secret', nodeEnv: 'production', env: { OBJECT_KEY_SECRET: '' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const upload = await ctx.route('upload-character');
const panelUp = await ctx.route('upload-panel');

scenario('R1', 'production without OBJECT_KEY_SECRET: character upload → 503 SERVER_ERROR, panel upload → 500 with a clear message; nothing written to R2, no paid call, no quota used',
  '503 / 500, s3puts 0, paid 0', async () => {
    const u = await makeUser('r1', 'free');
    const r = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.93' });
    assert.equal(r.status, 503); assert.equal(r.body.code, 'SERVER_ERROR');
    const p = await invoke(panelUp, { body: { key: 'posters/x.png', imageData: PNG_DATA_URI }, ip: '203.0.113.94' });
    assert.equal(p.status, 500); assert.match(p.body.error, /secret not configured/i);
    assert.equal(providers.s3puts.length, 0); assert.equal(providers.paidTotal(), 0);
    assert.equal(fake.num(`usage:sheet:${u.identifier}:2026-10`), 0);
    return { actual: 'fail closed: 503 + 500, nothing stored, nothing spent' };
  });
