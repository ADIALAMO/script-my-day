import { test } from 'node:test';
import assert from 'node:assert/strict';
const { parseLegacyCharacterKey, isOwnLegacyCharacterKey, isModeratedKey } = await import('../lib/object-scope.js');

test('legacy character key parser: shape only; ownership is an EXACT id comparison', () => {
  assert.deepEqual(parseLegacyCharacterKey('characters/u:abc-raw-1700000001.jpg'), { id: 'u:abc', kind: 'raw', stamp: '1700000001' });
  assert.deepEqual(parseLegacyCharacterKey('characters/u:abc-def-sheet-5.jpg'), { id: 'u:abc-def', kind: 'sheet', stamp: '5' });
  for (const bad of ['characters/u:abc-thumb-1.jpg', 'characters/u:abc-raw-1.png', 'characters/u:abc-raw-x.jpg', 'characters/a/b-raw-1.jpg', 'characters/../u:abc-raw-1.jpg', 'panels/u:abc-raw-1.jpg', '', null, undefined, 7, `characters/${'x'.repeat(400)}-raw-1.jpg`]) assert.equal(parseLegacyCharacterKey(bad), null, String(bad));
  const own = 'characters/u:abc-sheet-1700000001.jpg';
  assert.equal(isOwnLegacyCharacterKey(own, 'u:abc'), true);
  for (const id of ['u:ab', 'u:abcd', 'u:abc-', 'U:ABC', 'xu:abc', 'abc', '', null, undefined, 'u:abc-sheet-1700000001.jpg']) assert.equal(isOwnLegacyCharacterKey(own, id), false, String(id));
  assert.equal(isOwnLegacyCharacterKey('characters/u:abcd-sheet-1.jpg', 'u:abc'), false, 'no prefix match');
  assert.equal(isOwnLegacyCharacterKey('characters/u:abc-more-sheet-1.jpg', 'u:abc'), false, 'the embedded id is "u:abc-more"');
  assert.equal(isOwnLegacyCharacterKey('characters/xu:abc-raw-1.jpg', 'u:abc'), false, 'no suffix match');
  assert.equal(isModeratedKey(own), false, 'legacy keys stay OUT of the moderation / sweep scope');
});
