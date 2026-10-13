import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');
const { contentRect, findOutside, radiusClipsText } = await import('../utils/glyph-fit.js');
const { scriptWindowClasses, scriptFrameRadius } = await import('../utils/scroll-mode.js');

// numbers measured in WebKit / Chromium on the dev server (a 942 px box, 80 px padding)
const LTR = { left: 166, offsetWidth: 942, clientWidth: 938, borderLeft: 0, borderRight: 0, paddingLeft: 80, paddingRight: 80, rtl: false };

test('content rect: the scrollbar is skipped on the RIGHT in LTR and on the LEFT in RTL', () => {
  assert.deepEqual(contentRect(LTR), { left: 246, right: 1024 });
  assert.deepEqual(contentRect({ ...LTR, rtl: true }), { left: 250, right: 1028 });
  assert.deepEqual(contentRect({ ...LTR, clientWidth: 942 }), { left: 246, right: 1028 });      // overlay scrollbar (no gutter)
  assert.deepEqual(contentRect({ ...LTR, borderLeft: 1, borderRight: 1, offsetWidth: 944, clientWidth: 940 }), { left: 247, right: 1027 });
});

test('findOutside: flags any line that leaves the content area, with how far (the measured regressions)', () => {
  const content = { left: 246, right: 1024 };
  assert.deepEqual(findOutside([{ left: 300, right: 1024 }, { left: 246, right: 800 }], content), []);
  // Hebrew script under the English UI: LTR base direction + right alignment let trailing spaces / punctuation hang 18 px past the edge
  const hang = findOutside([{ left: 1024, right: 1042 }, { left: 920, right: 1024 }], content);
  assert.equal(hang.length, 1); assert.equal(hang[0].overRight, 18);
  // a long unbreakable (maqaf-joined) word spilling into the left padding on a phone
  const spill = findOutside([{ left: 71, right: 83 }], { left: 77, right: 311 });
  assert.equal(spill.length, 1); assert.equal(spill[0].overLeft, 6);
  assert.deepEqual(findOutside([{ left: 246.3, right: 1024.4 }], content), []);                 // sub-pixel noise
  assert.deepEqual(findOutside([{ left: 0, right: 0 }], content), []);                          // empty rects ignored
});

test('radius vs padding: the frame radius must not exceed the padding the text keeps from the edge', () => {
  assert.equal(radiusClipsText({ radius: 56, paddingLeft: 40, paddingRight: 40 }), true);       // the old phone window: 3.5rem corner over 40 px padding
  assert.equal(radiusClipsText({ radius: 32, paddingLeft: 40, paddingRight: 40 }), false);
  assert.equal(radiusClipsText({ radius: 56, paddingLeft: 80, paddingRight: 80 }), false);
  assert.equal(scriptFrameRadius('inner'), 'rounded-[2rem] md:rounded-[3.5rem]');                // 32 px (< p-10 = 40) on phones, 56 px (< p-20 = 80) on md+
  assert.equal(scriptFrameRadius('page'), 'rounded-[3.5rem]');
});

test('script text is built so no glyph is clipped: own direction, logical alignment, wrapping, a real line-height, a stable scrollbar gutter, a badge outside the scroll box', () => {
  const out = read('components/ScriptOutput.jsx');
  const text = out.slice(out.indexOf('data-script-text') - 200, out.indexOf('data-script-text') + 500);
  assert.match(text, /dir=\{isHebrew \? 'rtl' : 'ltr'\}/);                  // the SCRIPT's language, not the UI's
  assert.match(text, /style=\{\{ lineHeight: 1\.8 \}\}/);                   // inline: the old leading-[2.5] class never applied (1.2 on md+)
  assert.match(text, /\[overflow-wrap:anywhere\]/);
  assert.match(text, /text-start/);
  assert.ok(!/leading-\[2\.5\]/.test(text));
  assert.ok(!/text-right/.test(text.slice(text.indexOf('className'))));
  assert.match(out, /className="inline-block w-2\.5 h-8 bg-\[#d4a373\] ms-1 align-middle"/);   // the caret margin follows the direction
  assert.match(scriptWindowClasses('inner', { touch: true }), /\[scrollbar-gutter:stable\]/);
  assert.match(scriptWindowClasses('inner'), /\[scrollbar-gutter:stable\]/);
  assert.match(out, /innerScroll \? 'relative h-14' : 'contents'/);       // reserved footer row (no layout shift when typing ends)
  assert.match(out, /innerScroll \? 'absolute inset-0 px-6 flex justify-between items-center z-30'/);
  assert.match(out, /innerScroll \? 'pb-6' : 'pb-40'/);
  assert.match(out, /scriptFrameRadius\(windowMode\)/);
});
