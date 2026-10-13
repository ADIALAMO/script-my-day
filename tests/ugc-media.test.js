import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.OBJECT_KEY_SECRET = 'unit-test-secret';
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';
globalThis._redisClient = {};   // lib modules that import redis get a stub, nothing is contacted
const { isModeratedKey, isCharacterKey, characterOwnerSegment } = await import('../lib/object-scope.js');
const { isSweepableKey } = await import('../lib/report-sweep.js');
const { cleanProducerName, displayProducerName } = await import('../utils/producer-name.js');
const { summariseLeftoverRaws, formatLeftoverReport } = await import('../lib/leftover-raw.js');
const { run: listRun } = await import('../scripts/list-leftover-raw-selfies.mjs');
const { keyFromArg } = await import('../scripts/takedown-object.mjs');
const { sniffImage, buildCharacterKeys } = await import('../lib/upload-image.js');
const { quarantineObject } = await import('../lib/quarantine.js');

const SEG = 'b'.repeat(32); const UUID = '11111111-1111-1111-1111-111111111111';

test('object scope: panels/, posters/ and CURRENT-format characters/ keys only — legacy character keys, traversal, other prefixes and junk are out', () => {
  for (const k of ['panels/a/b.png', 'posters/x.jpg', `characters/${SEG}/${UUID}-sheet.jpg`, `characters/${SEG}/${UUID}-raw.png`, `characters/${SEG}/${UUID}-raw.webp`]) {
    assert.equal(isModeratedKey(k), true, k); assert.equal(isSweepableKey(k), true, k);
  }
  for (const k of ['characters/u:12-sheet-170.jpg', 'characters/old-raw-1700000000000.jpg', `characters/${SEG}/${UUID}-sheet.svg`, `characters/${SEG}/${UUID}-thumb.jpg`, 'characters/x/y.jpg',
    `characters/${SEG}/../x.jpg`, 'panels/../characters/x.jpg', 'quarantine/panels/a.png', '', null, undefined, 42, `panels/${'x'.repeat(400)}`]) {
    assert.equal(isModeratedKey(k), false, String(k)); assert.equal(isSweepableKey(k), false, String(k));
  }
  assert.equal(isCharacterKey(`characters/${SEG}/${UUID}-raw.jpg`), true); assert.equal(isCharacterKey(`panels/${SEG}/${UUID}.png`), false);
  assert.equal(characterOwnerSegment(`characters/${SEG}/${UUID}-sheet.jpg`), SEG); assert.equal(characterOwnerSegment('panels/a/b.png'), null);
});

test('quarantineObject: the key guard refuses everything outside the moderated scope without touching storage', async () => {
  for (const bad of ['characters/x/y.jpg', 'characters/u:1-raw-170.jpg', 'avatars/u.png', `characters/${SEG}/../a.jpg`]) {
    const g = await quarantineObject(bad);
    assert.deepEqual([g.status, g.stage, g.cls], ['failed', 'key-guard', 'OutOfScope'], bad);
  }
});

test('takedown-object accepts a current-format characters/ key (by URL or key) and still refuses legacy/odd ones', () => {
  const k = `characters/${SEG}/${UUID}-raw.jpg`;
  assert.equal(keyFromArg(k, 'https://pub.example'), k);
  assert.equal(keyFromArg(`https://pub.example/${k}`, 'https://pub.example'), k);
  for (const bad of ['characters/x/y-raw.jpg', 'characters/u:1-raw-170.jpg', `characters/${SEG}/${UUID}-raw.exe`]) assert.equal(keyFromArg(bad, 'https://pub.example'), null, bad);
});

test('selfie type by bytes: JPEG / PNG / WebP only (SVG, GIF, BMP, HTML, tiny payloads are refused)', () => {
  const pad = Buffer.alloc(20);
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad]))?.ext, 'jpg');
  assert.equal(sniffImage(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad]))?.ext, 'png');
  assert.equal(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad]))?.ext, 'webp');
  for (const bad of ['<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', 'GIF89a' + '\0'.repeat(30), 'BM' + '\0'.repeat(30), '<html></html>', 'x']) assert.equal(sniffImage(Buffer.from(bad)), null, bad.slice(0, 12));
});

test('character keys carry the extension of the photo\'s own bytes; the sheet is always .jpg', () => {
  assert.match(buildCharacterKeys('u:a').raw, new RegExp(`^characters/[0-9a-f]{32}/[0-9a-f-]{36}-raw\\.jpg$`));
  assert.match(buildCharacterKeys('u:a', 'png').raw, /-raw\.png$/);
  assert.match(buildCharacterKeys('u:a', 'webp').sheet, /-sheet\.jpg$/);
  for (const k of Object.values(buildCharacterKeys('u:a', 'png'))) assert.equal(isCharacterKey(k), true);
});

test('creator credit: blocked / markup / control characters never reach the poster; a clean name passes; the default is used otherwise', () => {
  assert.deepEqual(cleanProducerName('Dana Levi'), { name: 'Dana Levi', blocked: false });
  assert.deepEqual(cleanProducerName('  <b>Dan</b>\n\t  Levi '), { name: 'bDan/b Levi', blocked: false });
  assert.deepEqual(cleanProducerName(''), { name: '', blocked: false });
  assert.deepEqual(cleanProducerName(undefined), { name: '', blocked: false });
  assert.equal(cleanProducerName('x'.repeat(80)).name.length, 22);
  for (const bad of ['porn star', 'nude model', 'loli', 'p0rn']) { const r = cleanProducerName(bad); assert.deepEqual(r, { name: '', blocked: true }, bad); }
  assert.equal(displayProducerName('porn star', 'he'), 'אורח'); assert.equal(displayProducerName('porn star', 'en'), 'Guest'); assert.equal(displayProducerName('', 'en', 'GUEST'), 'GUEST');
  assert.equal(displayProducerName('Noa', 'he'), 'Noa');
});

const DAY = 86_400_000; const NOW = Date.UTC(2026, 9, 20);
const OBJ = [
  { key: `characters/${SEG}/${UUID}-raw.jpg`, size: 100_000, lastModified: new Date(NOW - 0.5 * DAY) },                         // new raw, has a sheet
  { key: `characters/${SEG}/${UUID}-sheet.jpg`, size: 50_000, lastModified: new Date(NOW - 0.5 * DAY) },
  { key: `characters/${SEG}/22222222-2222-2222-2222-222222222222-raw.png`, size: 300_000, lastModified: new Date(NOW - 10 * DAY) },  // new raw, no sheet
  { key: 'characters/u:abc123-raw-1700000000000.jpg', size: 200_000, lastModified: new Date(NOW - 100 * DAY) },                // legacy raw, has a sheet
  { key: 'characters/u:abc123-sheet-1700000000000.jpg', size: 80_000, lastModified: new Date(NOW - 100 * DAY) },
  { key: 'characters/u:zzz999-raw-1700000000001.jpg', size: 400_000, lastModified: new Date(NOW - 45 * DAY) },                 // legacy raw, no sheet
  { key: 'characters/weird.txt', size: 1 },
];

test('leftover raw summary: counts, sizes, sheet pairing and age buckets — and not one key, owner, id or stamp in the text', () => {
  const s = summariseLeftoverRaws(OBJ, NOW);
  assert.equal(s.total, 7); assert.equal(s.other, 3);   // 2 sheets + 1 odd file are "not raw selfies"
  assert.deepEqual([s.newRaw.count, s.newRaw.withSheet, s.newRaw.withoutSheet, s.newRaw.bytes], [2, 1, 1, 400_000]);
  assert.deepEqual([s.legacyRaw.count, s.legacyRaw.withSheet, s.legacyRaw.withoutSheet, s.legacyRaw.bytes], [2, 1, 1, 600_000]);
  assert.deepEqual(s.newRaw.ageBuckets.map((b) => b.count), [1, 0, 1, 0, 0]);
  assert.deepEqual(s.legacyRaw.ageBuckets.map((b) => b.count), [0, 0, 0, 1, 1]);
  assert.equal(Math.floor(s.legacyRaw.oldestDays), 100);
  const text = formatLeftoverReport(s);
  for (const secret of [SEG, UUID, 'abc123', 'zzz999', '1700000000000', 'weird', '-raw', '-sheet', 'https://']) assert.ok(!text.includes(secret), `report leaks ${secret}`);
  assert.match(text, /READ-ONLY/);
});

test('list-leftover-raw-selfies is read-only: it lists the characters/ prefix once and offers nothing else', async () => {
  const calls = []; const out = [];
  const r2 = { async list(prefix) { calls.push(prefix); return OBJ; }, async del() { throw new Error('must never be called'); }, async put() { throw new Error('must never be called'); } };
  const { code } = await listRun({ r2, log: (s) => out.push(s), now: () => NOW });
  assert.equal(code, 0); assert.deepEqual(calls, ['characters/']);
  const text = out.join('\n');
  assert.ok(!text.includes(SEG) && !text.includes('abc123'));
  const src = (await import('node:fs')).readFileSync(new URL('../scripts/list-leftover-raw-selfies.mjs', import.meta.url), 'utf8');
  assert.ok(!/DeleteObject|PutObject|CopyObject|GetObject|HeadObject/.test(src), 'the script only imports ListObjectsV2Command');
  assert.ok(!/redis/i.test(src.replace(/never touches Redis/, '')), 'no Redis access');
});

test('list-leftover-raw-selfies failures: stage + allowlisted reason only, never the error message, key, bucket or account id', async () => {
  const { missingEnv, describeFailure, StageError, ENV_NAMES, run } = await import('../scripts/list-leftover-raw-selfies.mjs');
  assert.deepEqual(missingEnv({}), ENV_NAMES); assert.deepEqual(missingEnv({ CLOUDFLARE_ACCOUNT_ID: 'a', R2_BUCKET_NAME: ' ', R2_ACCESS_KEY_ID: 'k', R2_SECRET_ACCESS_KEY: 's' }), ['R2_BUCKET_NAME']);
  assert.equal(describeFailure(new StageError('config', 'missing env R2_BUCKET_NAME')), 'stage=config reason=missing env R2_BUCKET_NAME');
  const hostile = Object.assign(new Error('The specified bucket my-secret-bucket does not exist; key characters/abc; https://acct123.r2.cloudflarestorage.com'), { name: 'NoSuchBucket', $metadata: { httpStatusCode: 404 } });
  const line = describeFailure(hostile);
  assert.match(line, /^stage=list reason=bucket not found/); assert.match(line, /class=NoSuchBucket http=404/);
  for (const leak of ['my-secret-bucket', 'characters/abc', 'acct123', 'https://']) assert.ok(!line.includes(leak), leak);
  assert.match(describeFailure(Object.assign(new Error('x'), { name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })), /access denied.*Object Read only/);
  assert.match(describeFailure(new Error('whatever my-secret')), /reason=unexpected error class=Error$/);
  await assert.rejects(run({ r2: { list: async () => { throw hostile; } }, log() {} }), (e) => e instanceof StageError && e.stage === 'list' && !e.message.includes('my-secret-bucket'));
});
