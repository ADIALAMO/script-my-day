import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PERSONAL_KEYS, clearPersonalLocalData, hasSavedHistory } from '../utils/sign-out-cleanup.js';

const mem = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), keys: () => [...m.keys()] }; };

test('sign-out removes history, creator name and character link but keeps device settings', () => {
  const s = mem({ lifescript_history: '[{"id":1}]', lifescript_producer_name: 'x', lifescript_character_url: 'u', lifescript_character_starring: '1', lifescript_character_gender: 'f',
    lifescript_cookie_v2: '{"analytics":true}', ls_tour_done_v1: '1', ls_variant_flags: '{}', lifescript_reported: '[]' });
  assert.equal(hasSavedHistory(s), true);
  clearPersonalLocalData(s);
  assert.deepEqual(s.keys().sort(), ['lifescript_cookie_v2', 'lifescript_reported', 'ls_tour_done_v1', 'ls_variant_flags']);
  assert.equal(hasSavedHistory(s), false);
});
test('never throws on broken or missing storage', () => {
  assert.doesNotThrow(() => clearPersonalLocalData({ removeItem() { throw new Error('blocked'); } }));
  assert.equal(hasSavedHistory({ getItem: () => '{bad' }), false);
  assert.ok(PERSONAL_KEYS.includes('lifescript_history'));
});
test('the Sign out button clears before signOut and asks first when history exists', () => {
  const nav = readFileSync(new URL('../components/Navbar.jsx', import.meta.url), 'utf8');
  assert.match(nav, /hasSavedHistory\(\) && !window\.confirm\(/);
  assert.ok(nav.indexOf('clearPersonalLocalData();') < nav.indexOf("signOut({ callbackUrl: '/' })"));
});
