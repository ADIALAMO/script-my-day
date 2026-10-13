import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { TOUR_STEPS, TOUR_UI, NEXT_STEPS } = await import('../constants/tour.js');
const { isTourDone, markTourDone, _resetTourMemory, TOUR_KEY } = await import('../utils/tour-state.js');
const { hasPriorActivity, cookieBannerPending, autoStartDecision, resolveSteps, computePlacement, stepAfter } = await import('../utils/tour-logic.js');

const FORBIDDEN = /Stripe|\$\s?9\b|9\$|upgrade|שדרג|שדרוג|subscription|מנוי|\bPro\b|פרו\b|waitlist|billing|חיוב|checkout|per month|לחודש\b/i; // same intent as tests/native-copy.test.js
const fakeStorage = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; };
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('steps: unique ids, he + en copy, one short line, anchors are data-tour names', () => {
  assert.equal(new Set(TOUR_STEPS.map((s) => s.id)).size, TOUR_STEPS.length);
  for (const s of TOUR_STEPS) {
    assert.match(s.anchor, /^[a-z-]+$/);
    for (const l of ['he', 'en']) {
      assert.ok(s.copy[l] && s.copy[l].trim(), `${s.id}.${l}`);
      assert.ok(s.copy[l].length <= 90, `${s.id}.${l} is one short line`);
      assert.ok(!/\n/.test(s.copy[l]));
    }
    assert.match(s.copy.he, /[֐-׿]/);
    assert.ok(!/[֐-׿]/.test(s.copy.en));
  }
  assert.deepEqual(TOUR_STEPS.slice(0, 4).map((s) => s.id), ['stepper', 'journal', 'genre', 'generate']);
  assert.equal(TOUR_STEPS.at(-1).id, 'guide');
});

test('UI + next-step copy exist in both languages and contain no pricing / plan words', () => {
  for (const k of ['next', 'back', 'skip', 'done', 'guide', 'dialog']) assert.ok(TOUR_UI[k].he && TOUR_UI[k].en, k);
  assert.equal(TOUR_UI.stepOf.en(2, 5), '2 of 5');
  assert.equal(TOUR_UI.stepOf.he(2, 5), '2 מתוך 5');
  assert.equal(TOUR_UI.guide.he, 'הדרכה');
  assert.equal(TOUR_UI.guide.en, 'Guide');
  for (const n of Object.values(NEXT_STEPS)) assert.ok(n.he && n.en && n.target);
  const all = [...TOUR_STEPS.flatMap((s) => Object.values(s.copy)), ...Object.values(NEXT_STEPS).flatMap((n) => [n.he, n.en]), ...Object.values(TOUR_UI).flatMap((u) => [u.he, u.en].filter((x) => typeof x === 'string'))];
  assert.deepEqual(all.filter((s) => FORBIDDEN.test(s)), []);
});

test('first-run flag: unset / set / throwing storage / no storage', () => {
  _resetTourMemory();
  const st = fakeStorage();
  assert.equal(isTourDone(st), false);
  markTourDone(st);
  assert.equal(st._m[TOUR_KEY], '1');
  assert.equal(isTourDone(st), true);
  _resetTourMemory();
  assert.equal(isTourDone(fakeStorage({ [TOUR_KEY]: '1' })), true);
  _resetTourMemory();
  assert.equal(isTourDone(throwing), false);              // getItem throws -> not done, no crash
  assert.doesNotThrow(() => markTourDone(throwing));      // setItem throws -> swallowed
  assert.equal(isTourDone(throwing), true);               // ...and the session does not re-prompt
  _resetTourMemory();
  assert.equal(isTourDone(null), false);
  assert.doesNotThrow(() => markTourDone(null));
  _resetTourMemory();
});

test('existing users: any history / prior-use key blocks the auto-start', () => {
  assert.equal(hasPriorActivity(fakeStorage(), 0), false);
  assert.equal(hasPriorActivity(fakeStorage(), 2), true);
  assert.equal(hasPriorActivity(fakeStorage({ lifescript_history: '[{"id":1}]' }), 0), true);
  assert.equal(hasPriorActivity(fakeStorage({ lifescript_history: '[]' }), 0), false);
  assert.equal(hasPriorActivity(fakeStorage({ lifescript_history: '{broken' }), 0), true);
  assert.equal(hasPriorActivity(fakeStorage({ ls_howto_dismissed: '1' }), 0), true);
  assert.equal(hasPriorActivity(fakeStorage({ lifescript_producer_name: 'Dana' }), 0), true);
  assert.equal(hasPriorActivity(fakeStorage({ lifescript_device_id: 'x' }), 0), false); // created on every first visit: not a signal
  assert.equal(hasPriorActivity(throwing, 0), false);
  assert.equal(hasPriorActivity(null, 0), false);
});

test('cookie banner pending = its key unset; storage errors never block', () => {
  assert.equal(cookieBannerPending(fakeStorage()), true);
  assert.equal(cookieBannerPending(fakeStorage({ lifescript_cookie_v2: '{"analytics":false}' })), false);
  assert.equal(cookieBannerPending(throwing), false);
});

test('auto-start decision matrix', () => {
  const ok = { done: false, priorActivity: false, hasScript: false, blocked: false, cookiePending: false, ready: true };
  assert.equal(autoStartDecision(ok), 'start');
  assert.equal(autoStartDecision({ ...ok, done: true }), 'abandon');
  assert.equal(autoStartDecision({ ...ok, priorActivity: true }), 'abandon');
  assert.equal(autoStartDecision({ ...ok, hasScript: true }), 'abandon');
  assert.equal(autoStartDecision({ ...ok, blocked: true }), 'wait');
  assert.equal(autoStartDecision({ ...ok, cookiePending: true }), 'wait');
  assert.equal(autoStartDecision({ ...ok, ready: false }), 'wait');
});

test('anchor-missing fallback: missing / zero-size anchors are dropped; nothing left = empty list', () => {
  const rects = { stepper: { width: 10, height: 10 }, journal: { width: 0, height: 20 }, genre: null };
  const got = resolveSteps(TOUR_STEPS, (a) => rects[a] ?? null).map((s) => s.id);
  assert.deepEqual(got, ['stepper']);
  assert.deepEqual(resolveSteps(TOUR_STEPS, () => null), []);
  assert.equal(stepAfter(0, -1, 3), -1);
  assert.equal(stepAfter(2, 1, 3), -1);
  assert.equal(stepAfter(1, 1, 3), 2);
});

const VP = { w: 390, h: 760 };
const B = { w: 300, h: 150 };
test('placement: below when it fits, above when not, dock when neither; always inside the viewport', () => {
  const r = (top, height, left = 40, width = 200) => ({ top, bottom: top + height, left, right: left + width, width, height });
  const below = computePlacement({ rect: r(100, 50), bubble: B, vp: VP });
  assert.equal(below.mode, 'bottom');
  assert.equal(below.top, 150 + 14);
  const above = computePlacement({ rect: r(600, 100), bubble: B, vp: VP });
  assert.equal(above.mode, 'top');
  assert.equal(above.top, 600 - 14 - 150);
  const dock = computePlacement({ rect: r(0, 760, 0, 390), bubble: B, vp: VP });
  assert.equal(dock.mode, 'dock');
  assert.equal(dock.arrowLeft, null);
  for (const p of [below, above, dock]) { assert.ok(p.left >= 12 && p.left + B.w <= VP.w - 12); assert.ok(p.top >= 12 && p.top + B.h <= VP.h - 12); }
});

test('placement: insets respected; arrow follows the anchor and stays inside the bubble; RTL aligns a wide anchor at its start edge', () => {
  const p = computePlacement({ rect: { top: 10, bottom: 40, left: 340, right: 380, width: 40, height: 30 }, bubble: B, vp: VP, insets: { top: 47, bottom: 34, left: 0, right: 0 } });
  assert.ok(p.top >= 47 + 12);
  assert.ok(p.arrowLeft >= 18 && p.arrowLeft <= B.w - 18);
  assert.equal(p.arrowLeft, B.w - 18);
  const wide = { top: 200, bottom: 260, left: 10, right: 380, width: 370, height: 60 };
  const ltr = computePlacement({ rect: wide, bubble: B, vp: VP, rtl: false });
  const rtl = computePlacement({ rect: wide, bubble: B, vp: VP, rtl: true });
  assert.equal(ltr.left, 12);
  assert.equal(rtl.left, VP.w - 12 - B.w);   // right edge aligned with the anchor's (clamped) right edge
  const tiny = computePlacement({ rect: { top: 100, bottom: 120, left: 5, right: 25, width: 20, height: 20 }, bubble: { w: 360, h: 100 }, vp: { w: 360, h: 640 } });
  assert.ok(tiny.left >= 12);
});

// ── source scans (like tests/native-copy.test.js): the tour is wired to real anchors and stays UI-only ──
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const SRC = ['pages/index.js', 'components/ScriptForm.jsx', 'components/ScriptOutput.jsx', 'components/Navbar.jsx'].map(read).join('\n');

test('every data-tour anchor named by a step or a next-step button exists in the UI source', () => {
  const names = new Set([...TOUR_STEPS.map((s) => s.anchor), ...Object.values(NEXT_STEPS).map((n) => n.target)]);
  for (const n of names) assert.ok(new RegExp(`data-tour="${n}"`).test(SRC), `data-tour="${n}" missing`);
});

test('GuidedTour is only loaded lazily (dynamic, ssr:false) so it stays out of the first bundle', () => {
  const index = read('pages/index.js');
  assert.match(index, /const GuidedTour = dynamic\(\(\) => import\('\.\.\/components\/GuidedTour'\), \{ ssr: false \}\)/);
  assert.ok(!/^import .*components\/GuidedTour/m.test(index));
});

test('the tour never touches body scroll lock, the network or analytics', () => {
  const files = ['components/GuidedTour.jsx', 'components/NextStepButton.jsx', 'hooks/useGuidedTour.js', 'utils/tour-logic.js', 'utils/tour-state.js', 'constants/tour.js'];
  for (const f of files) {
    const src = read(f);
    assert.ok(!/overflow\s*=|style\.overflow|body\.style/.test(src), `${f}: no scroll lock`);
    assert.ok(!/\bfetch\(|XMLHttpRequest|sendBeacon|gtag|track\(|va\./.test(src), `${f}: no network / analytics`);
  }
});

test('tour z-index sits above the navbar but below the cookie banner is not required: it waits for it', () => {
  assert.match(read('components/GuidedTour.jsx'), /TOUR_Z = 2400/);
  assert.match(read('hooks/useGuidedTour.js'), /cookieBannerPending/);
});

test('"How it works" card: held back only through the hold flag, never retired', () => {
  const form = read('components/ScriptForm.jsx');
  assert.match(form, /showHowTo && !holdHowTo/);
  assert.match(form, /ls_howto_dismissed/);
});
