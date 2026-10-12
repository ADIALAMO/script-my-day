import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { needsTextClassifier, CONTENT_SAFETY_RULE, REGENERATION_SAFETY_LINE } = await import('../lib/content-safety.js');
const { checkTextOutput, storyboardText } = await import('../lib/text-check.js');
const { parseAgeVerdict, screenApparentMinor } = await import('../lib/minor-screen.js');
const { SYSTEM_PROMPT, buildScriptPrompt } = await import('../lib/agent.js');

test('the classifier runs for ROMANCE and HORROR only (any case, trimmed); every other genre is blocklist-only', () => {
  for (const g of ['romance', 'horror', 'Romance', ' HORROR ']) assert.equal(needsTextClassifier(g), true, g);
  for (const g of ['drama', 'comedy', 'action', 'sci-fi', '', undefined, null]) assert.equal(needsTextClassifier(g), false, String(g));
});

test('the horror prose rule is in the shared safety rule, in positive prose, and part of the script system prompt', () => {
  assert.match(CONTENT_SAFETY_RULE, /violence implied and non-graphic/);
  assert.match(CONTENT_SAFETY_RULE, /shadows, sound and reactions/);
  assert.ok(SYSTEM_PROMPT.includes(CONTENT_SAFETY_RULE));
  assert.ok(!/\b(no|avoid|without|never)\b/i.test(CONTENT_SAFETY_RULE.replace(/^CONTENT SAFETY[^:]*:/, '')), 'phrased as what to show, not as a list of negations');
  assert.ok(!/\b(no|avoid|without|never)\b/i.test(REGENERATION_SAFETY_LINE.replace(/^REMINDER:/, '')));
});

test('the regeneration line reaches the script prompt ONLY when asked for', () => {
  const plain = buildScriptPrompt('I walked along the beach with my family today', 'drama', 'medium', 'neutral');
  const again = buildScriptPrompt('I walked along the beach with my family today', 'drama', 'medium', 'neutral', REGENERATION_SAFETY_LINE);
  assert.ok(!JSON.stringify(plain.messages).includes('REMINDER: the previous draft'));
  assert.ok(JSON.stringify(again.messages).includes('REMINDER: the previous draft'));
  assert.equal(again.messages.length, plain.messages.length);
});

test('checkTextOutput without a classifier: clean text passes, blocklisted wording is held back (en + he), empty is unsafe — no network involved', async () => {
  assert.deepEqual(await checkTextOutput('INT. KITCHEN - DAY. Dana laughs with her friend over coffee.', { genre: 'drama' }), { verdict: 'safe', stage: 'blocklist' });
  const en = await checkTextOutput('SCENE 2. A nude woman walks along the shore.', { genre: 'comedy' });
  assert.equal(en.verdict, 'blocked'); assert.match(en.stage, /^blocklist:/);
  const he = await checkTextOutput('סצנה 1. אישה בעירום מלא הולכת בחוף.', { genre: 'action' });
  assert.equal(he.verdict, 'blocked');
  const minor = await checkTextOutput('A child and sexual content', { genre: 'drama' });
  assert.equal(minor.stage, 'blocklist:minor-sexual');
  assert.equal((await checkTextOutput('   ', { genre: 'drama' })).verdict, 'unsafe');
  assert.equal((await checkTextOutput(undefined, { genre: 'drama' })).verdict, 'unsafe');
});

test('a classifier genre with no time left is "unavailable" (fail-closed), never "safe" — and it does not call out', async () => {
  const r = await checkTextOutput('INT. CAFÉ - NIGHT. They talk until the café closes.', { genre: 'romance', budgetMs: 1000 });
  assert.deepEqual(r, { verdict: 'unavailable', stage: 'no-time' });
});

test('storyboardText joins scene, visual and dialogue of every panel and tolerates junk', () => {
  const t = storyboardText([{ scene: 'INT. HALL', visual: 'a calm person', dialogue: 'Hello', extra: 'ignored' }, { scene: 5, visual: 'x' }, null]);
  assert.match(t, /INT\. HALL\na calm person\nHello/); assert.ok(!t.includes('ignored'));
  assert.equal(storyboardText(undefined), '');
});

test('parseAgeVerdict — exact {"apparent_age": …} only; a refusal is "unsure", never "minor"', () => {
  const ok = (c, extra = {}) => ({ choices: [{ finish_reason: 'stop', message: { content: c }, ...extra }] });
  assert.equal(parseAgeVerdict(ok('{"apparent_age":"minor"}')), 'minor');
  assert.equal(parseAgeVerdict(ok('{"apparent_age":"adult"}')), 'adult');
  assert.equal(parseAgeVerdict(ok(' {"apparent_age": "unsure"} ')), 'unsure');
  for (const bad of ['minor', '{"age":"minor"}', '{"apparent_age":"child"}', '{"apparent_age":"minor","note":"x"}', '[]', '', null, 42, '{"apparent_age":["minor"]}']) assert.equal(parseAgeVerdict(ok(bad)), 'unknown', String(bad));
  assert.equal(parseAgeVerdict({ choices: [{ finish_reason: 'content_filter', message: { content: null } }] }), 'unsure');
  assert.equal(parseAgeVerdict({ choices: [{ message: { content: '{"apparent_age":"minor"}', refusal: 'I cannot' } }] }), 'unsure', 'a refusal is never turned into a rejection');
  assert.equal(parseAgeVerdict({}), 'unknown');
});

test('screenApparentMinor never rejects what is not an image data URI (and does not call out)', async () => {
  for (const v of [undefined, null, 'https://example.com/x.jpg', 'data:text/plain;base64,AAAA', 42]) assert.deepEqual(await screenApparentMinor(v), { reject: false, result: 'skipped' });
});

// "age verification" must never be claimed: wherever the phrase appears it is a denial
test('no copy, doc or comment claims age verification — every mention is a denial', () => {
  const walk = (dir) => readdirSync(path.join(ROOT, dir)).flatMap((f) => { const rel = `${dir}/${f}`; const st = statSync(path.join(ROOT, rel)); return st.isDirectory() ? walk(rel) : /\.(jsx?|md|mjs)$/.test(f) ? [rel] : []; });
  const files = [...['components', 'constants', 'pages', 'lib', 'hooks', 'store-listing'].flatMap(walk), 'CLAUDE.md'];
  const offenders = [];
  for (const rel of files) {
    readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      if (!/age[- ]verif|verif\w* (?:your |the user'?s? )?age|אימות גיל|מאמתים (?:את )?גיל/i.test(line)) return;
      if (!/\bnot\b|\bnever\b|\bNOT\b|לא |אינו|אינה|neither/i.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(offenders, []);
});

test('privacy text discloses the text classifier and the photo screen in both languages, and never as age verification', async () => {
  const { privacyProvidersEn, privacyProvidersHe } = await import('../constants/ai-provider-copy.js');
  const en = privacyProvidersEn(); const he = privacyProvidersHe();
  assert.match(en, /romance and horror scripts and comics is also checked by an automatic safety classifier/);
  assert.match(en, /clearly shows a child — a best-effort check that cannot confirm the age of anyone/);
  assert.match(he, /רומנטיים ואימה נבדק גם הוא על ידי מסווג בטיחות אוטומטי/);
  assert.match(he, /מציגה בבירור ילד — בדיקה מאמץ סביר שאינה יכולה לאשר את גילו של איש/);
  assert.doesNotMatch(en, /age verification/i);
});
