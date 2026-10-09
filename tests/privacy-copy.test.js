// The privacy / terms wording is a DRAFT pending owner confirmation (see the TODO in constants/modalData.js).
// Guard: it must never promise "no retention" / "not stored" by third-party AI providers, which we cannot verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MODAL_DATA } from '../constants/modalData.js';

test('no unverifiable no-retention / no-training promise about AI providers, in either language', () => {
  const text = JSON.stringify({ p: MODAL_DATA.privacy, t: MODAL_DATA.terms });
  assert.doesNotMatch(text, /אינם שומרים|אינו שומר|לא שומרים את התוכן|do(es)? not (store|retain|keep) your|no retention|zero retention|never retain/i);
});

test('privacy text names the provider categories, says content is sent to them, in he + en', () => {
  for (const lang of ['he', 'en']) {
    const s7 = MODAL_DATA.privacy[lang].sections.find((s) => /^7\./.test(s.h));
    for (const name of ['Google', 'OpenRouter', 'Cloudflare']) assert.ok(s7.p.includes(name), `${lang}: ${name}`);
    assert.match(s7.p, lang === 'he' ? /תמונת הפנים/ : /face photo/);
  }
});

test('the owner-confirmation TODO stays in the source until the text is final', () => {
  assert.match(readFileSync(new URL('../constants/modalData.js', import.meta.url), 'utf8'), /TODO\(OWNER-CONFIRM/);
});
