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

// ── retention numbers in the wording must be the ones the code enforces (config/limits.js) ──────────
import { execFileSync } from 'node:child_process';
import { RETENTION, GUEST_RETENTION, COMIC } from '../config/limits.js';

const enforced = () => new Set([RETENTION.characterPointerDays, RETENTION.deletionLogDays, RETENTION.referralCookieDays, GUEST_RETENTION.ipDays, Math.round(COMIC.sessionTtlSec / 3600)]);
const UNIT = /(\d+)\s*(?:days?|hours?|ימים|יום|שעות)/gi;

test('every "N days/hours" in the privacy and terms text is a retention value that exists in config/limits.js', () => {
  const text = JSON.stringify({ p: MODAL_DATA.privacy, t: MODAL_DATA.terms });
  const found = [...text.matchAll(UNIT)].map((m) => Number(m[1]));
  assert.ok(found.length >= 6, `expected several retention statements, found ${found.length}`);
  for (const n of found) assert.ok(enforced().has(n), `privacy/terms state a retention of ${n} that config/limits.js does not enforce (allowed: ${[...enforced()].join(', ')})`);
});

test('the face-photo sections state the pointer retention from config, say the original is deleted, and give R2 NO invented period', () => {
  for (const lang of ['he', 'en']) {
    const s2 = MODAL_DATA.privacy[lang].sections.find((s) => /^2\./.test(s.h)).p;
    const t5 = MODAL_DATA.terms[lang].sections.find((s) => /^5\./.test(s.h)).p;
    for (const s of [s2, t5]) {
      assert.ok(s.includes(String(RETENTION.characterPointerDays)), `${lang}: pointer days`);
      assert.deepEqual([...s.matchAll(UNIT)].map((m) => Number(m[1])), [RETENTION.characterPointerDays], `${lang}: the only period named is the Redis pointer`);
      assert.match(s, lang === 'he' ? /המקורית נמחקת/ : /original (face )?photo is deleted/);
      assert.match(s, lang === 'he' ? /אין(?: כרגע)? מחיקה אוטומטית|ללא מחיקה אוטומטית/ : /no automatic deletion/);
      assert.match(s, lang === 'he' ? /ידנית/ : /manually/);
    }
  }
});

test('changing the retention in config changes the wording (nothing is hard-coded): CHARACTER_POINTER_DAYS=45', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "const m=await import('./constants/modalData.js');const d=m.MODAL_DATA;console.log(JSON.stringify([d.privacy.en.sections[1].p,d.terms.he.sections[4].p]))"],
  { cwd: new URL('..', import.meta.url).pathname, env: { ...process.env, CHARACTER_POINTER_DAYS: '45' }, encoding: 'utf8' });
  const [en, he] = JSON.parse(out);
  assert.match(en, /45 days/); assert.doesNotMatch(en, /90 days/);
  assert.match(he, /45 ימים/);
});
