// The temporary reel-crash diagnostics are gone (no route, no client sender, no breadcrumbs, no rate-limit buckets); the leftover trail key is cleared once;
// the low-end reel tier it led to STAYS (it is the fix, not a diagnostic).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const walk = (dir) => readdirSync(path.join(ROOT, dir)).flatMap((f) => { const rel = `${dir}/${f}`; return statSync(path.join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(jsx?|mjs|json)$/.test(f) ? [rel] : []; });

test('no diagnostics code, route or sender remains', () => {
  assert.equal(existsSync(path.join(ROOT, 'pages/api/reel-diagnostic.js')), false);
  assert.equal(existsSync(path.join(ROOT, 'utils/reel-diagnostics.js')), false);
  const hits = [];
  for (const rel of ['components', 'pages', 'hooks', 'utils', 'lib'].flatMap(walk)) {
    readFileSync(path.join(ROOT, rel), 'utf8').split('\n').forEach((line, i) => {
      if (/TEMP DIAGNOSTIC|reelBreadcrumb|recoverOrphanedReelTrail|reel-diagnostic|sendBeacon|comicCompletedAtRef|comicSource/.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 80)}`);
    });
  }
  assert.deepEqual(hits, []);
});

test('the leftover trail is cleared once at app start', () => {
  assert.match(readFileSync(path.join(ROOT, 'pages/_app.js'), 'utf8'), /localStorage\.removeItem\('lifescript_reel_trail_temp'\)/);
});

test('the low-end reel tier (the actual fix) is still there', () => {
  const m = readFileSync(path.join(ROOT, 'components/MovieReelModal.jsx'), 'utf8');
  assert.match(m, /const LOW_TIER = \{/); assert.match(m, /function resolveReelTier\(\)/); assert.match(m, /const tier = resolveReelTier\(\);/);
  assert.match(m, /async function loadPanelImageLowTier\(url\)/);
  assert.match(m, /reel_tier: tier\.key/);   // still reported in the existing aggregate Vercel event
});
