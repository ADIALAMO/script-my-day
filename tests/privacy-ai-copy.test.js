// Privacy §3 (accounts), §7 (external AI providers, free-tier Gemini disclosure) and §8 (sharing): wording guards.
// The Gemini tier is read from NEXT_PUBLIC_GEMINI_API_TIER at module load, so each case runs in its own node process.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url).pathname;
const render = (tier) => {
  const env = { ...process.env };
  delete env.NEXT_PUBLIC_GEMINI_API_TIER;
  if (tier !== undefined) env.NEXT_PUBLIC_GEMINI_API_TIER = tier;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const {MODAL_DATA:m}=await import('./constants/modalData.js');" +
    "const sec=(l,n)=>m.privacy[l].sections.find(s=>s.h.startsWith(n+'.')).p;" +
    "console.log(JSON.stringify({he7:sec('he',7),en7:sec('en',7),he3:sec('he',3),en3:sec('en',3),he8:sec('he',8),en8:sec('en',8),all:[m.privacy,m.terms].flatMap(d=>['he','en'].flatMap(l=>[d[l].title,d[l].summary||'',...d[l].sections.flatMap(x=>[x.h,x.p])])).join('\\n'),privSummaries:[m.privacy.he.summary,m.privacy.en.summary].join('\\n')}))"],
  { cwd: ROOT, env, encoding: 'utf8' });
  return JSON.parse(out);
};
const FREE_HE = /במסלול החינמי \(ללא תשלום\) של Gemini API[^.]*Google עשויה להשתמש בתוכן שנשלח כדי לשפר את מוצריה, ובודקים אנושיים עשויים לקרוא אותו/;
const FREE_EN = /free \(unpaid\) Gemini API tier[^.]*Google may use submitted content to improve its products and human reviewers may read it/;

test('default (variable unset) = free tier: §7 discloses it in Hebrew and English', () => {
  const r = render(undefined);
  assert.match(r.he7, FREE_HE);
  assert.match(r.en7, FREE_EN);
});

test('NEXT_PUBLIC_GEMINI_API_TIER=free behaves like the default; an unknown value falls back to the conservative free wording', () => {
  for (const v of ['free', 'FREE', 'yes', '']) {
    const r = render(v);
    assert.match(r.he7, FREE_HE, `he, value "${v}"`);
    assert.match(r.en7, FREE_EN, `en, value "${v}"`);
  }
});

test("NEXT_PUBLIC_GEMINI_API_TIER=paid removes the free-tier sentence in both languages, the rest of §7 stays", () => {
  const r = render('paid');
  assert.doesNotMatch(r.he7, /ללא תשלום|בודקים אנושיים/);
  assert.doesNotMatch(r.en7, /free \(unpaid\)|human reviewers/);
  for (const [lang, t] of [['he', r.he7], ['en', r.en7]]) {
    for (const name of ['Google', 'OpenRouter', 'Cloudflare', 'Cohere', 'Pollinations']) assert.ok(t.includes(name), `${lang}: ${name}`);
    assert.match(t, lang === 'he' ? /תמונת הפנים/ : /face photo/);
  }
  assert.match(r.en7, /\(a\) Google \(Gemini API\) receives your text to create scripts and the comic plan\. \(b\) OpenRouter/);
});

test('no bracketed internal note or TODO/owner remark appears in any user-visible policy or terms text, either value', () => {
  for (const v of [undefined, 'paid']) {
    const t = render(v).all;
    assert.doesNotMatch(t, /\[[^\]]*\]/, 'no [bracketed] text');
    assert.doesNotMatch(t, /OWNER-CONFIRM|\bTODO\b|REMOVE THIS|\bDRAFT\b/);
  }
});

test('§7 is honest in both languages: names the providers, no retention promise, sensitive-data warning, no ad/sale use', () => {
  const r = render(undefined);
  assert.match(r.en7, /cannot promise that your content is not retained/);
  assert.match(r.he7, /איננו יכולים להבטיח שהתוכן שלך אינו נשמר/);
  assert.match(r.en7, /Do not enter highly sensitive information/);
  assert.match(r.he7, /אל תזין מידע רגיש במיוחד/);
  assert.match(r.en7, /do not sell your content or use it for advertising/);
});

test('§3 no longer claims email/name/avatar is the ONLY personal data; §8 no longer says inputs are not shared', () => {
  const r = render(undefined);
  assert.doesNotMatch(r.en3, /only personally identifying/i);
  assert.doesNotMatch(r.he3, /המידע המזהה אישית היחיד/);
  assert.match(r.en3, /other personal data described in sections 2, 4, 5 and 6/);
  assert.match(r.he3, /מידע אישי נוסף המתואר בסעיפים 2, 4, 5 ו-6/);
  assert.doesNotMatch(r.en8, /do not sell, share, or repurpose/i);
  assert.doesNotMatch(r.he8, /לא משתפים ולא מעבדים/);
  assert.match(r.en8, /only with the service providers/);
  assert.match(r.he8, /רק עם ספקי השירות/);
});

test('privacy header says October 2026 in both languages', () => {
  const r = render(undefined);
  assert.match(r.privSummaries, /עודכן אוקטובר 2026/);
  assert.match(r.privSummaries, /Updated October 2026/);
  assert.doesNotMatch(r.privSummaries, /יוני 2026|June 2026/);
});

test('the variable is documented in .env.example with both values explained', () => {
  const env = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
  assert.match(env, /^NEXT_PUBLIC_GEMINI_API_TIER=free$/m);
  assert.match(env, /'paid'/);
});
