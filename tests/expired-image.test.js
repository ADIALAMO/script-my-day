// Expired stored images (posters/ and panels/ are deleted by the R2 lifecycle rules): ONLY a proxy 404 means "expired".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isImageExpired, isStoredObjectUrl, expiryView, EXPIRY_CHECK_TIMEOUT_MS } from '../utils/expired-image.js';
import { EXPIRED_COPY, expiredText } from '../constants/expired-copy.js';

const URL1 = 'https://pub-x.r2.dev/panels/abc/1.png';
const answer = (status, extra = {}) => async (u, opts) => ({ status, ok: status >= 200 && status < 300, body: { cancel() { extra.cancelled = true; } }, _u: u, _o: opts });

test('404 from the proxy = expired; the proxy (not R2 directly) is asked, with the encoded URL', async () => {
  let seen; const f = async (u, o) => { seen = { u, o }; return { status: 404, body: null }; };
  assert.equal(await isImageExpired(URL1, { fetchFn: f }), true);
  assert.equal(seen.u, `/api/proxy-image?url=${encodeURIComponent(URL1)}`);
  assert.ok(seen.o?.signal, 'a timeout signal is attached');
});

test('anything that is not a 404 is NEVER "expired": 200, 3xx, 403, 410 (reported), 429, 500, 502, 503, 504', async () => {
  for (const st of [200, 204, 301, 302, 400, 401, 403, 408, 410, 413, 415, 429, 500, 502, 503, 504]) {
    assert.equal(await isImageExpired(URL1, { fetchFn: answer(st) }), false, `status ${st}`);
  }
});

test('offline, a thrown error, an abort and a timeout are NOT "expired"', async () => {
  assert.equal(await isImageExpired(URL1, { fetchFn: async () => { throw new TypeError('Failed to fetch'); } }), false);
  assert.equal(await isImageExpired(URL1, { fetchFn: async (u, o) => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } }), false);
  const hang = (u, o) => new Promise((_, rej) => o.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const t0 = Date.now();
  assert.equal(await isImageExpired(URL1, { fetchFn: hang, timeoutMs: 30 }), false);
  assert.ok(Date.now() - t0 < 1000, 'the check is bounded by its timeout');
  assert.ok(EXPIRY_CHECK_TIMEOUT_MS <= 10_000);
});

test('only stored objects are asked about: data:, blob:, relative and empty URLs never expire and cause no request', async () => {
  let calls = 0; const f = async () => { calls++; return { status: 404 }; };
  for (const u of ['data:image/png;base64,AAAA', 'blob:https://x/1', '/icon.png', '', null, undefined, 42]) {
    assert.equal(await isImageExpired(u, { fetchFn: f }), false, String(u));
    assert.equal(isStoredObjectUrl(u), false);
  }
  assert.equal(calls, 0); assert.equal(isStoredObjectUrl(URL1), true);
});

test('the response body is cancelled (only the status matters) and a missing fetch is "not expired"', async () => {
  const x = {}; await isImageExpired(URL1, { fetchFn: answer(200, x) }); assert.equal(x.cancelled, true);
  const saved = globalThis.fetch; delete globalThis.fetch;
  try { assert.equal(await isImageExpired(URL1), false); } finally { globalThis.fetch = saved; }
});

test('view per check state: nothing shows the message or a "lost" tile while the answer is pending; "other" returns to today\'s behaviour', () => {
  assert.equal(expiryView('idle'), 'image');       // a normal image, still loading or loaded: no message
  assert.equal(expiryView('checking'), 'blank');   // empty dark tile, no text
  assert.equal(expiryView('expired'), 'expired');
  assert.equal(expiryView('other'), 'image');
  assert.equal(expiryView(undefined), 'image');
});

test('copy: he + en, the agreed wording, no numbers (retention periods live in config), no pricing words', () => {
  assert.equal(EXPIRED_COPY.message.en, 'This image was deleted automatically after the storage period. Your script is still here — create a new poster or comic.');
  assert.match(EXPIRED_COPY.message.he, /נמחקה אוטומטית בתום תקופת האחסון/); assert.match(EXPIRED_COPY.message.he, /התסריט שלך עדיין כאן/);
  for (const l of ['he', 'en']) { assert.doesNotMatch(EXPIRED_COPY.message[l], /\d/); assert.doesNotMatch(EXPIRED_COPY.message[l], /pro\b|price|upgrade|\$|פרו|שדרג|מחיר/i); }
  assert.equal(expiredText('he'), EXPIRED_COPY.message.he); assert.equal(expiredText('en'), EXPIRED_COPY.message.en); assert.equal(expiredText('fr'), EXPIRED_COPY.message.en);
});

test('wiring (source guard): poster / panel use the check after an <img> error only; History thumbnails are untouched; reel + share-all are gated', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  const poster = read('components/PosterRenderer.jsx'), board = read('components/StoryboardView.jsx'), out = read('components/ScriptOutput.jsx'), reel = read('components/MovieReelModal.jsx'), hist = read('components/HistoryPanel.jsx');
  assert.match(poster, /onError=\{\(\) => \{ setPosterLoading\(false\); checkExpiry\(\); \}\}/);
  assert.match(poster, /!posterLoading && posterUrl && !posterHidden && !posterExpired/, 'poster share/download hidden when expired');
  assert.match(board, /checkPanelExpiry\(idx, imgUrl\)/); assert.match(board, /expiryByIdx\[idx\] !== 'expired'/, 'share-all skips expired panels');
  assert.match(out, /reelUnavailable/); assert.match(reel, /All panel images failed to decode/); assert.match(reel, /isImageExpired\(firstUrl\)/);
  assert.doesNotMatch(hist, /expired-image|isImageExpired/, 'History thumbnails keep their own fallback');
});
