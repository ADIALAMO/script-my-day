/** R2 object keys: random + HMAC owner segment for NEW uploads; old URLs keep working. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_DATA_URI } from './lib/providers.mjs';

const ctx = await boot({ file: '18-object-keys' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, makeUser, fake } = ctx;
const upload = await ctx.route('upload-character');
const panelUp = await ctx.route('upload-panel');
const poster = await ctx.route('generate-poster');
const { ownerSegment } = await import('../../lib/upload-image.js');
const OLD_URL = 'https://pub-test.r2.dev/characters/user_old123-raw-1700000000000.jpg';   // pre-change key format

scenario('Q1', 'new character uploads and panel/poster uploads write random keys under an HMAC owner segment: no user id, no IP, no plain hash in any key',
  'characters/<32 hex>/<uuid>-raw|sheet.jpg and panels|posters/<32 hex>/<uuid>.png', async () => {
    const u = await makeUser('q1', 'free');
    const before = providers.s3puts.length;
    const r = await invoke(upload, { body: { selfieBase64: PNG_DATA_URI, consent: true, adult: true }, cookies: u.cookies, ip: '198.51.100.90' });
    assert.equal(r.status, 200);
    const keys = providers.s3puts.slice(before).map((p) => p.key);
    assert.equal(keys.length, 2);
    assert.match(keys[0], /^characters\/[0-9a-f]{32}\/[0-9a-f-]{36}-raw\.jpg$/);
    assert.match(keys[1], /^characters\/[0-9a-f]{32}\/[0-9a-f-]{36}-sheet\.jpg$/);
    assert.equal(keys[0].split('/')[1], ownerSegment(u.identifier));
    assert.ok(keys.every((k) => !k.includes(u.identifier)), 'user id not in any key');
    // guest panel upload: owner = HMAC of the IP
    const gb = providers.s3puts.length;
    const g = await invoke(panelUp, { body: { key: 'posters/x.png', imageData: PNG_DATA_URI }, ip: '203.0.113.91' });
    assert.equal(g.status, 200); assert.ok(g.body.url, JSON.stringify(g.body));
    const gk = providers.s3puts[gb].key;
    assert.match(gk, /^posters\/[0-9a-f]{32}\/[0-9a-f-]{36}\.png$/);
    assert.equal(gk.split('/')[1], ownerSegment('203.0.113.91'));
    assert.ok(!gk.includes('203.0.113.91'));
    return { actual: `character keys ${keys.join(' , ')} ; guest key ${gk}` };
  });

scenario('Q2', 'EXISTING objects keep working: an old-format character URL is accepted as a face reference and as the stored pointer (nothing parses the key)',
  'poster with the old URL → 200 identity path; GET /api/character returns the old pointer unchanged', async () => {
    const u = await makeUser('q2', 'paid');
    const r = await invoke(poster, { body: { prompt: 'a hero', characterImageUrl: OLD_URL }, cookies: u.cookies, ip: '198.51.100.92' });
    assert.equal(r.status, 200);
    const character = await ctx.route('character');
    fake.set(`character:${u.identifier}`, JSON.stringify({ url: OLD_URL, styledUrl: OLD_URL }));
    const c = await invoke(character, { method: 'GET', cookies: u.cookies, ip: '198.51.100.92' });
    assert.equal(c.body.characterImageUrl, OLD_URL);
    return { actual: 'old URL accepted; pointer read back unchanged' };
  });
