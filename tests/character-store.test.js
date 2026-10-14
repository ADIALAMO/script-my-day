// "Star Yourself" client state: one definition of hasCharacter, starring ON after every confirmed upload, restore never beats a newer local change.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCharacterStore, LS_URL, LS_STARRING } from '../utils/character-store.js';

const memStorage = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), _m: m }; };
const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

/** a fake server: the Redis pointer + upload/remove behaviour; `holdGet` delays the GET answer to model a slow restore */
function fakeServer() {
  const s = { pointer: null, n: 0, failUpload: false, holdGet: null, calls: [] };
  s.fetch = async (url, opts = {}) => {
    const method = opts.method || 'GET'; s.calls.push(`${method} ${url}`);
    if (url === '/api/upload-character') {
      if (s.failUpload) return json(503, { success: false, code: 'CHARACTER_SHEET_FAILED' });
      s.pointer = `https://cdn.test/characters/o/${++s.n}-sheet.jpg`;
      return json(200, { success: true, characterImageUrl: s.pointer, sheetGenerated: true });
    }
    if (url === '/api/character' && method === 'DELETE') { s.pointer = null; return json(200, { success: true, status: 'removed', partial: false }); }
    if (url === '/api/character') { const answer = s.pointer; if (s.holdGet) await s.holdGet; return json(200, { success: true, characterImageUrl: answer }); }
    throw new Error(`unexpected ${url}`);
  };
  return s;
}
const boot = (storage, server) => createCharacterStore({ storage, fetchFn: server.fetch });

test('first upload → confirm → modal closed: the button is ON immediately and the face is sent to generation', async () => {
  const storage = memStorage(); const server = fakeServer(); const st = boot(storage, server);
  await st.restore();
  assert.equal(st.getState().hasCharacter, false); assert.equal(st.getState().activeCharacterUrl, null);
  const r = await st.upload('data:image/png;base64,AAAA', true, true);
  assert.equal(r.ok, true);
  const s = st.getState();
  assert.deepEqual([s.hasCharacter, s.starring, s.status], [true, true, 'ready']);
  assert.equal(s.activeCharacterUrl, server.pointer);
});

test('RELOAD: a new store over the same localStorage shows the character, enabled, before the network answers — and again after it', async () => {
  const storage = memStorage(); const server = fakeServer();
  await boot(storage, server).upload('x', true, true);
  const hold = new Promise(() => {});          // the server never answers (offline / slow)
  const offline = createCharacterStore({ storage, fetchFn: async () => { await hold; } });
  offline.restore();
  await Promise.resolve();
  assert.deepEqual([offline.getState().hasCharacter, offline.getState().starring], [true, true]);
  const again = boot(storage, server); await again.restore();
  assert.deepEqual([again.getState().hasCharacter, again.getState().starring, again.getState().activeCharacterUrl], [true, true, server.pointer]);
});

test('RELOAD on a cleared cache / new device: the server pointer restores the character, ON by default', async () => {
  const server = fakeServer(); await boot(memStorage(), server).upload('x', true, true);
  const fresh = boot(memStorage(), server); await fresh.restore();
  assert.deepEqual([fresh.getState().hasCharacter, fresh.getState().starring], [true, true]);
});

test('REGRESSION: starring was switched OFF earlier → remove → re-upload: the button is ON again (it used to stay off because the old "0" outlived the character)', async () => {
  const storage = memStorage(); const server = fakeServer(); const st = boot(storage, server);
  await st.upload('x', true, true);
  st.setStarring(false);
  assert.equal(st.getState().activeCharacterUrl, null);
  assert.equal(storage.getItem(LS_STARRING), '0');
  const rm = await st.remove();
  assert.equal(rm.ok, true);
  assert.deepEqual([st.getState().hasCharacter, st.getState().status, storage.getItem(LS_URL), storage.getItem(LS_STARRING)], [false, 'idle', null, null]);
  await st.upload('y', true, true);
  assert.deepEqual([st.getState().hasCharacter, st.getState().starring], [true, true]);
  assert.equal(storage.getItem(LS_STARRING), '1');
  const reload = boot(storage, server); await reload.restore();
  assert.deepEqual([reload.getState().hasCharacter, reload.getState().starring], [true, true], 'and it stays on after a reload');
});

test('re-upload over an existing character (starring was off): ON again, new URL, old one replaced', async () => {
  const storage = memStorage(); const server = fakeServer(); const st = boot(storage, server);
  await st.upload('x', true, true); const first = st.getState().url;
  st.setStarring(false);
  await st.upload('y', true, true);
  assert.notEqual(st.getState().url, first); assert.equal(st.getState().starring, true);
});

test('a FAILED re-upload leaves the existing character and its button exactly as they were (hasCharacter does not depend on the request outcome)', async () => {
  const storage = memStorage(); const server = fakeServer(); const st = boot(storage, server);
  await st.upload('x', true, true); const url = st.getState().url;
  server.failUpload = true;
  const seen = []; st.subscribe((s) => seen.push([s.hasCharacter, s.status]));
  const r = await st.upload('y', true, true);
  assert.equal(r.ok, false);
  const s = st.getState();
  assert.deepEqual([s.hasCharacter, s.url, s.starring, s.status, s.error], [true, url, true, 'ready', 'CHARACTER_SHEET_FAILED']);
  assert.ok(seen.every(([has]) => has), 'never reported "no character" while the request was running or after it failed');
  assert.equal(seen[0][1], 'loading');
});

test('a user\'s deliberate OFF survives a reload (restore never flips it)', async () => {
  const storage = memStorage(); const server = fakeServer(); const st = boot(storage, server);
  await st.upload('x', true, true); st.setStarring(false);
  const reload = boot(storage, server); await reload.restore();
  assert.deepEqual([reload.getState().hasCharacter, reload.getState().starring], [true, false]);
});

test('RACE: a slow restore answer that started BEFORE a remove does not bring the removed character back; one that started before an upload does not replace the new one', async () => {
  const storage = memStorage(); const server = fakeServer();
  await boot(storage, server).upload('x', true, true);
  let release; server.holdGet = new Promise((r) => { release = r; });
  const st = boot(storage, server);
  const restoring = st.restore();               // GET answers with the OLD pointer, but only later
  await Promise.resolve(); await Promise.resolve();
  await st.remove();
  release(); await restoring;
  assert.equal(st.getState().hasCharacter, false, 'removed stays removed');

  const server2 = fakeServer(); await boot(storage, server2).upload('a', true, true);
  const old = server2.pointer; let rel2; server2.holdGet = new Promise((r) => { rel2 = r; });
  const st2 = boot(memStorage(), server2);
  const restoring2 = st2.restore();
  await Promise.resolve(); await Promise.resolve();
  server2.holdGet = null;
  await st2.upload('b', true, true); const fresh = st2.getState().url;
  rel2(); await restoring2;
  assert.notEqual(fresh, old); assert.equal(st2.getState().url, fresh, 'the newer upload wins');
});

test('blocked / missing storage: everything still works in memory; no storage at all is fine', async () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() { throw new Error('denied'); } };
  for (const storage of [broken, null]) {
    const server = fakeServer(); const st = boot(storage, server);
    await st.restore(); await st.upload('x', true, true);
    assert.deepEqual([st.getState().hasCharacter, st.getState().starring], [true, true]);
    await st.remove(); assert.equal(st.getState().hasCharacter, false);
  }
});

test('removal that fails on the server keeps the character (nothing is forgotten locally)', async () => {
  const storage = memStorage(); const server = fakeServer(); const st = boot(storage, server);
  await st.upload('x', true, true);
  const st2 = createCharacterStore({ storage, fetchFn: async () => json(500, { success: false, code: 'SERVER_ERROR' }) });
  await st2.restore();
  const r = await st2.remove();
  assert.equal(r.ok, false); assert.equal(st2.getState().hasCharacter, true); assert.equal(storage.getItem(LS_STARRING), '1');
});

// ── 18+ confirmation (asked once per ACCOUNT; the server is the authority) ───────────────────────────────────────────────────
test('adult confirmation: unknown until the server says; restore reads it; confirmAdult flips it; it is never cached on the device', async () => {
  const storage = memStorage(); let confirmed = false; const calls = [];
  const fetchFn = async (url, opts = {}) => {
    calls.push(`${opts.method || 'GET'} ${url}`);
    if (url === '/api/adult-confirmation') { confirmed = true; return json(200, { success: true, adultConfirmed: true }); }
    return json(200, { success: true, characterImageUrl: 'https://cdn.test/characters/o/1-sheet.jpg', adultConfirmed: confirmed });
  };
  const st = createCharacterStore({ storage, fetchFn });
  assert.equal(st.getState().adultConfirmed, null);
  await st.restore();
  assert.equal(st.getState().adultConfirmed, false, 'an existing user with a character but no record is asked');
  assert.equal(st.getState().hasCharacter, true, '…and keeps the character');
  assert.deepEqual(await st.confirmAdult(), { ok: true });
  assert.equal(st.getState().adultConfirmed, true);
  assert.ok(![...storage._m.keys()].some((k) => /adult/i.test(k)), 'nothing about it in localStorage');
  const again = createCharacterStore({ storage, fetchFn });   // a new page load: asked of the server again, not remembered locally
  assert.equal(again.getState().adultConfirmed, null);
  await again.restore(); assert.equal(again.getState().adultConfirmed, true);
  assert.equal(calls.filter((c) => c.includes('adult-confirmation')).length, 1, 'the declaration is sent once');
});

test('adult confirmation: a stale restore answer never downgrades a confirmation made in the meantime; failures are reported, not hidden', async () => {
  let release; const hold = new Promise((r) => { release = r; });
  const fetchFn = async (url) => {
    if (url === '/api/adult-confirmation') return json(200, { success: true });
    await hold; return json(200, { success: true, characterImageUrl: null, adultConfirmed: false });   // answer computed BEFORE the confirmation
  };
  const st = createCharacterStore({ storage: memStorage(), fetchFn });
  const pending = st.restore();
  await st.confirmAdult(); release(); await pending;
  assert.equal(st.getState().adultConfirmed, true);
  const anon = createCharacterStore({ storage: memStorage(), fetchFn: async () => json(401, { success: false, code: 'NEEDS_ACCOUNT' }) });
  assert.deepEqual(await anon.confirmAdult(), { ok: false, code: 'NEEDS_ACCOUNT' });
  assert.equal(anon.getState().adultConfirmed, null);
  const off = createCharacterStore({ storage: memStorage(), fetchFn: async () => { throw new Error('offline'); } });
  assert.deepEqual(await off.confirmAdult(), { ok: false, code: 'NETWORK_OFFLINE' });
});

test('adult confirmation: the server refusing an upload (403 ADULT_CONFIRMATION_REQUIRED) flips the state back to "ask", is not mistaken for NEEDS_PRO, and keeps the existing character', async () => {
  const fetchFn = async (url) => (url === '/api/upload-character'
    ? json(403, { success: false, code: 'ADULT_CONFIRMATION_REQUIRED' })
    : json(200, { success: true, characterImageUrl: 'https://cdn.test/characters/o/1-sheet.jpg', adultConfirmed: true }));
  const st = createCharacterStore({ storage: memStorage(), fetchFn });
  await st.restore(); assert.equal(st.getState().adultConfirmed, true);
  const r = await st.upload('data:image/png;base64,AAAA', true);
  assert.deepEqual(r, { ok: false, code: 'ADULT_CONFIRMATION_REQUIRED' });
  const s = st.getState();
  assert.equal(s.adultConfirmed, false); assert.equal(s.status, 'ready'); assert.equal(s.hasCharacter, true); assert.equal(s.error, '');
});
