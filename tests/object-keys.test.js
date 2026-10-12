import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const load = async (env) => {
  for (const k of ['OBJECT_KEY_SECRET', 'NODE_ENV']) delete process.env[k];
  Object.assign(process.env, env);
  return import(`../lib/upload-image.js?${Math.random()}`);
};

test('panel/poster key = <kind>/<HMAC owner>/<uuid>.<ext>; no identifier, no plain hash of it', async () => {
  const m = await load({ OBJECT_KEY_SECRET: 'unit-secret' });
  const key = m.buildObjectKey('panels', '203.0.113.9', 'png');
  assert.match(key, /^panels\/[0-9a-f]{32}\/[0-9a-f-]{36}\.png$/);
  assert.ok(!key.includes('203.0.113.9'));
  assert.ok(!key.includes(createHash('sha256').update('203.0.113.9').digest('hex').slice(0, 16)), 'not the old brute-forceable sha256 prefix');
});

test('owner segment is deterministic per secret+identifier (so deletion can list by prefix), differs per secret and identifier', async () => {
  const a = await load({ OBJECT_KEY_SECRET: 's1' });
  const a1 = a.ownerSegment('user-1'), a2 = a.ownerSegment('user-2');
  assert.equal(a.ownerSegment('user-1'), a1);
  assert.notEqual(a1, a2);
  const b = await load({ OBJECT_KEY_SECRET: 's2' });
  assert.notEqual(b.ownerSegment('user-1'), a1);
});

test('object names are unguessable: 200 keys, no repeats, 122-bit uuid names', async () => {
  const m = await load({ OBJECT_KEY_SECRET: 's' });
  const set = new Set(Array.from({ length: 200 }, () => m.buildObjectKey('posters', 'u', 'jpg')));
  assert.equal(set.size, 200);
});

test('character keys: random shared id, raw + sheet under the HMAC owner, user id never in the key', async () => {
  const m = await load({ OBJECT_KEY_SECRET: 's' });
  const k1 = m.buildCharacterKeys('user:abc123'), k2 = m.buildCharacterKeys('user:abc123');
  assert.match(k1.raw, /^characters\/[0-9a-f]{32}\/[0-9a-f-]{36}-raw\.jpg$/);
  assert.match(k1.sheet, /^characters\/[0-9a-f]{32}\/[0-9a-f-]{36}-sheet\.jpg$/);
  assert.notEqual(k1.raw, k2.raw);
  assert.ok(!k1.raw.includes('abc123'));
  assert.equal(k1.raw.split('/')[1], k2.raw.split('/')[1], 'same owner segment');
});

test('production without OBJECT_KEY_SECRET fails closed with a clear error; dev/test fall back', async () => {
  const prod = await load({ NODE_ENV: 'production' });
  assert.equal(prod.objectKeySecretConfigured(), false);
  assert.throws(() => prod.buildObjectKey('panels', 'x', 'png'), /OBJECT_KEY_SECRET is not configured/);
  assert.throws(() => prod.buildCharacterKeys('x'), /OBJECT_KEY_SECRET/);
  const dev = await load({ NODE_ENV: 'test' });
  assert.equal(dev.objectKeySecretConfigured(), true);
  assert.doesNotThrow(() => dev.buildObjectKey('panels', 'x', 'png'));
});

test('legacy owner segment (sha256[:16]) is still computable for the deletion tool', async () => {
  const m = await load({ OBJECT_KEY_SECRET: 's' });
  assert.equal(m.legacyOwnerSegment('1.2.3.4'), createHash('sha256').update('1.2.3.4').digest('hex').slice(0, 16));
});

test('keyFromPublicUrl maps only our own public URLs back to object keys', async () => {
  process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev/';
  const { keyFromPublicUrl } = await import(`../lib/blob-store.js?${Math.random()}`);
  assert.equal(keyFromPublicUrl('https://pub-test.r2.dev/characters/a/b-raw.jpg'), 'characters/a/b-raw.jpg');
  assert.equal(keyFromPublicUrl('https://evil.example/characters/a.jpg'), null);
  assert.equal(keyFromPublicUrl('https://pub-test.r2.dev.evil.example/x'), null);
  assert.equal(keyFromPublicUrl(null), null);
});
