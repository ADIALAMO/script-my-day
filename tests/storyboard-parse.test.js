import { test } from 'node:test';
import assert from 'node:assert/strict';

const { extractPanels, parseStoryboard, completeObjects, GEMINI_RESPONSE_SCHEMA, OPENROUTER_RESPONSE_FORMAT, MIN_SALVAGE } = await import('../lib/storyboard-parse.js');

const panel = (n) => ({ panel: n, scene: 'EXT. BEACH - DAY', visual: `A calm family on the beach, medium shot ${n}`, dialogue: 'Line "quoted" {braces} [brackets]', hero: n === 1 });
const panels = (n) => Array.from({ length: n }, (_, i) => panel(i + 1));
const json = (n) => JSON.stringify(panels(n));

test('parse: bare array, fenced array, prose-wrapped array, {panels:[...]} wrapper', () => {
  assert.equal(parseStoryboard(json(6)).how, 'direct');
  assert.equal(parseStoryboard('```json\n' + json(6) + '\n```').how, 'fenced');
  assert.equal(parseStoryboard('Here is the storyboard:\n' + json(6) + '\nHope it helps!').how, 'slice');
  const w = parseStoryboard(JSON.stringify({ panels: panels(5) }));
  assert.equal(w.how, 'direct'); assert.equal(w.panels.length, 5);
  assert.equal(parseStoryboard('```json\n' + JSON.stringify({ panels: panels(5) }) + '\n```').panels.length, 5);
  assert.equal(parseStoryboard(JSON.stringify({ frames: panels(5) })).panels.length, 5);   // any single array-of-objects field is accepted
});

test('extractPanels keeps its old contract: the array, or null', () => {
  assert.equal(extractPanels(json(7)).length, 7);
  assert.equal(extractPanels(JSON.stringify({ panels: panels(6) })).length, 6);
  assert.equal(extractPanels('I cannot do that.'), null);
  assert.equal(extractPanels(''), null);
  assert.equal(extractPanels(undefined), null);
  assert.equal(extractPanels('[]'), null);
  assert.equal(extractPanels('{"panels":[]}'), null);
});

test('SALVAGE: an array cut off mid-panel keeps the complete panels (>= 4)', () => {
  const full = json(7);
  const cutAt = (n, extra = 25) => full.slice(0, full.indexOf(`{"panel":${n}`) + extra);
  for (const [n, kept] of [[7, 6], [6, 5], [5, 4]]) {
    const r = parseStoryboard(cutAt(n));
    assert.equal(r.how, 'salvaged', `cut inside panel ${n}`);
    assert.equal(r.panels.length, kept);
    assert.deepEqual(r.panels.map((p) => p.panel), Array.from({ length: kept }, (_, i) => i + 1));
  }
  // cut right after a complete panel's closing brace
  const exact = full.slice(0, full.indexOf('{"panel":6') - 1);
  assert.equal(parseStoryboard(exact).panels.length, 5);
});

test('SALVAGE: below the minimum (< 4 complete panels) it is NOT accepted', () => {
  assert.equal(MIN_SALVAGE, 4);
  const full = json(7);
  assert.equal(parseStoryboard(full.slice(0, full.indexOf('{"panel":4') + 20)), null);   // 3 complete
  assert.equal(parseStoryboard(full.slice(0, full.indexOf('{"panel":2') + 20)), null);   // 1 complete
  assert.equal(parseStoryboard('[{"panel":1,"visual":"x"'), null);
  assert.equal(parseStoryboard(full.slice(0, full.indexOf('{"panel":4') + 20), { minSalvage: 3 }).panels.length, 3);   // the threshold is a parameter
});

test('SALVAGE: truncation inside a {panels:[...]} wrapper, fenced output, and text before the array', () => {
  const w = JSON.stringify({ panels: panels(7) });
  const cut = w.slice(0, w.indexOf('{"panel":6') + 30);
  const r = parseStoryboard(cut);
  assert.equal(r.how, 'salvaged'); assert.equal(r.panels.length, 5);
  const fencedCut = '```json\n' + json(7).slice(0, json(7).indexOf('{"panel":6') + 30);
  assert.equal(parseStoryboard(fencedCut).panels.length, 5);
  const prose = 'Sure! Here you go:\n' + json(7).slice(0, json(7).indexOf('{"panel":5') + 30);
  assert.equal(parseStoryboard(prose).panels.length, 4);
});

test('SALVAGE is string-aware: braces, brackets, quotes and escapes inside text never confuse the scan', () => {
  const tricky = Array.from({ length: 5 }, (_, i) => ({ panel: i + 1, scene: 'S', visual: `He says "}{][" and \\ backslash ${i}`, dialogue: 'a } b { c ] d [ "q"', hero: false }));
  const text = JSON.stringify(tricky);
  const cut = text.slice(0, text.lastIndexOf('{"panel":5') + 18);
  const r = parseStoryboard(cut);
  assert.equal(r.how, 'salvaged'); assert.equal(r.panels.length, 4);
  assert.equal(r.panels[3].dialogue, 'a } b { c ] d [ "q"');
});

test('SALVAGE ignores objects without a visual and malformed objects, caps at 7', () => {
  const objs = [panel(1), { panel: 2, scene: 'x' }, panel(3), panel(4), panel(5), panel(6), panel(7), panel(8), panel(9)];
  const text = JSON.stringify(objs).slice(0, -3);   // truncated end
  const r = parseStoryboard(text);
  assert.equal(r.how, 'salvaged');
  assert.ok(r.panels.every((p) => p.visual));
  assert.ok(r.panels.length <= 7);
  assert.deepEqual(completeObjects('[{"a":1},{"b":2},{"c":'), [{ a: 1 }, { b: 2 }]);
  assert.deepEqual(completeObjects('[{"a":1}, {bad json}, {"c":3}]'), [{ a: 1 }, { c: 3 }]);
});

test('Hebrew output (token-heavy) and unicode survive parse and salvage', () => {
  const he = Array.from({ length: 6 }, (_, i) => ({ panel: i + 1, scene: 'פנים. מטבח - בוקר', visual: `A calm woman by a window, soft light ${i}`, dialogue: 'היום הכל השתנה', hero: false }));
  const t = JSON.stringify(he);
  assert.equal(parseStoryboard(t).panels[0].dialogue, 'היום הכל השתנה');
  assert.equal(parseStoryboard(t.slice(0, t.lastIndexOf('{"panel":6') + 20)).panels.length, 5);
});

test('schemas: Gemini array schema and the OpenRouter strict json_schema with an object root + {panels} wrapper', () => {
  assert.equal(GEMINI_RESPONSE_SCHEMA.type, 'ARRAY');
  assert.deepEqual(GEMINI_RESPONSE_SCHEMA.items.required, ['panel', 'scene', 'visual', 'dialogue', 'hero']);
  assert.equal(GEMINI_RESPONSE_SCHEMA.maxItems, 7);
  const rf = OPENROUTER_RESPONSE_FORMAT;
  assert.equal(rf.type, 'json_schema'); assert.equal(rf.json_schema.strict, true); assert.equal(rf.json_schema.name, 'storyboard');
  assert.equal(rf.json_schema.schema.type, 'object');                                      // a strict root must be an object
  assert.deepEqual(rf.json_schema.schema.required, ['panels']);
  assert.equal(rf.json_schema.schema.properties.panels.type, 'array');
  assert.equal(rf.json_schema.schema.additionalProperties, false);
  assert.deepEqual(rf.json_schema.schema.properties.panels.items.required, ['panel', 'scene', 'visual', 'dialogue', 'hero']);
  // what a model returns under that schema parses
  assert.equal(parseStoryboard(JSON.stringify({ panels: panels(6) })).panels.length, 6);
});
