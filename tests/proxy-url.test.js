import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveAllowedUrl, isPrivateHostname, readCapped } from '../lib/proxy-url.js';

const BASE = 'https://pub-abc123.r2.dev';

test('accepts objects under the R2 public origin', () => {
  assert.equal(resolveAllowedUrl(`${BASE}/panels/ab/1_x.png`, BASE), `${BASE}/panels/ab/1_x.png`);
  assert.equal(resolveAllowedUrl(`${BASE}/posters/x.jpg`, `${BASE}/`), `${BASE}/posters/x.jpg`);
});

test('rejects every SSRF / confusion variant', () => {
  const bad = [
    'http://pub-abc123.r2.dev/a.png',                       // wrong scheme
    'https://evil.example/a.png',                           // other host
    'https://pub-abc123.r2.dev.evil.example/a.png',         // suffix confusion
    'https://pub-abc123.r2.dev@evil.example/a.png',         // userinfo trick
    'https://user:pw@pub-abc123.r2.dev/a.png',              // credentials
    'https://pub-abc123.r2.dev:8443/a.png',                 // other port
    `${BASE}/a%2fb.png`,                                    // encoded slash
    `${BASE}/`,                                             // no object
    'https://127.0.0.1/a.png', 'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/a.png', 'https://10.0.0.5/a.png', 'https://localhost/a.png',
    '//evil.example/a.png', 'javascript:alert(1)', 'file:///etc/passwd', '', 'not a url', 42, null,
    `${BASE}/${'a'.repeat(3000)}`,
  ];
  for (const u of bad) assert.equal(resolveAllowedUrl(u, BASE), null, String(u).slice(0, 60));
});

test('dot-segments are normalised by URL parsing and can never leave the R2 origin', () => {
  const r = resolveAllowedUrl(`${BASE}/../../etc/passwd`, BASE);
  assert.equal(r, `${BASE}/etc/passwd`);
  assert.equal(resolveAllowedUrl(`${BASE}/a/%2e%2e/b.png`, BASE), `${BASE}/b.png`); // still same origin
});

test('a misconfigured (non-https or private) base never allows anything', () => {
  assert.equal(resolveAllowedUrl('http://pub.r2.dev/a.png', 'http://pub.r2.dev'), null);
  assert.equal(resolveAllowedUrl('https://10.1.2.3/a.png', 'https://10.1.2.3'), null);
});

test('private-host classifier', () => {
  for (const h of ['localhost', 'a.localhost', 'x.internal', 'db.local', '127.0.0.1', '10.0.0.1', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '[::1]', '::ffff:10.0.0.1', 'fe80::1', '8.8.8.8']) {
    assert.equal(isPrivateHostname(h), true, h);
  }
  for (const h of ['pub-abc123.r2.dev', 'images.example.com']) assert.equal(isPrivateHostname(h), false, h);
});

test('readCapped enforces the byte cap with and without Content-Length', async () => {
  const mk = (bytes, headers = {}) => new Response(new Uint8Array(bytes), { headers });
  assert.equal((await readCapped(mk(100), 1000)).length, 100);
  assert.equal(await readCapped(mk(5000), 1000), null);                                    // streamed overflow
  assert.equal(await readCapped(mk(10, { 'content-length': '999999' }), 1000), null);      // declared overflow
});
