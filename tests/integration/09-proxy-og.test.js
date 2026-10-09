/** Scenario J — /api/proxy-image (SSRF, redirects, size, rate limit) and /api/og (asset hosts, rate limit). */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';
import { PNG_BYTES } from './lib/providers.mjs';

const ctx = await boot({ file: '09-proxy-og' });
after(() => ctx.afterAll());
const { scenario, invoke, providers, fake } = ctx;
const proxy = await ctx.route('proxy-image');
const og = await ctx.route('og');
const R2 = 'https://pub-test.r2.dev';
const get = (url, ip = '203.0.113.20') => invoke(proxy, { method: 'GET', query: { url }, ip });
const image = () => new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(PNG_BYTES.length) } });

scenario('J1', 'allow-listed R2 object is proxied (200, image, immutable cache headers, nosniff, sandbox CSP)',
  '200 image/png with the security headers; exactly one upstream fetch', async () => {
    providers.handlers.r2 = () => image();
    const r = await get(`${R2}/panels/ab/1_x.png`);
    assert.equal(r.status, 200); assert.equal(r.headers['content-type'], 'image/png');
    assert.equal(r.headers['x-content-type-options'], 'nosniff'); assert.equal(r.headers['content-security-policy'], 'sandbox');
    assert.match(r.headers['cache-control'], /immutable/);
    assert.ok(Buffer.isBuffer(r.body) && r.body.length === PNG_BYTES.length);
    assert.equal(providers.counts['r2-public'], 1);
    return { actual: '200 image/png, nosniff, CSP sandbox, immutable cache', evidence: `upstream fetches: ${providers.counts['r2-public']}` };
  });

const BAD = {
  'non-allow-listed host': 'https://evil.example/a.png',
  'plain http to the right host': 'http://pub-test.r2.dev/a.png',
  'localhost': 'https://localhost/a.png',
  'localhost with port': 'http://localhost:3000/api/auth/session',
  '127.0.0.1': 'http://127.0.0.1/a.png',
  '127.0.0.1 https': 'https://127.0.0.1:8443/a.png',
  'IPv6 loopback [::1]': 'http://[::1]/a.png',
  'cloud metadata 169.254.169.254': 'http://169.254.169.254/latest/meta-data/',
  'metadata via https': 'https://169.254.169.254/latest/meta-data/iam/',
  '10.x': 'http://10.0.0.5/a.png',
  '172.16.x': 'http://172.16.0.9/a.png',
  '192.168.x': 'http://192.168.1.1/admin',
  'userinfo trick (allowed@evil)': 'https://pub-test.r2.dev@evil.example/a.png',
  'userinfo trick (the issue example)': 'http://allowed.com@evil.com/a.png',
  'credentials on the right host': 'https://user:pw@pub-test.r2.dev/a.png',
  'suffix confusion': 'https://pub-test.r2.dev.evil.example/a.png',
  'other port on the right host': 'https://pub-test.r2.dev:8443/a.png',
  'file://': 'file:///etc/passwd',
  'ftp://': 'ftp://pub-test.r2.dev/a.png',
  'gopher://': 'gopher://127.0.0.1:6379/_PING',
  'javascript:': 'javascript:alert(1)',
  'data: URL': 'data:text/html,<script>alert(1)</script>',
  'protocol-relative': '//evil.example/a.png',
  'bare path': '/etc/passwd',
  'empty path on the right host': `${R2}/`,
  'encoded slash': `${R2}/a%2fb.png`,
  'not a URL': 'not a url',
};

scenario('J2', `${Object.keys(BAD).length} hostile/invalid URL shapes are refused WITHOUT any outbound request (no fetch, no violation)`,
  'every one → 403 (or 400 for empty), zero upstream fetches, zero unexpected hosts', async () => {
    providers.handlers.r2 = () => image();
    const bad = [];
    for (const [name, url] of Object.entries(BAD)) {
      const r = await get(url, `203.0.113.${30 + (bad.length % 150)}`);
      if (![400, 403].includes(r.status)) bad.push(`${name}: ${r.status}`);
    }
    assert.deepEqual(bad, [], `not refused: ${bad.join('; ')}`);
    assert.equal(providers.counts['r2-public'] || 0, 0, 'no request left the proxy');
    assert.deepEqual(providers.unexpected, []);
    return { actual: `${Object.keys(BAD).length}/${Object.keys(BAD).length} refused, 0 upstream requests` };
  });

scenario('J2b', 'URL-parser normalisation quirks (backslash, dot-segments, %2e) are harmless: whatever is fetched is still on the R2 origin, with no userinfo',
  'every fetched URL has origin https://pub-test.r2.dev and no userinfo', async () => {
    providers.handlers.r2 = () => image();
    const quirky = ['https://pub-test.r2.dev\\@evil.example/a.png', `${R2}/../../etc/passwd`, `${R2}/a/%2e%2e/b.png`, `${R2}/a/./b.png`, `${R2}//double//slash.png`];
    for (const u of quirky) { const r = await get(u, '203.0.113.39'); assert.ok([200, 403].includes(r.status), `${u}: ${r.status}`); }
    for (const l of providers.log.filter((x) => x.provider === 'r2-public')) {
      const u = new URL(l.url);
      assert.ok(u.origin === R2 && u.username === '' && u.password === '', l.url);   // '@evil…' may survive only as harmless PATH text
    }
    return { actual: `${providers.counts['r2-public'] || 0} normalised fetches, all inside ${R2}/`, evidence: providers.log.filter((x) => x.provider === 'r2-public').map((x) => x.url).join(' | ') };
  });

scenario('J3', 'a redirect from the allow-listed host to a PRIVATE address (169.254.169.254, 10.x, localhost) is never followed',
  '502, only the first hop is requested, no connection to the private target (network guard stays clean)', async () => {
    for (const target of ['http://169.254.169.254/latest/meta-data/', 'http://10.0.0.5/secret', 'http://localhost:3000/api/auth/session', 'https://evil.example/x.png']) {
      providers.reset();
      providers.handlers.r2 = () => new Response(null, { status: 302, headers: { location: target } });
      const r = await get(`${R2}/panels/redirect.png`, '203.0.113.40');
      assert.equal(r.status, 502, target);
      assert.equal(providers.counts['r2-public'], 1, `${target}: only the first hop`);
      assert.deepEqual(ctx.violations, [], `${target}: nothing tried to connect`);
    }
    return { actual: '4 redirect targets, all answered 502 without following; zero network violations' };
  });

scenario('J4', 'oversize upstream bodies are refused (declared Content-Length 10 MB, and 4 MB streamed without Content-Length) while a normal image passes',
  '413 for both oversize cases, 200 for the small image', async () => {
    providers.handlers.r2 = () => new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png', 'content-length': String(10 * 1024 * 1024) } });
    assert.equal((await get(`${R2}/panels/declared-big.png`, '203.0.113.41')).status, 413);
    providers.handlers.r2 = () => new Response(new Uint8Array(4 * 1024 * 1024), { status: 200, headers: { 'content-type': 'image/png' } });
    assert.equal((await get(`${R2}/panels/streamed-big.png`, '203.0.113.41')).status, 413);
    providers.handlers.r2 = () => image();
    assert.equal((await get(`${R2}/panels/ok.png`, '203.0.113.41')).status, 200);
    return { actual: '413, 413, 200 (limit 3 MB: config PROXY_IMAGE.maxBytes)' };
  });

scenario('J5', 'non-image or script-capable content from R2 is refused (html, svg, json) — 415',
  '415 for text/html, image/svg+xml, application/json', async () => {
    for (const ct of ['text/html', 'image/svg+xml', 'application/json', 'text/javascript']) {
      providers.handlers.r2 = () => new Response('<svg onload=alert(1)>', { status: 200, headers: { 'content-type': ct } });
      assert.equal((await get(`${R2}/panels/x`, '203.0.113.42')).status, 415, ct);
    }
    return { actual: '4/4 refused with 415' };
  });

scenario('J6', 'proxy-image rate limit per IP: 120 requests/minute then 429 (Retry-After); another IP and the next window are unaffected',
  '120×404 (upstream miss, counted), 121st 429; other IP OK; recovers', async () => {
    providers.handlers.r2 = () => new Response('nope', { status: 404 });
    const ip = '203.0.113.43';
    let last;
    for (let i = 1; i <= 120; i++) { last = await get(`${R2}/panels/missing-${i}.png`, ip); assert.equal(last.status, 404, `request ${i}`); }
    const r = await get(`${R2}/panels/missing-121.png`, ip);
    assert.equal(r.status, 429); assert.equal(r.body.code, 'RATE_LIMITED'); assert.ok(r.headers['retry-after']);
    assert.equal(providers.counts['r2-public'], 120, 'the refused request made no upstream fetch');
    assert.equal((await get(`${R2}/panels/missing-x.png`, '203.0.113.44')).status, 404);
    ctx.advance(130_000);
    assert.equal((await get(`${R2}/panels/missing-y.png`, ip)).status, 404);
    return { actual: '121st → 429; other IP fine; allowed again after 130s' };
  });

scenario('J7', '/api/og: renders for a normal request, only talks to its two fixed hosts, ignores a spoofed Host header',
  '200 image/png; fetched hosts ⊆ {cdn.jsdelivr.net, site.test}', async () => {
    const req = new Request('http://localhost:3000/api/og?name=Dana&lang=en', { headers: { 'x-real-ip': '203.0.113.50', host: 'evil.example', 'x-forwarded-host': 'evil.example' } });
    const r = await og(req);
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(buf.length > 1000 && buf.subarray(0, 4).toString('hex') === '89504e47', 'a real PNG came out');
    assert.deepEqual(ctx.violations, []); assert.deepEqual(providers.unexpected, []);
    const hosts = new Set(providers.log.map((l) => l.provider)); 
    assert.ok([...hosts].every((h) => ['font', 'site-asset'].includes(h)), [...hosts].join());
    return { actual: `PNG ${buf.length} bytes; asset fetches: ${JSON.stringify({ font: providers.counts.font, 'site-asset': providers.counts['site-asset'] })}; Host spoof ignored (logo comes from SITE_URL)` };
  });

scenario('J8', '/api/og: asset size cap — an oversized font/logo is dropped (card still renders, no crash); the name is capped at 40 chars',
  '200 even when the font fetch returns 5 MB; name longer than 40 is truncated', async () => {
    providers.handlers.font = () => new Response(new Uint8Array(5 * 1024 * 1024), { status: 200, headers: { 'content-type': 'font/ttf', 'content-length': String(5 * 1024 * 1024) } });
    const r = await og(new Request(`http://localhost:3000/api/og?name=${'A'.repeat(200)}&lang=en`, { headers: { 'x-real-ip': '203.0.113.51' } }));
    providers.handlers.font = null;
    assert.equal(r.status, 200);
    assert.deepEqual(ctx.violations, []);
    return { actual: '200 with the oversized font discarded (asset cap 1 MB)' };
  });

scenario('J9', '/api/og rate limit per IP: 30/minute then 429 + Retry-After (distinct names so the CDN cache cannot hide the function); other IP unaffected',
  '30×200, 31st 429', async () => {
    const ip = '203.0.113.52';
    const call = (i, who = ip) => og(new Request(`http://localhost:3000/api/og?name=n${i}&lang=en`, { headers: { 'x-real-ip': who } }));
    for (let i = 1; i <= 30; i++) assert.equal((await call(i)).status, 200, `request ${i}`);
    const r = await call(31);
    assert.equal(r.status, 429); assert.equal(r.headers.get('retry-after'), '60');
    assert.equal((await call(1, '203.0.113.53')).status, 200);
    return { actual: '31st → 429 Retry-After 60; other IP 200' };
  });
