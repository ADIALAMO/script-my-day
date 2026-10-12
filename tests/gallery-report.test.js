import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis._redisClient = {};   // lib/report.js imports the Redis client at load time; nothing here reaches it
process.env.R2_PUBLIC_URL = 'https://pub-test.r2.dev';
const { resolveGalleryRef, galleryRefId, filterVisibleGallery } = await import('../lib/gallery-report.js');
const { parseRef } = await import('../lib/report.js');
const { SHOWCASE_POSTERS, SHOWCASE_REELS } = await import('../constants/showcase.js');
const { markReported, reportedGalleryRefs } = await import('../utils/reported-store.js');
const { REPORT_COPY } = await import('../constants/report-copy.js');

const poster = SHOWCASE_POSTERS.find((p) => p.src);
const reel = SHOWCASE_REELS.find((r) => r.src);

test('gallery refs: a real poster id and a real reel id resolve; the path comes from OUR list', () => {
  const p = resolveGalleryRef(galleryRefId('poster', poster.id));
  assert.deepEqual(p, { id: `poster:${poster.id}`, paths: [poster.src] });
  const r = resolveGalleryRef(galleryRefId('reel', reel.id));
  assert.equal(r.id, `reel:${reel.id}`); assert.ok(r.paths.includes(reel.src));
});

test('gallery refs: every poster with an image and every reel is reportable; text-only posters are not', () => {
  for (const p of SHOWCASE_POSTERS) assert.equal(Boolean(resolveGalleryRef(galleryRefId('poster', p.id))), Boolean(p.src), `poster ${p.id}`);
  for (const r of SHOWCASE_REELS) assert.ok(resolveGalleryRef(galleryRefId('reel', r.id)), `reel ${r.id}`);
});

test('gallery refs: unknown ids, traversal, paths, URLs and non-strings are refused', () => {
  const bad = ['poster:999999', 'reel:nope', 'poster:', 'poster', '49', '../etc/passwd', 'poster:../49', 'poster:49/../../x', '/gallery/sample-2.webp', 'gallery/comics/toon-01.webp',
    'https://evil.example/x.png', 'poster:49\n', ' poster:49', 'POSTER:49', `poster:${'1'.repeat(60)}`, 'poster:49;rm', '', null, undefined, 49, {}, [], ['poster:49'], { gallery: 'poster:49' }];
  for (const b of bad) assert.equal(resolveGalleryRef(b), null, JSON.stringify(b));
  // the removed comic (toon-07, id 64) can no longer be reported — it is gone from the list
  assert.equal(resolveGalleryRef('poster:64'), null);
});

test('parseRef: { gallery } is a lookup key only — an extra "path" field is ignored, and url/hash win over it; garbage is null', () => {
  const ok = parseRef({ gallery: galleryRefId('poster', poster.id), path: '/etc/passwd', paths: ['/x'] });
  assert.deepEqual(ok, { kind: 'gallery', id: `poster:${poster.id}`, paths: [poster.src] });
  assert.equal(parseRef({ gallery: 'poster:49', url: 'https://pub-test.r2.dev/panels/x.png' })?.kind, 'key', 'a ref with a url is handled as a url, never as a gallery item');
  assert.equal(parseRef({ gallery: 'poster:49', hash: 'a'.repeat(64) })?.kind, 'hash');
  assert.equal(parseRef({ gallery: '../../x' }), null);
  assert.equal(parseRef({ gallery: 'poster:nope' }), null);
  assert.equal(parseRef({ gallery: 5 }), null);
});

test('local hide: reported refs are remembered ("gallery:<ref>") and the filter drops exactly those items', () => {
  const ref = galleryRefId('poster', poster.id);
  assert.equal(reportedGalleryRefs().has(ref), false);
  markReported([`gallery:${ref}`]);
  assert.equal(reportedGalleryRefs().has(ref), true);
  const set = new Set([ref]);
  const out = filterVisibleGallery(SHOWCASE_POSTERS, 'poster', set);
  assert.equal(out.length, SHOWCASE_POSTERS.length - 1);
  assert.ok(!out.some((p) => p.id === poster.id));
  assert.equal(filterVisibleGallery(SHOWCASE_REELS, 'reel', set).length, SHOWCASE_REELS.length, 'a poster ref never hides a reel');
  assert.equal(filterVisibleGallery(SHOWCASE_POSTERS, 'poster', new Set()), SHOWCASE_POSTERS, 'nothing reported → same list');
});

test('report copy: every string exists in he AND en, and the gallery texts claim hiding for the user only (never removal for everyone)', () => {
  const walk = (o, path) => {
    if (o && typeof o === 'object' && ('en' in o || 'he' in o)) {
      assert.ok(typeof o.en === 'string' && o.en.trim(), `${path}.en`); assert.ok(typeof o.he === 'string' && o.he.trim(), `${path}.he`);
      return;
    }
    for (const [k, v] of Object.entries(o)) walk(v, `${path}.${k}`);
  };
  walk(REPORT_COPY, 'REPORT_COPY');
  for (const k of ['introGallery', 'doneGallery']) {
    assert.match(REPORT_COPY[k].en, /for you/); assert.match(REPORT_COPY[k].he, /עבורך/);
    assert.doesNotMatch(REPORT_COPY[k].en, /removed|deleted|for everyone|for all/i);
  }
});
