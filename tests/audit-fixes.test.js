import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SYSTEM_PROMPT, buildScriptPrompt } from '../lib/agent.js';

const modal = readFileSync(new URL('../components/CharacterModal.jsx', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

test('the Star Yourself 18+ step says nothing that invites a minor to carry on, and the checkbox is gender-neutral', () => {
  assert.doesNotMatch(modal, /Not 18|לא בן\/בת 18|No problem|אין בעיה/i);
  assert.match(modal, /אני בן\/בת 18 ומעלה/);
  assert.doesNotMatch(modal, /'אני בן 18 ומעלה'/);
});

test('the script prompt forbids invented backstory / tragedy and makes the writer the protagonist, in the system prompt and the final reminder (he + en)', () => {
  assert.match(SYSTEM_PROMPT, /STORY FIDELITY/);
  assert.match(SYSTEM_PROMPT, /NEVER invent death, grief, mourning, illness/);
  assert.match(SYSTEM_PROMPT, /person who wrote the entry/);
  for (const [text, re] of [['I walked the dog in the park today and it was fun.', /STORY FIDELITY: the protagonist is the person who wrote the entry/], ['טיילתי עם הכלב בפארק והיה כיף.', /נאמנות לסיפור/]]) {
    const { messages } = buildScriptPrompt(text, 'drama');
    assert.match(messages[messages.length - 1].content, re);
  }
});
