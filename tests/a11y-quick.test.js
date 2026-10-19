import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toHtmlLang } from '../utils/document-lang.js';
import { MODAL_DATA } from '../constants/modalData.js';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const code = (p) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('html lang follows the UI language; the document default is the home page default (en)', () => {
  assert.equal(toHtmlLang('he'), 'he'); assert.equal(toHtmlLang('en'), 'en'); assert.equal(toHtmlLang(undefined), 'en');
  assert.match(src('pages/_document.js'), /<Html lang="en"/);
  for (const p of ['pages/index.js', 'components/LegalPage.jsx', 'components/DataDeletionPage.jsx']) assert.match(src(p), /useDocumentLang\(lang\)/, p);
});

test('story textarea and creator input have accessible names; the credit label is tied to its input', () => {
  const f = src('components/ScriptForm.jsx');
  assert.match(f, /aria-label=\{lang === 'he' \? 'הסיפור או היום שלך' : 'Your story or your day'\}/);
  assert.match(f, /htmlFor="creator-credit"/); assert.match(f, /id="creator-credit"/);
  for (const [p, re] of [['components/AuthModal.jsx', /aria-label=\{isHe \? 'כתובת המייל שלך'/], ['components/DataDeletionPage.jsx', /aria-label=\{t\.notePh\}/], ['components/WaitlistModal.jsx', /aria-label=\{isHe \? 'האימייל שלך'/], ['pages/index.js', /aria-label=\{lang === 'he' \? 'המשוב שלך'/], ['components/ScriptOutput.jsx', /aria-label=\{isHebrew \? 'עריכת התסריט'/]]) assert.match(src(p), re, p);
});

test('skip link is the first element before <main> and its target exists', () => {
  const app = src('pages/_app.js');
  assert.ok(app.indexOf('<SkipLink />') > 0 && app.indexOf('<SkipLink />') < app.indexOf('<main'));
  assert.match(src('pages/index.js'), /<main id="main-content"/);
  assert.match(src('components/SkipLink.jsx'), /Skip to content/); assert.match(src('components/SkipLink.jsx'), /דלג לתוכן/);
});

test('compact Report button: at least 24px (p-2 around an 11px icon) with a ~45px hit area, unless a caller sets its own padding', () => {
  const r = code('components/ReportButton.jsx');
  assert.match(r, /compact \? `p-2 /); assert.match(r, /after:-inset-\[9px\]/); assert.match(r, /!p-/);
});

test('every real <img> has an alt, and the generated poster / panels have descriptive bilingual alts', () => {
  assert.doesNotMatch(src('components/PosterRenderer.jsx'), /alt="Movie Poster"/);
  assert.match(src('components/PosterRenderer.jsx'), /AI-generated movie poster/);
  assert.match(src('components/StoryboardView.jsx'), /AI-generated comic panel \$\{panel\.panel\} of \$\{panels\.length\}/);
});

test('cookie banner names the cookie-free Vercel counts and the decline button says Google Analytics (he + en)', () => {
  const c = src('components/CookieConsent.jsx');
  assert.match(c, /anonymous cookie-free visit counts \(Vercel\)\. You can decline Google Analytics below/);
  assert.match(c, /ובספירת ביקורים אנונימית וללא עוגיות \(Vercel\)/);
  assert.match(c, /Decline Google Analytics/); assert.match(c, /לדחות את Google Analytics/);
  assert.doesNotMatch(c, /Decline analytics and continue|Essential only/);
  assert.match(src('pages/index.js'), /<Analytics \/>/);   // wiring untouched: unconditional, as disclosed in Privacy §5
});

test('accessibility statement: general aim, no itemized gaps, no high-contrast claim', () => {
  for (const lang of ['he', 'en']) {
    const s = MODAL_DATA.accessibility[lang].sections.find((x) => /5568/.test(x.p)).p;
    assert.doesNotMatch(s, /contrast|ניגודיות|label|תווית|focus|alt\b/i);
    assert.ok(s.length < 260, `${lang}: short and general`);
  }
  assert.match(MODAL_DATA.accessibility.en.sections.find((x) => /5568/.test(x.p)).p, /aims to follow the recommendations of Israeli Standard SI 5568 and WCAG 2\.0 Level AA/);
});
