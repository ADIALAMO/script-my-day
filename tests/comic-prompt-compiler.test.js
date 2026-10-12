import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileComicPrompt } from '../lib/comic-prompt-compiler.js';

const PREFIX = 'Anime comic illustration, flat cel-shading, vibrant dramatic lighting, bold clean ink outlines';
const SUFFIX = 'vivid saturated colors, clean bold linework, expressive faces';
const wrap = (scene) => `${PREFIX} — ${scene} — ${SUFFIX}`;

test('the style prefix LEADS the compiled prompt and the style suffix survives', () => {
  const out = compileComicPrompt(wrap('A weary detective leans in a doorway under a dim streetlight, medium shot'));
  assert.ok(out.startsWith(PREFIX), out);
  assert.ok(out.includes(SUFFIX), out);
  assert.ok(out.indexOf(PREFIX) < out.indexOf('detective') && out.indexOf('detective') < out.indexOf(SUFFIX));
});

test('a long scene is capped on its own — the old whole-string 64-word cut used to drop the suffix', () => {
  const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
  const out = compileComicPrompt(wrap(long));
  assert.ok(out.includes(SUFFIX), 'suffix kept');
  assert.ok(out.includes('word63') && !out.includes('word64'), 'scene capped at 64 words');
});

test('unwrapped input (older client / direct call) keeps the generic comic framing and the cap', () => {
  const out = compileComicPrompt('A man on a roof');
  assert.ok(out.startsWith('Clean inked comic lineart'));
  assert.ok(out.includes('A man on a roof'));
});

test('hand-action simplification still applies inside the scene', () => {
  const out = compileComicPrompt(wrap('The woman is holding a cup and smiling, medium shot'));
  assert.ok(!/holding/i.test(out));
});

test('an em dash inside the scene does not break the split', () => {
  const out = compileComicPrompt(wrap('A calm room — warm light, medium shot'));
  assert.ok(out.startsWith(PREFIX) && out.includes(SUFFIX));
});
