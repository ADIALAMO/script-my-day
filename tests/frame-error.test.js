import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const { CODES } = await import('../lib/messages.js');
const { classifyFrameFailure, missingFrames, anySessionExpired, shouldAutoRetry, restoredPanelState, FETCH_TIMEOUT_MS, AUTO_RETRY_DELAY_MS, RESUME_CONCURRENCY } = await import('../utils/frame-error.js');
const { COMIC_COPY, comicText } = await import('../constants/comic-copy.js');

test('constants: ~62 s storyboard fetch, ~55 s per panel, 1.5 s auto-retry delay, 2 frames at a time', () => {
  assert.equal(FETCH_TIMEOUT_MS.storyboard, 62000);
  assert.equal(FETCH_TIMEOUT_MS.panel, 55000);
  assert.equal(AUTO_RETRY_DELAY_MS, 1500);
  assert.equal(RESUME_CONCURRENCY, 2);
});

test('RETRYABLE: network failure, timeout, non-JSON body, 5xx, placeholder, unchecked-image, unknown failures', () => {
  for (const f of [
    { kind: 'network' }, { kind: 'timeout' }, { kind: 'nonjson', status: 504 },
    { kind: 'http', status: 500 }, { kind: 'http', status: 502 }, { kind: 'http', status: 503 }, { kind: 'http', status: 504 },
    { kind: 'placeholder' }, { kind: 'placeholder', code: CODES.CONTENT_CHECK_UNAVAILABLE },
    { kind: 'api', code: CODES.CONTENT_CHECK_UNAVAILABLE }, { kind: 'api' }, {},
  ]) {
    const c = classifyFrameFailure(f);
    assert.equal(c.retryable, true, JSON.stringify(f));
    assert.equal(c.sessionExpired, false);
  }
});

test('TERMINAL: refusals, blocked prompts, budget and quota answers are never retryable', () => {
  for (const code of [CODES.CONTENT_REFUSED, CODES.CONTENT_BLOCKED, CODES.IMAGE_BUDGET_REACHED, CODES.QUOTA_PANEL_REGEN, CODES.QUOTA_PANEL_DAILY, CODES.NEEDS_ACCOUNT]) {
    for (const kind of ['api', 'placeholder', 'http']) {
      const c = classifyFrameFailure({ kind, status: 429, code });
      assert.equal(c.retryable, false, `${kind}/${code}`);
      assert.equal(c.sessionExpired, false);
    }
  }
  assert.equal(classifyFrameFailure({ kind: 'http', status: 400 }).retryable, false);
  assert.equal(classifyFrameFailure({ kind: 'http', status: 404 }).retryable, false);
});

test('a refusal wins over a connection-looking kind (the code decides)', () => {
  assert.equal(classifyFrameFailure({ kind: 'network', code: CODES.CONTENT_REFUSED }).retryable, false);
  assert.equal(classifyFrameFailure({ kind: 'http', status: 500, code: CODES.QUOTA_PANEL_DAILY }).retryable, false);
});

test('COMIC_SESSION_EXPIRED is its own outcome: not retryable, offers a new comic', () => {
  const c = classifyFrameFailure({ kind: 'http', status: 403, code: CODES.COMIC_SESSION_EXPIRED });
  assert.equal(c.sessionExpired, true); assert.equal(c.retryable, false); assert.equal(c.reason, 'session-expired');
});

test('RATE_LIMITED keeps its own (amber, wait-a-moment) path', () => {
  assert.equal(classifyFrameFailure({ kind: 'api', code: CODES.RATE_LIMITED }).rateLimited, true);
  assert.equal(classifyFrameFailure({ kind: 'http', status: 429 }).rateLimited, true);
});

test('one automatic retry only, and only for a retryable failure', () => {
  assert.equal(shouldAutoRetry({ attempt: 0, retryable: true }), true);
  assert.equal(shouldAutoRetry({ attempt: 1, retryable: true }), false);
  assert.equal(shouldAutoRetry({ attempt: 0, retryable: false }), false);
});

test('missingFrames: finished + retryable + no image only; loading, loaded, terminal and rate-limited frames are not offered', () => {
  const imgs = {
    0: { loading: false, url: 'data:x', error: false },
    1: { loading: false, url: null, error: true, retryable: true },
    2: { loading: true, url: null, error: false },
    3: { loading: false, url: null, error: true, retryable: false },
    4: { loading: false, url: null, error: true, retryable: true, missing: true },
    5: { loading: false, url: null, error: false, rateLimited: true },
    6: { loading: false, url: null, error: true, retryable: true },
  };
  assert.deepEqual(missingFrames(imgs, 7), [1, 4, 6]);
  assert.deepEqual(missingFrames(imgs, 3), [1]);          // only the unlocked count
  assert.deepEqual(missingFrames({}, 5), []);
  assert.deepEqual(missingFrames(undefined, 5), []);
  assert.equal(anySessionExpired({ 0: { error: true, sessionExpired: true } }, 3), true);
  assert.equal(anySessionExpired(imgs, 7), false);
});

test('History restore: image -> loaded; no image + saved session -> "missing, retryable"; no saved session -> plain lost frame', () => {
  assert.deepEqual(restoredPanelState({ imageUrl: 'https://cdn/x.png' }, true), { loading: false, url: 'https://cdn/x.png', error: false });
  assert.deepEqual(restoredPanelState({ imageUrl: null }, true), { loading: false, url: null, error: true, retryable: true, missing: true });
  assert.deepEqual(restoredPanelState({ imageUrl: null }, false), { loading: false, url: null, error: true, retryable: false, noSession: true });
  assert.equal(restoredPanelState({}, false).retryable, false);
});

test('copy: he + en for every string, no pricing / plan / upgrade / offer words, count banner formats', () => {
  const FORBIDDEN = /Stripe|\$\s?9\b|upgrade|שדרג|שדרוג|subscription|מנוי|\bPro\b|פרו\b|waitlist|billing|חיוב|checkout|\boffers?\b|\bplans?\b|\bprice|הצעה|הצעות|תוכנית|מחיר/i;
  for (const [k, v] of Object.entries(COMIC_COPY)) {
    for (const l of ['he', 'en']) {
      const t = typeof v[l] === 'function' ? v[l](3) : v[l];
      assert.ok(t && String(t).trim(), `${k}.${l}`);
      assert.ok(!FORBIDDEN.test(t), `${k}.${l}: ${t}`);
    }
  }
  assert.equal(comicText(COMIC_COPY.retryFrame, 'en'), 'Retry this frame');
  assert.equal(comicText(COMIC_COPY.frameFailed, 'en'), "Frame didn't load");
  assert.equal(comicText(COMIC_COPY.missingBanner, 'en', 4), "4 frames didn't load. You can try again.");
  assert.match(comicText(COMIC_COPY.missingBanner, 'he', 4), /4 פריימים/);
  assert.match(comicText(COMIC_COPY.generateMissing, 'he'), /[֐-׿]/);
});

test('client wiring: timeouts via AbortController, one auto retry + visibility retry (fresh comic only), 2-at-a-time resume, session saved with History', () => {
  const hook = read('hooks/useStoryboardGeneration.js');
  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /FETCH_TIMEOUT_MS\.storyboard/);
  assert.equal((hook.match(/FETCH_TIMEOUT_MS\.panel/g) || []).length >= 3, true);       // initial panels, replace, retry guard
  assert.ok(!/await fetch\('\/api\/generate-poster'/.test(hook), 'no unbounded panel fetch is left');
  assert.ok(!/await fetch\('\/api\/generate-storyboard'/.test(hook), 'no unbounded storyboard fetch is left');
  assert.match(hook, /shouldAutoRetry\(\{ attempt, retryable: f\.retryable \}\)/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /freshComicRef\.current/);                                           // the visibility retry never touches a restored comic
  assert.match(hook, /RESUME_CONCURRENCY/);
  assert.match(hook, /comicSeed: comicSeedRef\.current, sessionId, unlocked/);              // saved with the text-only panels
  assert.match(hook, /storyboardAbortRef\.current\?\.abort\(\)/);                           // Cancel frees the request
  const idx = read('pages/index.js');
  assert.match(idx, /comicMeta: \{ comicSeed: meta\.comicSeed/);
  assert.match(idx, /setInitialComicMeta\(entry\.panels\?\.length > 0 \? \(entry\.comicMeta \|\| null\) : null\)/);
  const view = read('components/StoryboardView.jsx');
  for (const k of ['retryFrame', 'frameFailed', 'generateMissing', 'newComic', 'sessionExpiredBanner']) assert.ok(view.includes(`COMIC_COPY.${k}`), k);
  assert.match(view, /onRetryFrame\(idx\)/);
});

test('the image-safety pipeline is untouched by the retry path: it only re-calls the same route (no marker, checker or upload-panel logic in the hook besides the existing upload)', () => {
  const hook = read('hooks/useStoryboardGeneration.js');
  assert.ok(!/imgok|image-check|content-safety|isContentRefusal/.test(hook));
});
