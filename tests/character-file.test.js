import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPickedFile } from '../utils/image-file.js';
import { characterFileMessage, CHARACTER_FILE_COPY } from '../constants/character-file-copy.js';
import { outcomeFor, characterKey, SERVER_OUTCOMES, CLIENT_EVENTS, ALL_COUNTERS, RETENTION_DAYS, readCharacterOutcomes } from '../lib/character-stats.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

test('classifyPickedFile: HEIC / HEIF by MIME type OR by extension (case-insensitive, last extension only); non-images; everything else is ok', () => {
  for (const f of [
    { type: 'image/heic', name: 'a.jpg' }, { type: 'image/heif', name: '' }, { type: 'IMAGE/HEIC', name: 'x' }, { type: 'image/heic-sequence', name: 'x' }, { type: 'image/heif-sequence', name: 'x' },
    { type: '', name: 'IMG_0001.HEIC' }, { type: '', name: 'photo.heif' }, { type: 'application/octet-stream', name: 'p.hif' }, { type: 'image/jpeg', name: 'renamed.heic' },
  ]) assert.equal(classifyPickedFile(f), 'heic', JSON.stringify(f));
  for (const f of [{ type: 'image/jpeg', name: 'photo.heic.jpg' }, { type: 'image/png', name: 'heic.png' }, { type: 'image/webp', name: 'a.webp' }, { type: 'image/jpeg', name: 'IMG_0001.JPG' }, { type: 'image/avif', name: 'a.avif' }, { type: 'image/tiff', name: 'a.tif' }]) assert.equal(classifyPickedFile(f), 'ok', JSON.stringify(f));
  for (const f of [{ type: 'application/pdf', name: 'a.pdf' }, { type: 'text/plain', name: 'a.txt' }, { type: '', name: 'noextension' }, {}, null, undefined]) assert.equal(classifyPickedFile(f), 'not_image', JSON.stringify(f));
});

test('messages: he + en for every case, Hebrew in masculine singular, tells the user what to do, no price / plan / upgrade wording', () => {
  const FORBIDDEN = /Stripe|\$\s?9\b|upgrade|שדרג|שדרוג|subscription|מנוי|\bPro\b|פרו\b|billing|חיוב|checkout|per month|לחודש\b|waitlist/i;
  for (const [kind, native] of [['heic', false], ['heic', true], ['decode_failed', false]]) {
    const en = characterFileMessage(kind, false, native); const he = characterFileMessage(kind, true, native);
    assert.ok(en.length > 30 && he.length > 30 && en !== he, `${kind}/${native}`);
    assert.doesNotMatch(en + he, FORBIDDEN);
    assert.match(en, /JPG or PNG/); assert.match(he, /JPG/); assert.match(he, /PNG/);
    assert.doesNotMatch(he, /נסו|בחרו|ייצאו|פתחו|המירו/, 'plural imperatives are not used');   // masculine SINGULAR, like lib/messages.js
  }
  assert.match(characterFileMessage('heic', true), /ייצא/); assert.match(characterFileMessage('heic', true), /פתח/); assert.match(characterFileMessage('heic', true), /בחר/);
  assert.match(characterFileMessage('decode_failed', true), /נסה/);
  assert.match(characterFileMessage('heic', false, false), /Safari/); assert.match(characterFileMessage('heic', true, false), /Safari/);
  assert.doesNotMatch(characterFileMessage('heic', false, true) + characterFileMessage('heic', true, true), /Safari/, 'the Android app variant has no Safari clause');
  assert.deepEqual(Object.keys(CHARACTER_FILE_COPY).sort(), ['decode_failed', 'heic', 'heicNative']);
});

test('CharacterModal.handleFile: classifies first, still TRIES the decode (Safari opens HEIC), shows the HEIC message / counts heic_detected only when the decode fails; accept stays image/*', () => {
  const src = read('components/CharacterModal.jsx');
  assert.match(src, /accept="image\/\*"/);
  assert.doesNotMatch(src, /Could not read that image|לא ניתן לקרוא את התמונה/);
  const handle = src.slice(src.indexOf('const handleFile'), src.indexOf('const handleCreate'));
  const iClassify = handle.indexOf('classifyPickedFile(file)'); const iDecode = handle.indexOf('await fileToDownscaledDataUri(file)'); const iCatch = handle.indexOf('} catch');
  assert.ok(iClassify > 0 && iClassify < iDecode && iDecode < iCatch, 'classify, then decode, then the catch');
  const afterCatch = handle.slice(iCatch);
  assert.match(afterCatch, /kind === 'heic'/); assert.match(afterCatch, /sendCharacterEvent\('heic_detected'\)/); assert.match(afterCatch, /sendCharacterEvent\('decode_failed'\)/);
  assert.match(afterCatch, /characterFileMessage\('heic', isHebrew, isNativeShell\(\)\)/); assert.match(afterCatch, /characterFileMessage\('decode_failed', isHebrew\)/);
  assert.doesNotMatch(handle.slice(0, iCatch), /sendCharacterEvent/, 'nothing is counted before the decode has actually failed');
  const evt = read('utils/character-event.js');
  assert.match(evt, /new Set\(\['decode_failed', 'heic_detected'\]\)/); assert.match(evt, /JSON\.stringify\(\{ event \}\)/);   // the body is the fixed word only
});

test('outcomeFor: every response of upload-character maps to exactly one outcome', () => {
  const T = [
    [200, undefined, true, 'succeeded'],
    [422, 'SAFETY_REJECTED', false, 'unsafe'], [422, 'CONTENT_REFUSED', false, 'unsafe'], [422, 'MINOR_REJECTED', false, 'minor_rejected'],
    [503, 'CONTENT_CHECK_UNAVAILABLE', false, 'unavailable'], [503, 'PHOTO_CHECK_UNAVAILABLE', false, 'unavailable'], [503, 'SERVICE_UNAVAILABLE', false, 'unavailable'],
    [503, 'CHARACTER_SHEET_FAILED', false, 'sheet_failed'], [400, 'IMAGE_UNSUPPORTED', false, 'unsupported_format'],
    [400, 'CONSENT_REQUIRED', false, 'blocked'], [403, 'NEEDS_PRO', false, 'blocked'], [403, 'ADULT_CONFIRMATION_REQUIRED', false, 'blocked'], [429, 'QUOTA_SHEET', false, 'blocked'],
    [429, 'IDENTITY_LIFETIME_USED', false, 'blocked'], [429, 'RATE_LIMITED', false, 'blocked'], [503, 'IDENTITY_BUDGET_REACHED', false, 'blocked'], [400, 'INPUT_TOO_SHORT', false, 'blocked'],
    [503, 'SERVER_ERROR', false, 'error'], [500, 'SERVER_ERROR', false, 'error'], [500, undefined, false, 'error'], [undefined, null, false, 'error'],
    [200, undefined, false, 'blocked'],   // a 200 that is not a success body is never counted as success
  ];
  for (const [status, code, success, want] of T) assert.equal(outcomeFor(status, code, success), want, `${status} ${code}`);
  for (const k of ['__proto__', 'constructor', 'toString']) assert.equal(outcomeFor(422, k, false), 'blocked', k);   // no prototype tricks
});

test('counter names and keys: started + 8 server outcomes + 2 client events; 60-day retention; one read of the last 7 days', async () => {
  assert.deepEqual(SERVER_OUTCOMES, ['succeeded', 'unsafe', 'unavailable', 'minor_rejected', 'sheet_failed', 'unsupported_format', 'blocked', 'error']);
  assert.deepEqual(CLIENT_EVENTS, ['decode_failed', 'heic_detected']); assert.equal(ALL_COUNTERS.length, 11); assert.equal(RETENTION_DAYS, 60);
  assert.equal(characterKey('succeeded', '2026-10-28'), 'stats:character:2026-10-28:succeeded');
  let asked = null;
  const client = { mget: async (...keys) => { asked = keys; return keys.map((k) => (k === 'stats:character:2026-10-28:started' ? '3' : k === 'stats:character:2026-10-28:succeeded' ? '2' : null)); } };
  const rows = await readCharacterOutcomes(7, client, new Date('2026-10-28T12:00:00Z'));
  assert.equal(asked.length, 7 * 11); assert.deepEqual(rows, [{ day: '2026-10-28', counts: { started: 3, succeeded: 2, unsafe: 0, unavailable: 0, minor_rejected: 0, sheet_failed: 0, unsupported_format: 0, blocked: 0, error: 0, decode_failed: 0, heic_detected: 0 } }]);
  assert.deepEqual(await readCharacterOutcomes(7, { mget: async () => { throw new Error('down'); } }), [], 'fail-open');
});

test('logs carry no account id / e-mail: no console.* in the character routes, identity, character-store, adult-confirmation or the Stripe webhook interpolates one', () => {
  const FILES = ['pages/api/upload-character.js', 'pages/api/character.js', 'pages/api/character-event.js', 'pages/api/adult-confirmation.js', 'lib/identity.js', 'lib/character-store.js', 'lib/sheet-quota.js', 'lib/character-stats.js', 'lib/report.js', 'pages/api/stripe/webhook.js'];
  // ids of accounts and of Stripe objects, and raw object keys (legacy character keys embed the account id)
  const BAD = /\$\{[^}]*\b(identifier|userId|ctx\.|session\.|subscription\.|subscriptionId|invoice\.id|event\.id|email|customer)[^}]*\}|\$\{key\}|,\s*(session|subscription)\.id\b|,\s*(identifier|userId)\b/;
  for (const f of FILES) {
    for (const [i, line] of read(f).split('\n').entries()) {
      const at = line.search(/console\.(log|warn|error|info)\(/);
      if (at >= 0 && BAD.test(line.slice(at))) assert.fail(`${f}:${i + 1} logs an id: ${line.trim().slice(0, 140)}`);   // only the console call itself (a line may also hold an unrelated redis key)
    }
  }
  assert.match(read('pages/api/upload-character.js'), /console\.log\('🎭 Character ready'\)/);
});

test('lib/image-check.js header no longer calls the primary ":free" / $0', () => {
  const head = read('lib/image-check.js').slice(0, 1400);
  assert.doesNotMatch(head, /\(`:free`, \$0\)/);
  assert.match(head, /PAID nvidia\/nemotron-3\.5-content-safety on DeepInfra/);
});
