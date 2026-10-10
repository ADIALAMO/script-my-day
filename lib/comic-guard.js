/**
 * Server-side guard for comic PANEL images (requestType 'comic' in pages/api/generate-poster.js).
 *
 * Before this existed the route only checked `panelIndex < unlockedPanels`, so the same panel
 * could be generated again and again (the "Replace" limit lived in the browser only).
 *
 * Model — a comic is "opened" by generate-storyboard.js, which stores
 *   comic:meta:<comicSeed> = { o: <owner identifier>, u: <unlocked panels> }   (TTL 24h)
 * and every panel request must then pass, in order:
 *   1. owner match + panel index below that comic's unlocked count   (else 403)
 *   2. a per-user DAILY panel cap across all comics                  (else 429 QUOTA_PANEL_DAILY)
 *   3. per-panel + per-comic counters: the first image of a panel is free of the replace
 *      budget; every further image of the SAME panel spends one of COMIC.regenLimit
 *      replacements for the whole comic                              (else 429 QUOTA_PANEL_REGEN)
 * All counters are reserved atomically (INCR then compare, rolled back on refusal) and given back
 * with release() when no image was produced (provider cascade exhausted) — a failed attempt never
 * burns a replacement. Redis trouble fails OPEN to the tier's conservative panel count (the
 * route is still rate-limited and budget-capped), like the rest of the quota system.
 */
import redis from './redis.js';
import { nextMidnightUTC, isValidComicSeed } from './api-utils.js';
import { CODES } from './messages.js';
import { limitFor } from './quota.js';
import { COMIC, PANELS_PER_DAY } from '../config/limits.js';

const metaKey  = (seed) => `comic:meta:${seed}`;
const panelKey = (seed, idx) => `comic:pc:${seed}:${idx}`;
const regenKey = (seed) => `comic:rg:${seed}`;
const dailyKey = (identifier) => `usage:panels:${identifier}:${new Date().toISOString().split('T')[0]}`;

/** Called by generate-storyboard.js after a successful storyboard. Best-effort. */
export async function openComicSession(comicSeed, identifier, unlockedPanels) {
  if (!isValidComicSeed(comicSeed)) return false;
  try {
    await redis.set(metaKey(comicSeed), JSON.stringify({ o: identifier, u: unlockedPanels }), { ex: COMIC.sessionTtlSec });
    return true;
  } catch (e) {
    console.warn(`⚠️ Comic session not recorded (Redis unavailable): ${e.message}`);
    return false;
  }
}

async function incrWithTtl(key, ttlSec, expireAt) {
  const pipe = redis.pipeline();
  pipe.incr(key);
  if (expireAt) pipe.expireat(key, expireAt); else pipe.expire(key, ttlSec);
  const results = await pipe.exec();
  const n = parseInt(Array.isArray(results) ? results[0] : NaN, 10);
  if (!Number.isFinite(n)) throw new Error('counter returned no value');
  return n;
}

const decr = (key) => redis.decr(key).catch(() => {});
const deny = (status, code) => ({ ok: false, status, code });

/**
 * @returns {{ok:true, release:()=>Promise<void>, regen:boolean}
 *          |{ok:false, status:number, code:string}}
 */
export async function guardComicPanel({ tier, identifier, comicSeed, panelIndex }) {
  const noop = { ok: true, regen: false, release: async () => {} };

  const idx = Number.isFinite(panelIndex) ? panelIndex : parseInt(panelIndex, 10);
  if (!Number.isInteger(idx) || idx < 0) return deny(403, CODES.NEEDS_ACCOUNT);

  // Unlimited tiers (session admin) skip the accounting entirely.
  if (limitFor(tier, 'unlockedPanels') === Infinity) return noop;

  if (limitFor(tier, 'unlockedPanels') === 0) return deny(403, CODES.NEEDS_ACCOUNT); // anonymous
  if (!isValidComicSeed(comicSeed)) return deny(403, CODES.COMIC_SESSION_EXPIRED);

  let unlocked;
  try {
    const raw = await redis.get(metaKey(comicSeed));
    if (!raw) return deny(403, CODES.COMIC_SESSION_EXPIRED);
    const meta = typeof raw === 'object' ? raw : JSON.parse(raw);
    if (meta.o !== identifier) return deny(403, CODES.COMIC_SESSION_EXPIRED); // someone else's comic
    unlocked = Number.isFinite(meta.u) ? meta.u : limitFor(tier, 'unlockedPanels');
  } catch (e) {
    console.warn(`⚠️ Comic session unverifiable (Redis unavailable) — failing open to the tier panel count: ${e.message}`);
    return idx >= limitFor(tier, 'unlockedPanels') ? deny(403, CODES.NEEDS_ACCOUNT) : noop;
  }
  if (idx >= unlocked) return deny(403, CODES.NEEDS_ACCOUNT); // locked panel

  const taken = []; // keys we incremented, rolled back by release() / on refusal
  const rollback = async () => { await Promise.all(taken.map(decr)); };
  try {
    // (2) per-user daily panel cap
    const cap = PANELS_PER_DAY[tier];
    if (cap !== undefined) {
      const used = await incrWithTtl(dailyKey(identifier), 0, nextMidnightUTC());
      taken.push(dailyKey(identifier));
      if (used > cap) { await rollback(); return deny(429, CODES.QUOTA_PANEL_DAILY); }
    }

    // (3) per-panel count; a repeat of the same panel is a replacement
    const pc = await incrWithTtl(panelKey(comicSeed, idx), COMIC.sessionTtlSec);
    taken.push(panelKey(comicSeed, idx));
    let regen = false;
    if (pc > 1) {
      regen = true;
      const rg = await incrWithTtl(regenKey(comicSeed), COMIC.sessionTtlSec);
      taken.push(regenKey(comicSeed));
      if (rg > COMIC.regenLimit) { await rollback(); return deny(429, CODES.QUOTA_PANEL_REGEN); }
    }

    let released = false;
    return {
      ok: true,
      regen,
      release: async () => { if (!released) { released = true; await rollback(); } },
    };
  } catch (e) {
    await rollback();
    console.warn(`⚠️ Comic panel counters unavailable (Redis) — failing open: ${e.message}`);
    return noop;
  }
}
