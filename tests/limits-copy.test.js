// Fails when a limit stated in user-facing copy differs from config/limits.js.
//   1. copy built by constants/limits-copy.js contains the live config numbers;
//   2. every "N scripts/posters/comics/uploads per day|month" (and Hebrew equivalents) found in the
//      user-facing source files uses a number that EXISTS in config for that feature and period.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { TIER_LIMITS, COMIC, SHEET_LIMITS, SCRIPT_MONTHLY_LIMITS } from '../config/limits.js';
import { LIMITS, termsPlansHe, termsPlansEn, faqPlansHe, faqPlansEn, proBlurbHe, proBlurbEn, checkoutDescription } from '../constants/limits-copy.js';
import { MODAL_DATA } from '../constants/modalData.js';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

test('LIMITS mirrors config exactly', () => {
  assert.equal(LIMITS.guestScriptsPerDay, TIER_LIMITS.anonymous.script);
  assert.equal(LIMITS.guestPosters, TIER_LIMITS.anonymous.poster);
  assert.equal(LIMITS.freeScriptsPerDay, TIER_LIMITS.free.script);
  assert.equal(LIMITS.freePostersPerDay, TIER_LIMITS.free.poster);
  assert.equal(LIMITS.freeComicsPerMonth, COMIC.freePerMonth);
  assert.equal(LIMITS.freeUploadsPerMonth, SHEET_LIMITS.free);
  assert.equal(LIMITS.proScriptsPerDay, TIER_LIMITS.pro.script);
  assert.equal(LIMITS.proScriptsPerMonth, SCRIPT_MONTHLY_LIMITS.pro);
  assert.equal(LIMITS.proPostersPerDay, TIER_LIMITS.pro.poster);
  assert.equal(LIMITS.proComicsPerDay, COMIC.proPerDay);
  assert.equal(LIMITS.proComicsPerMonth, COMIC.proPerMonth);
  assert.equal(LIMITS.proUploadsPerMonth, SHEET_LIMITS.pro);
});

test('the Pro plan copy states the daily AND monthly script/comic limits, in he + en, everywhere it is described', () => {
  const texts = { termsHe: termsPlansHe(), termsEn: termsPlansEn(), faqHe: faqPlansHe(), faqEn: faqPlansEn(), blurbHe: proBlurbHe(), blurbEn: proBlurbEn(), checkout: checkoutDescription() };
  for (const [name, text] of Object.entries(texts)) {
    for (const n of [LIMITS.proScriptsPerDay, LIMITS.proScriptsPerMonth, LIMITS.proComicsPerDay, LIMITS.proComicsPerMonth]) {
      assert.match(text, new RegExp(`(?<![\\d])${n}(?![\\d])`), `${name} must state ${n}`);
    }
  }
  const json = JSON.stringify(MODAL_DATA);
  assert.ok(json.includes(JSON.stringify(termsPlansHe()).slice(1, 80)) && json.includes(JSON.stringify(faqPlansEn()).slice(1, 80)), 'modalData uses the generated copy');
});

// ── scan for hard-coded numbers ─────────────────────────────────────────────────────────
const allowed = {
  'scripts/day':   new Set([TIER_LIMITS.anonymous.script, TIER_LIMITS.free.script, TIER_LIMITS.pro.script]),
  'scripts/month': new Set([SCRIPT_MONTHLY_LIMITS.pro]),
  'posters/day':   new Set([TIER_LIMITS.free.poster, TIER_LIMITS.pro.poster]),
  'comics/day':    new Set([COMIC.proPerDay]),
  'comics/month':  new Set([COMIC.freePerMonth, COMIC.proPerMonth]),
  'uploads/month': new Set([SHEET_LIMITS.free, SHEET_LIMITS.pro]),
};
const nouns = {
  scripts: '(?:scripts?|תסריטים)',
  posters: '(?:posters?|פוסטרים)',
  comics: '(?:comics?|comic books|קומיקסים)',
  uploads: '(?:face-photo uploads|uploads|העלאות תמונת פנים)',
};
const periods = { day: '(?:per day|a day|/day|ביום)', month: '(?:per month|a month|/month|בחודש)' };

function scan(label, text) {
  const found = [];
  // clause = text between , ; . ( ) newline; a "N <noun>" takes the first period word AFTER it in the same clause
  for (const clause of text.split(/[,;.()\n]/)) {
    for (const [noun, nre] of Object.entries(nouns)) {
      for (const m of clause.matchAll(new RegExp(`(?<![\\d$])(\\d{1,3})\\s+(?:full\\s+)?${nre}`, 'g'))) {
        const tail = clause.slice(m.index + m[0].length);
        const hits = Object.entries(periods).map(([per, pre]) => [per, tail.search(new RegExp(pre))]).filter(([, i]) => i >= 0).sort((x, y) => x[1] - y[1]);
        if (!hits.length) continue;
        const key = `${noun}/${hits[0][0]}`;
        if (allowed[key]) found.push({ key, n: Number(m[1]), at: m[0] + tail.slice(0, hits[0][1] + 8) });
      }
    }
  }
  for (const f of found) assert.ok(allowed[f.key].has(f.n), `${label}: "${f.at.trim()}" states ${f.n} ${f.key}, but config allows ${[...allowed[f.key]].join('/')}`);
  return found.length;
}

test('no user-facing file states a limit that config does not have', () => {
  let checked = 0;
  checked += scan('MODAL_DATA', JSON.stringify(MODAL_DATA).replace(/\\"/g, '"'));
  for (const f of readdirSync(new URL('components/', root)).filter((x) => x.endsWith('.jsx'))) checked += scan(`components/${f}`, read(`components/${f}`));
  for (const f of readdirSync(new URL('store-listing/', root)).filter((x) => x.endsWith('.md'))) checked += scan(`store-listing/${f}`, read(`store-listing/${f}`));
  for (const f of ['pages/api/checkout/index.js', 'pages/index.js', 'lib/messages.js']) checked += scan(f, read(f));
  assert.ok(checked >= 8, `scanner found only ${checked} statements — the regexes are probably broken`);
});

test('the scanner itself catches a wrong number', () => {
  assert.throws(() => scan('x', 'Pro: up to 25 scripts per day'), /25/);
  assert.throws(() => scan('x', 'במסלול Pro: 7 קומיקסים בחודש'), /7/);
  assert.doesNotThrow(() => scan('x', 'Pro: up to 20 scripts per day, 6 comics per month'));
});
