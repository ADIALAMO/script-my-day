/** Scenario W — GET /api/admin/waitlist with REAL sessions: the 401/403/200 matrix, a real signup showing up, CSV headers, no e-mail on the console. */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '36-waitlist-admin', nodeEnv: 'production' });
after(() => ctx.afterAll());
const { scenario, invoke, makeUser, anonymous, fake, providers } = ctx;
const signup = await ctx.route('waitlist');
const admin = await ctx.route('admin/waitlist');
const KEY = { 'x-admin-key': process.env.ADMIN_SECRET };

scenario('W1', 'auth matrix: anonymous 401, free 403, pro 403, admin session 200, admin key header 200, key in the URL 401, POST 405 — and the denied answers carry no data',
  '401 / 403 / 403 / 200 / 200 / 401 / 405', async () => {
    await invoke(signup, { body: { email: 'seed@example.com', lang: 'he' }, ip: '198.51.100.130' });
    const free = await makeUser('w1f', 'free'); const pro = await makeUser('w1p', 'paid'); const adm = await makeUser('admin', 'admin');
    const get = (o = {}) => invoke(admin, { method: 'GET', ip: '198.51.100.131', ...o });
    const out = {};
    const anon = await get({ cookies: anonymous().cookies }); out.anonymous = anon.status;
    const f = await get({ cookies: free.cookies }); out.free = f.status;
    const p = await get({ cookies: pro.cookies }); out.pro = p.status;
    const a = await get({ cookies: adm.cookies }); out.admin = a.status;
    const k = await get({ headers: KEY }); out.adminKey = k.status;
    const q = await get({ query: { 'x-admin-key': process.env.ADMIN_SECRET, key: process.env.ADMIN_SECRET } }); out.keyInUrl = q.status;
    const post = await invoke(admin, { method: 'POST', cookies: adm.cookies, ip: '198.51.100.132' }); out.post = post.status;
    assert.deepEqual(out, { anonymous: 401, free: 403, pro: 403, admin: 200, adminKey: 200, keyInUrl: 401, post: 405 });
    for (const r of [anon, f, p, q]) { assert.deepEqual(Object.keys(r.body), ['error']); assert.ok(!JSON.stringify(r.body).includes('example.com')); }
    assert.equal(a.body.total, 1); assert.deepEqual(a.body.entries.map((e) => e.email), ['seed@example.com']);
    return { actual: JSON.stringify(out) };
  });

scenario('W2', 'a real signup (v1) + a legacy value appear together; the signed-in signup shows signedIn:true; CSV for the admin has the BOM, the userId and no-store headers',
  'mixed list; CSV attachment', async () => {
    const u = await makeUser('w2', 'free'); const adm = await makeUser('admin', 'admin');
    await invoke(signup, { body: { email: 'Real.User@Example.com', lang: 'en' }, cookies: u.cookies, ip: '198.51.100.133' });
    fake.set('waitlist:legacy.person@example.com', String(Date.UTC(2026, 5, 1)));
    const list = await invoke(admin, { method: 'GET', cookies: adm.cookies, ip: '198.51.100.134' });
    assert.equal(list.status, 200);
    const by = Object.fromEntries(list.body.entries.map((e) => [e.email, e]));
    assert.equal(by['real.user@example.com'].signedIn, true); assert.equal(by['real.user@example.com'].source, 'pro-modal');
    assert.equal(by['legacy.person@example.com'].source, 'legacy-waitlist'); assert.equal(by['legacy.person@example.com'].signedIn, false);
    assert.ok(list.body.entries.findIndex((e) => e.email === 'real.user@example.com') < list.body.entries.findIndex((e) => e.email === 'legacy.person@example.com'), 'newest first');
    const csv = await invoke(admin, { method: 'GET', query: { format: 'csv' }, cookies: adm.cookies, ip: '198.51.100.135' });
    assert.equal(csv.status, 200); assert.equal(csv.headers['content-type'], 'text/csv; charset=utf-8');
    assert.match(csv.headers['content-disposition'], /^attachment; filename="waitlist-\d{4}-\d{2}-\d{2}\.csv"$/);
    for (const r of [list, csv]) assert.match(r.headers['cache-control'], /no-store/);
    const body = csv.body;
    assert.equal(body.charCodeAt(0), 0xFEFF); assert.ok(body.includes(`real.user@example.com,`) && body.includes(u.id));
    return { actual: 'list + CSV ok' };
  });

scenario('W3', 'nothing is written to the console with an address while listing / exporting; telegram and other providers are not touched',
  'no address in console output; no outbound call', async () => {
    const adm = await makeUser('admin', 'admin');
    const lines = []; const o = { w: console.warn, e: console.error, l: console.log }; console.warn = console.error = console.log = (...a) => lines.push(a.map(String).join(' '));
    try { await invoke(admin, { method: 'GET', cookies: adm.cookies, ip: '198.51.100.136' }); await invoke(admin, { method: 'GET', query: { format: 'csv' }, cookies: adm.cookies, ip: '198.51.100.136' }); }
    finally { console.warn = o.w; console.error = o.e; console.log = o.l; }
    assert.ok(!lines.join('\n').includes('@'), 'an address reached the console');
    assert.deepEqual(providers.unexpected, []);
    return { actual: 'console clean' };
  });
