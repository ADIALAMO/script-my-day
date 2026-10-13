import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { CHAPTERS, TOUR_UI, NEXT_STEPS, MILESTONE_CHAPTER, chapterById } = await import('../constants/tour.js');
const { isTourDone, markTourDone, readChapters, markChapterDone, setAutoOff, _resetTourMemory, TOUR_KEY, CHAPTERS_KEY } = await import('../utils/tour-state.js');
const { hasPriorActivity, cookieBannerPending, autoStartDecision, resolveSteps, findUsableAnchor, stepOutcome, chapterTotal, chapterAvailable, chapterAutoEligible, computePlacement, stepAfter } = await import('../utils/tour-logic.js');

const FORBIDDEN = /Stripe|\$\s?9\b|9\$|upgrade|שדרג|שדרוג|subscription|מנוי|\bPro\b|פרו\b|waitlist|billing|חיוב|checkout|per month|לחודש\b|\boffers?\b|\bplans?\b|\bprice|הצעה|הצעות|תוכנית|מחיר/i; // same intent as tests/native-copy.test.js
const fakeStorage = (init = {}) => { const m = { ...init }; return { getItem: (k) => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, _m: m }; };
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

const allSteps = CHAPTERS.flatMap((c) => c.steps);

test('chapters: ids 1-4, 2 to 6 steps each, unique step ids, he + en copy, one short line', () => {
  assert.deepEqual(CHAPTERS.map((c) => c.id), [1, 2, 3, 4]);
  assert.equal(new Set(allSteps.map((s) => s.id)).size, allSteps.length);
  for (const c of CHAPTERS) {
    assert.ok(c.steps.length >= 2 && c.steps.length <= 6, `chapter ${c.id} has ${c.steps.length} steps`);
    assert.ok(c.name.he && c.name.en && c.requires.length);
    if (c.id > 1) assert.ok(c.unavailable.he && c.unavailable.en);
    for (const s of c.steps) {
      assert.ok(s.anchors.length >= 1 && s.anchors.every((a) => /^[a-z-]+$/.test(a)));
      for (const l of ['he', 'en']) {
        assert.ok(s.copy[l] && s.copy[l].trim(), `${s.id}.${l}`);
        assert.ok(s.copy[l].length <= 110, `${s.id}.${l} is one short line (${s.copy[l].length})`);
        assert.ok(!/\n/.test(s.copy[l]));
      }
      assert.match(s.copy.he, /[\u0590-\u05FF]/);
      assert.ok(!/[\u0590-\u05FF]/.test(s.copy.en));
    }
  }
});

test('chapter order: the approved steps, in the real flow order', () => {
  const ids = (n) => chapterById(n).steps.map((s) => s.id);
  assert.deepEqual(ids(1), ['spark', 'journal', 'genre', 'creator', 'generate', 'guide']);
  assert.deepEqual(ids(2), ['skip-typing', 'edit', 'star', 'poster']);
  assert.deepEqual(ids(3), ['poster-share', 'comic-style', 'comic']);
  assert.deepEqual(ids(4), ['replace', 'reel', 'history', 'report']);
  assert.deepEqual(MILESTONE_CHAPTER, { 'typing-start': 2, 'poster-done': 3, 'comic-done': 4 });
});

test('only the typewriter Skip step is interactive; edit and report have fallback anchors; pinned navbar steps never scroll', () => {
  assert.deepEqual(allSteps.filter((s) => s.interactive).map((s) => s.id), ['skip-typing']);
  assert.deepEqual(allSteps.find((s) => s.id === 'edit').anchors, ['edit-review', 'edit']);
  assert.deepEqual(allSteps.find((s) => s.id === 'report').anchors, ['report-panel', 'comic-result']);
  assert.deepEqual(allSteps.filter((s) => s.fixed).map((s) => s.id), ['guide', 'history']);
});

test('copy facts match the code: Skip only shows the whole script; Replace shows how many are left; star can be switched off', () => {
  const copy = (id) => allSteps.find((s) => s.id === id).copy.en;
  assert.match(copy('skip-typing'), /whole script at once/);
  assert.match(copy('replace'), /how many are left/);
  assert.match(copy('star'), /switch it off/);
  assert.match(copy('creator'), /Optional/);
});

test('UI + next-step copy exist in both languages and contain no pricing / plan / offer words', () => {
  for (const k of ['next', 'back', 'skip', 'done', 'guide', 'dialog', 'menuTitle']) assert.ok(TOUR_UI[k].he && TOUR_UI[k].en, k);
  assert.equal(TOUR_UI.chapterLabel.en(2, 1, 4), 'Chapter 2 · 1 of 4');
  assert.equal(TOUR_UI.chapterLabel.he(2, 1, 4), 'פרק 2 · 1 מתוך 4');
  assert.equal(TOUR_UI.guide.he, 'הדרכה');
  assert.equal(TOUR_UI.guide.en, 'Guide');
  for (const n of Object.values(NEXT_STEPS)) assert.ok(n.he && n.en && n.target);
  const all = [
    ...allSteps.flatMap((s) => Object.values(s.copy)),
    ...CHAPTERS.flatMap((c) => [c.name.he, c.name.en, c.unavailable.he, c.unavailable.en]),
    ...Object.values(NEXT_STEPS).flatMap((n) => [n.he, n.en]),
    ...Object.values(TOUR_UI).flatMap((u) => [u.he, u.en].filter((x) => typeof x === 'string')),
  ];
  assert.deepEqual(all.filter((x) => FORBIDDEN.test(x)), []);
  assert.ok(FORBIDDEN.test('special offers') && FORBIDDEN.test('Upgrade now') && FORBIDDEN.test('your plan')); // the scan itself works
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

test('chapter flags: per-chapter done, skip turns auto off for good, storage errors are swallowed', () => {
  _resetTourMemory();
  const st = fakeStorage();
  assert.deepEqual(readChapters(st), { done: [], off: false });
  markChapterDone(1, st); markChapterDone(2, st); markChapterDone(2, st);
  assert.deepEqual(readChapters(st).done, [1, 2]);
  assert.deepEqual(JSON.parse(st._m[CHAPTERS_KEY]).done, [1, 2]);
  setAutoOff(st);
  assert.equal(readChapters(st).off, true);
  assert.deepEqual(readChapters(st).done, [1, 2]);
  _resetTourMemory();
  assert.deepEqual(readChapters(fakeStorage({ [CHAPTERS_KEY]: '{broken' })), { done: [], off: false });
  assert.deepEqual(readChapters(fakeStorage({ [CHAPTERS_KEY]: '{"done":["x",3],"off":"yes"}' })), { done: [3], off: false });
  assert.doesNotThrow(() => { markChapterDone(3, throwing); setAutoOff(throwing); });
  assert.deepEqual(readChapters(throwing), { done: [3], off: true }); // session memory still holds
  _resetTourMemory();
});

test('auto chapters 2-4: only after chapter 1 was FINISHED, never after a skip, once each', () => {
  const ok = { done: [1], off: false };
  for (const id of [2, 3, 4]) assert.equal(chapterAutoEligible(ok, id), true);
  assert.equal(chapterAutoEligible({ done: [1, 2], off: false }, 2), false);
  assert.equal(chapterAutoEligible({ done: [1], off: true }, 3), false);
  assert.equal(chapterAutoEligible({ done: [], off: false }, 2), false);   // chapter 1 never finished (or finished in the first tour release)
  assert.equal(chapterAutoEligible(ok, 1), false);                          // chapter 1 has its own first-run rule
});

test('Guide menu availability: a chapter is offered only when its screen is there', () => {
  const on = new Set(['journal']);
  assert.equal(chapterAvailable(chapterById(1), (a) => on.has(a)), true);
  assert.equal(chapterAvailable(chapterById(2), (a) => on.has(a)), false);
  on.add('poster-cta'); on.add('poster-share'); on.add('reel-cta');
  for (const id of [2, 3, 4]) assert.equal(chapterAvailable(chapterById(id), (a) => on.has(a)), true);
});

test('step lifecycle: show / wait / drop before it is shown; keep / wait / drop after (typewriter Skip vanishing is silent)', () => {
  assert.equal(stepOutcome({ found: true, shown: false }), 'show');
  assert.equal(stepOutcome({ found: false, shown: false, elapsedMs: 100, waitMs: 4000 }), 'wait');
  assert.equal(stepOutcome({ found: false, shown: false, elapsedMs: 4000, waitMs: 4000 }), 'drop');
  assert.equal(stepOutcome({ found: false, shown: false, elapsedMs: 0, waitMs: 0 }), 'drop');         // no wait = dropped at once
  assert.equal(stepOutcome({ found: true, shown: true }), 'keep');
  assert.equal(stepOutcome({ found: false, shown: true, misses: 1 }), 'wait');                         // one miss = a re-render, not a drop
  assert.equal(stepOutcome({ found: false, shown: true, misses: 2 }), 'drop');                         // Skip pressed / typing ended
  assert.equal(chapterTotal(4, 1), 3);
  assert.equal(chapterTotal(1, 5), 0);
});

test('fallback anchors: edit-review then edit; report-panel then comic-result; none = no usable anchor', () => {
  const edit = allSteps.find((s) => s.id === 'edit');
  const rect = { width: 5, height: 5 };
  assert.equal(findUsableAnchor(edit, (a) => (a === 'edit' ? rect : null)), 'edit');
  assert.equal(findUsableAnchor(edit, () => rect), 'edit-review');
  assert.equal(findUsableAnchor(edit, () => null), null);
  const report = allSteps.find((s) => s.id === 'report');
  assert.equal(findUsableAnchor(report, (a) => (a === 'comic-result' ? rect : null)), 'comic-result');
  assert.equal(findUsableAnchor(report, (a) => (a === 'report-panel' ? { width: 0, height: 9 } : null)), null);
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
  const rects = { spark: { width: 10, height: 10 }, journal: { width: 0, height: 20 }, genre: null };
  const got = resolveSteps(chapterById(1).steps, (a) => rects[a] ?? null).map((s) => s.id);
  assert.deepEqual(got, ['spark']);
  assert.deepEqual(resolveSteps(chapterById(1).steps, () => null), []);
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
const SRC = ['pages/index.js', 'components/ScriptForm.jsx', 'components/ScriptOutput.jsx', 'components/Navbar.jsx', 'components/PosterRenderer.jsx', 'components/StoryboardView.jsx'].map(read).join('\n');

test('every data-tour anchor named by a step or a next-step button exists in the UI source', () => {
  const names = new Set([...allSteps.flatMap((s) => s.anchors), ...Object.values(NEXT_STEPS).map((n) => n.target), ...CHAPTERS.flatMap((c) => c.requires)]);
  for (const n of names) assert.ok(new RegExp(`data-tour=(?:"${n}"|\\{[^}]*'${n}')`).test(SRC), `data-tour="${n}" missing`);
});

test('GuidedTour is only loaded lazily (dynamic, ssr:false) so it stays out of the first bundle', () => {
  const index = read('pages/index.js');
  assert.match(index, /const GuidedTour = dynamic\(\(\) => import\('\.\.\/components\/GuidedTour'\), \{ ssr: false \}\)/);
  assert.ok(!/^import .*components\/GuidedTour/m.test(index));
  assert.match(index, /<GuidedTour key=\{tour\.chapter\} chapter=\{tour\.chapter\}/);
});

test('the tour never touches body scroll lock, the network or analytics', () => {
  const files = ['components/GuidedTour.jsx', 'components/GuideMenu.jsx', 'components/NextStepButton.jsx', 'hooks/useGuidedTour.js', 'utils/tour-logic.js', 'utils/tour-state.js', 'constants/tour.js'];
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

test('milestones are emitted by ScriptOutput only for screens generated in this session; ReportButton and API routes are untouched', () => {
  const out = read('components/ScriptOutput.jsx');
  for (const m of Object.keys(MILESTONE_CHAPTER)) assert.ok(out.includes(`onMilestone?.('${m}')`), m);
  assert.match(out, /isTyping && !wasTyping\.current && !instant/);       // history reopen (instant) never starts chapter 2
  assert.ok(!/data-tour|onMilestone/.test(read('components/ReportButton.jsx')));
  assert.match(read('components/StoryboardView.jsx'), /idx < unlockedPanels && regensLeft > 0/); // only a panel Replace can really act on is highlighted
});
