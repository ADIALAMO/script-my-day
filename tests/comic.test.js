import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryRedis } from './helpers/memory-redis.js';

const mem = createMemoryRedis();
global._redisClient = mem;

const { reserveComicQuota, releaseComicQuota, unlockedPanelsForNewComic, comicQuotaKey } = await import('../lib/comic-quota.js');
const { guardComicPanel, openComicSession } = await import('../lib/comic-guard.js');
const { CODES } = await import('../lib/messages.js');
const { COMIC } = await import('../config/limits.js');

beforeEach(() => mem._store.clear());

// ── Comic quota ───────────────────────────────────────────────────────────────────────
test('defaults match the product decision', () => {
  assert.equal(COMIC.freePerMonth, 3);
  assert.equal(COMIC.freeFirstComicPanels, 7);
  assert.equal(COMIC.freeLaterComicPanels, 3);
  assert.equal(COMIC.regenLimit, 2);
});

test('free: 3 comics per MONTH, 4th refused with period=month; key is monthly', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await reserveComicQuota('free', 'u:a')).ok, true);
  const r = await reserveComicQuota('free', 'u:a');
  assert.equal(r.ok, false);
  assert.equal(r.period, 'month');
  assert.match(comicQuotaKey('free', 'u:a'), /^usage:comic:u:a:\d{4}-\d{2}$/);
});

test('pro: per DAY window; admin unlimited; anonymous never', async () => {
  assert.match(comicQuotaKey('pro', 'u:p'), /^usage:comic:u:p:\d{4}-\d{2}-\d{2}$/);
  assert.equal((await reserveComicQuota('pro', 'u:p')).ok, true);
  assert.equal((await reserveComicQuota('pro', 'u:p')).ok, true);
  assert.equal((await reserveComicQuota('pro', 'u:p')).ok, false); // current behavior: 2/day
  assert.equal((await reserveComicQuota('admin', 'u:adm')).ok, true);
  assert.equal((await reserveComicQuota('anonymous', 'ip:1')).ok, false);
});

test('comic reservation is atomic under concurrency and releasable', async () => {
  const rs = await Promise.all(Array.from({ length: 15 }, () => reserveComicQuota('free', 'u:race')));
  assert.equal(rs.filter((r) => r.ok).length, 3);
  const ok = rs.find((r) => r.ok);
  await releaseComicQuota(ok.key);
  assert.equal((await reserveComicQuota('free', 'u:race')).ok, true);
});

test('free: first comic ever unlocks all 7 panels, later comics 3; pro always 7', async () => {
  assert.equal(await unlockedPanelsForNewComic('free', 'u:f'), 7);
  assert.equal(await unlockedPanelsForNewComic('free', 'u:f'), 3);
  assert.equal(await unlockedPanelsForNewComic('free', 'u:f'), 3);
  assert.equal(await unlockedPanelsForNewComic('free', 'u:other'), 7);
  assert.equal(await unlockedPanelsForNewComic('pro', 'u:p'), 7);
});

// ── Panel guard ───────────────────────────────────────────────────────────────────────
const SEED = '1234567890';
async function open(unlocked = 3, owner = 'u:a') { await openComicSession(SEED, owner, unlocked); }
const g = (over = {}) => guardComicPanel({ tier: 'free', identifier: 'u:a', comicSeed: SEED, panelIndex: 0, ...over });

test('unknown / expired / foreign comic → 403 COMIC_SESSION_EXPIRED', async () => {
  let r = await g();
  assert.deepEqual([r.ok, r.status, r.code], [false, 403, CODES.COMIC_SESSION_EXPIRED]);
  await open(3, 'u:someone-else');
  r = await g();
  assert.equal(r.code, CODES.COMIC_SESSION_EXPIRED); // not leaked as "locked"
  r = await g({ comicSeed: '../bad key' });
  assert.equal(r.code, CODES.COMIC_SESSION_EXPIRED);
});

test('locked panels (index >= this comic\'s unlocked count) are refused', async () => {
  await open(3);
  assert.equal((await g({ panelIndex: 2 })).ok, true);
  const r = await g({ panelIndex: 3 });
  assert.deepEqual([r.ok, r.status], [false, 403]);
  assert.equal((await g({ panelIndex: -1 })).ok, false);
  assert.equal((await g({ panelIndex: 'abc' })).ok, false);
});

test('first image of each panel is free of the replace budget; repeats spend it; budget = 2', async () => {
  await open(7);
  for (let i = 0; i < 7; i++) assert.equal((await g({ panelIndex: i })).regen, false);
  let r = await g({ panelIndex: 0 }); assert.equal(r.ok, true); assert.equal(r.regen, true); // replacement 1
  r = await g({ panelIndex: 1 });     assert.equal(r.ok, true);                              // replacement 2
  r = await g({ panelIndex: 2 });
  assert.deepEqual([r.ok, r.status, r.code], [false, 429, CODES.QUOTA_PANEL_REGEN]);
  r = await g({ panelIndex: 0 });     // the same panel again, beyond the budget
  assert.equal(r.code, CODES.QUOTA_PANEL_REGEN);
});

test('hammering the SAME panel concurrently → at most 1 + regenLimit succeed', async () => {
  await open(7);
  const rs = await Promise.all(Array.from({ length: 25 }, () => g({ panelIndex: 4 })));
  assert.equal(rs.filter((r) => r.ok).length, 1 + COMIC.regenLimit);
});

test('a failed attempt (release) does not burn a replacement', async () => {
  await open(7);
  const first = await g({ panelIndex: 0 });
  await first.release();                         // provider cascade exhausted → placeholder
  const again = await g({ panelIndex: 0 });
  assert.equal(again.regen, false);              // still the "first" image of that panel
  const rep = await g({ panelIndex: 0 });
  await rep.release();
  assert.equal((await g({ panelIndex: 0 })).ok, true);
  assert.equal((await g({ panelIndex: 0 })).ok, true);
  assert.equal((await g({ panelIndex: 0 })).ok, false); // 1 first + 2 replacements, then stop
});

test('per-user daily panel cap across comics', async () => {
  const { PANELS_PER_DAY } = await import('../config/limits.js');
  await open(7);
  let blocked = null;
  for (let i = 0; i < PANELS_PER_DAY.free + 2 && !blocked; i++) {
    const seed = `s${i}`;
    await openComicSession(seed, 'u:a', 7);
    const r = await guardComicPanel({ tier: 'free', identifier: 'u:a', comicSeed: seed, panelIndex: 0 });
    if (!r.ok) blocked = r;
  }
  assert.equal(blocked?.code, CODES.QUOTA_PANEL_DAILY);
});

test('admin tier and anonymous', async () => {
  const a = await guardComicPanel({ tier: 'admin', identifier: 'u:x', comicSeed: undefined, panelIndex: 5 });
  assert.equal(a.ok, true);
  const n = await guardComicPanel({ tier: 'anonymous', identifier: 'ip:1', comicSeed: SEED, panelIndex: 0 });
  assert.deepEqual([n.ok, n.status, n.code], [false, 403, CODES.NEEDS_ACCOUNT]);
});

test('Redis down → fails open to the tier panel count (still refuses locked indexes)', async () => {
  const orig = global._redisClient.get;
  global._redisClient.get = async () => { throw new Error('down'); };
  try {
    assert.equal((await g({ panelIndex: 2 })).ok, true);
    assert.equal((await g({ panelIndex: 3 })).ok, false); // free "later" count is 3
  } finally { global._redisClient.get = orig; }
});

test('pro: monthly cap on top of the daily one — refusal returns both slots, release returns both, next month is fresh', async () => {
  const { comicMonthKey } = await import('../lib/comic-quota.js');
  assert.equal(COMIC.proPerMonth, 6);
  const { CODES: C } = await import('../lib/messages.js');
  assert.ok(C.QUOTA_COMIC_PRO_MONTH);
  const dayKey = comicQuotaKey('pro', 'u:pm');
  const monthKey = comicMonthKey('u:pm');
  // 6 comics over 6 "days": reset the day counter each time to simulate the daily window rolling
  for (let i = 0; i < 6; i++) {
    const r = await reserveComicQuota('pro', 'u:pm');
    assert.equal(r.ok, true, `#${i + 1}`);
    mem._store.delete(dayKey);
  }
  const refused = await reserveComicQuota('pro', 'u:pm');
  assert.equal(refused.ok, false);
  assert.equal(refused.period, 'pro-month');
  assert.equal(refused.limit, 6);
  assert.equal(mem._store.get(monthKey), '6');            // rolled back, not 7
  assert.ok(!mem._store.has(dayKey) || mem._store.get(dayKey) === '0'); // day slot returned too
  // release gives both back
  mem._store.set(monthKey, '5');
  const ok = await reserveComicQuota('pro', 'u:pm');
  assert.equal(ok.ok, true);
  await releaseComicQuota(ok);
  assert.equal(mem._store.get(monthKey), '5');
  assert.equal(mem._store.get(dayKey), '0');
});

test('monthly comic cap applies to Pro only', async () => {
  const { comicMonthlyLimit } = await import('../lib/comic-quota.js');
  assert.equal(comicMonthlyLimit('pro'), 6);
  assert.equal(comicMonthlyLimit('free'), Infinity);
  assert.equal(comicMonthlyLimit('admin'), Infinity);
});
