import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';
process.env.OBJECT_KEY_SECRET = 'unit-test-secret';
const { isReportableKey, isValidHash, parseRef, keyOwnerSegment, isOwnerOfKey, REPORT_KINDS, REPORT_REASONS, MAX_REFS } = await import('../lib/report.js');
const { ownerSegment, reporterSegment, buildObjectKey } = await import('../lib/upload-image.js');
const { REPORT_COPY, reportText } = await import('../constants/report-copy.js');
const { cleanProviderTag } = await import('../lib/image-check.js');
const { isReported, markReported } = await import('../utils/reported-store.js');

const SEG = 'a'.repeat(32); const UUID = '11111111-1111-1111-1111-111111111111';

test('isReportableKey: generated panels/posters and CURRENT-format characters/ keys only — never legacy character keys, traversal, other extensions or oversized keys', () => {
  for (const ok of [`panels/${SEG}/${UUID}.png`, `posters/${SEG}/${UUID}.jpg`, `panels/${SEG}/${UUID}.webp`, 'panels/1699999999999_abc123_00.png', `characters/${SEG}/${UUID}-sheet.jpg`, `characters/${SEG}/${UUID}-raw.png`, `characters/${SEG}/${UUID}-raw.webp`]) assert.equal(isReportableKey(ok), true, ok);
  for (const bad of [`characters/u:123-sheet-1700.jpg`, 'characters/user_old-raw-1700000000000.jpg', `characters/${SEG}/${UUID}-sheet.svg`, `characters/${SEG}/${UUID}-other.jpg`, `characters/short/${UUID}-sheet.jpg`, `characters/../panels/${SEG}/${UUID}.png`, `panels/../characters/x.png`, `panels/${SEG}/${UUID}.svg`, `panels/${SEG}/${UUID}.png/extra`, 'panels/', '', null, undefined, 42, `panels/${'x'.repeat(300)}.png`, `quarantine/${SEG}/${UUID}.png`]) assert.equal(isReportableKey(bad), false, String(bad));
});

test('parseRef: only our own R2 origin; strips query strings; rejects foreign hosts, traversal, encoded traversal, credentials', () => {
  const B = 'https://pub-test.r2.dev';
  assert.deepEqual(parseRef({ url: `${B}/panels/${SEG}/${UUID}.png?cache=1` }), { kind: 'key', key: `panels/${SEG}/${UUID}.png` });
  for (const bad of [`https://evil.example/panels/${SEG}/${UUID}.png`, `${B}.evil.example/panels/${SEG}/${UUID}.png`, `${B}/panels/%2e%2e/x.png`, `${B}/panels/../x.png`, `https://user:pw@pub-test.r2.dev/panels/${SEG}/${UUID}.png`, `${B}/characters/u:12-sheet-1700.jpg`, 'javascript:alert(1)', 'data:image/png;base64,AAAA']) {
    assert.equal(parseRef({ url: bad }), null, bad);
  }
  assert.deepEqual(parseRef({ hash: 'ab'.repeat(32) }), { kind: 'hash', hash: 'ab'.repeat(32) });
  assert.deepEqual(parseRef({ url: `${B}/characters/${SEG}/${UUID}-sheet.jpg` }), { kind: 'key', key: `characters/${SEG}/${UUID}-sheet.jpg` });
  for (const bad of [{ hash: 'AB'.repeat(32) }, { hash: 'ab'.repeat(31) }, { hash: 123 }, {}, null, 'x', { url: 5 }]) assert.equal(parseRef(bad), null);
});

test('owner detection uses the HMAC owner segment inside the key — and legacy keys have no owner', () => {
  const key = buildObjectKey('panels', 'u:alice', 'png');
  assert.equal(keyOwnerSegment(key), ownerSegment('u:alice'));
  assert.equal(isOwnerOfKey('u:alice', key), true);
  assert.equal(isOwnerOfKey('u:bob', key), false);
  assert.equal(isOwnerOfKey('u:alice', 'panels/1699999999999_abc123_00.png'), false);
});

test('reporterSegment: one-way HMAC, deterministic, 32 hex, never contains the id/IP, unrelated to the owner segment', () => {
  const a = reporterSegment('203.0.113.9'); const b = reporterSegment('203.0.113.9');
  assert.equal(a, b); assert.match(a, /^[0-9a-f]{32}$/);
  assert.ok(!a.includes('203')); assert.notEqual(reporterSegment('u:x'), reporterSegment('u:y'));
  assert.notEqual(reporterSegment('u:x'), ownerSegment('u:x'));
});

test('limits and enums', () => {
  assert.deepEqual(REPORT_KINDS, ['poster', 'panel', 'reel', 'character']); assert.deepEqual(REPORT_REASONS, ['sexual', 'violent', 'other']); assert.equal(MAX_REFS, 8);
  assert.equal(isValidHash('0'.repeat(64)), true); assert.equal(isValidHash('0'.repeat(63)), false);
});

test('every report string exists in he AND en (non-empty); Hebrew entries contain Hebrew', () => {
  const walk = (o, path = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !('en' in v && 'he' in v) ? walk(v, `${path}.${k}`) : [[`${path}.${k}`, v]]));
  const leaves = walk(REPORT_COPY);
  assert.ok(leaves.length >= 18, `${leaves.length} entries`);
  for (const [name, v] of leaves) {
    assert.ok(typeof v?.en === 'string' && v.en.trim().length > 1, `${name} en`);
    assert.ok(typeof v?.he === 'string' && /[א-ת]/.test(v.he), `${name} he`);
  }
  assert.equal(reportText(REPORT_COPY.button, 'he'), 'דווח'); assert.equal(reportText(REPORT_COPY.button, 'xx'), 'Report');
});

test('cleanProviderTag keeps a short plain token only', () => {
  assert.equal(cleanProviderTag('Cloudflare-Flux'), 'Cloudflare-Flux');
  assert.equal(cleanProviderTag('evil\nHeader: x; <script>'), 'evilHeaderxscript');
  assert.equal(cleanProviderTag('x'.repeat(100)).length, 40);
  assert.equal(cleanProviderTag(''), null); assert.equal(cleanProviderTag(null), null);
});

test('reported-store: URLs and data URIs are remembered in memory; storage errors never throw', () => {
  assert.equal(isReported('https://pub-test.r2.dev/panels/x.png'), false);
  markReported(['https://pub-test.r2.dev/panels/x.png', 'data:image/png;base64,AAAA', 42, '']);
  assert.equal(isReported('https://pub-test.r2.dev/panels/x.png'), true);
  assert.equal(isReported('data:image/png;base64,AAAA'), true);
  assert.equal(isReported(null), false); assert.equal(isReported(undefined), false);
});

test('privacy text says what a report stores — in both languages — and promises nothing the code does not do', async () => {
  const { privacyUsageHe, privacyUsageEn } = await import('../constants/limits-copy.js');
  const en = privacyUsageEn(); const he = privacyUsageHe();
  assert.match(en, /report a generated image/); assert.match(en, /pseudonymous/); assert.match(en, /up to 90 days/); assert.match(en, /never stores the image itself/);
  assert.match(he, /תדווח על תמונה שנוצרה/); assert.match(he, /פסאודונימי/); assert.match(he, /90 יום/); assert.match(he, /לא שומרים את התמונה עצמה/);
  const reportPart = en.slice(en.indexOf('If you report'));
  assert.doesNotMatch(reportPart, /30 days|permanently deleted|\banonymous\b/i, 'no unverifiable retention claim, and the id is pseudonymous (not anonymous)');
});
