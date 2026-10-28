/**
 * ACTIVE CREATORS — how many DIFFERENT people successfully create something per UTC day. Numbers only: no id, e-mail or IP is stored.
 *
 *   stats:creators:<UTC day>:in      HyperLogLog of signed-in creators   (PFADD, expires `creatorStatsDays` after that day's end)
 *   stats:creators:<UTC day>:guest   HyperLogLog of guest creators
 *
 * The element is creatorSegment(identifier) (lib/upload-image.js): HMAC-SHA256 with OBJECT_KEY_SECRET, stable across days so a 7- / 30-day union works.
 * A HyperLogLog keeps register maxima only — it cannot be listed or read back as ids. One person who creates anything (script, poster, comic, Star Yourself
 * character) counts once per day; the kind of creation is not stored. Counted ONLY on success, never for the admin API KEY (admin-tier ACCOUNTS count).
 * A person who creates as a guest and signed in on the same day counts twice in the total (the two hashes cannot be linked).
 * recordCreator is bounded (~0.5 s), never throws and never changes a response. Reads (PFCOUNT, several keys = union) write nothing.
 */
import redis from './redis.js';
import { nextMidnightUTC } from './api-utils.js';
import { creatorSegment } from './upload-image.js';
import { RETENTION } from '../config/limits.js';

const BUDGET_MS = 500;
export const CREATOR_CLASSES = ['in', 'guest'];

const utcDay = (d = new Date()) => d.toISOString().split('T')[0];
export const creatorsKey = (cls, day = utcDay()) => `stats:creators:${day}:${cls}`;

/** class of a creator from the resolved tier: anonymous = guest, every account tier (free, pro, admin) = signed in */
export const creatorClass = (tier) => (tier === 'anonymous' ? 'guest' : 'in');

/** one successful creation by `identifier` (getSessionAndTier's identifier: "u:<id>" or the guest IP) of `tier`. Pass nothing for an admin-key request. */
export async function recordCreator(identifier, tier) {
  if (!identifier || !tier) return;
  let timer;
  try {
    const key = creatorsKey(creatorClass(tier));
    const pipe = redis.pipeline();
    pipe.pfadd(key, creatorSegment(identifier));
    pipe.expireat(key, nextMidnightUTC() + RETENTION.creatorStatsDays * 86400);
    await Promise.race([pipe.exec(), new Promise((resolve) => { timer = setTimeout(resolve, BUDGET_MS); })]);
  } catch { /* visibility only */ } finally { clearTimeout(timer); }
}

const clampReturning = (a, b, u) => Math.max(0, Math.min(a, b, a + b - u));   // |A∩B| = |A| + |B| − |A∪B|

/**
 * Newest day first. One pipeline of PFCOUNTs.
 * { today: { in, guest, total, returning, fresh }, d7: { in, guest, total }, d30: { … }, daily: [{ day, in, guest, total }] (14 days, zeros kept) }
 * returning = today's creators who also created on one of the previous 6 days (inclusion–exclusion on three counts); fresh = today − returning.
 * Fail-open: null on any error.
 */
export async function readActiveCreators(client = redis, now = new Date()) {
  try {
    const days = Array.from({ length: 30 }, (_, i) => utcDay(new Date(now.getTime() - i * 86400000)));
    const keysOf = (cls, from, to) => days.slice(from, to).map((d) => creatorsKey(cls, d));
    const pipe = client.pipeline();
    for (const cls of CREATOR_CLASSES) {
      for (let i = 0; i < 14; i++) pipe.pfcount(creatorsKey(cls, days[i]));
      pipe.pfcount(...keysOf(cls, 0, 7));
      pipe.pfcount(...keysOf(cls, 0, 30));
      pipe.pfcount(...keysOf(cls, 1, 7));
    }
    const r = (await pipe.exec()).map((v) => Number(v) || 0);
    const per = 17;
    const block = (ci) => ({ daily: r.slice(ci * per, ci * per + 14), d7: r[ci * per + 14], d30: r[ci * per + 15], prev6: r[ci * per + 16] });
    const b = { in: block(0), guest: block(1) };
    const sum = (f) => f(b.in) + f(b.guest);
    const ret = (c) => clampReturning(c.daily[0], c.prev6, c.d7);
    const returning = ret(b.in) + ret(b.guest);
    const todayTotal = sum((c) => c.daily[0]);
    return {
      today: { in: b.in.daily[0], guest: b.guest.daily[0], total: todayTotal, returning, fresh: todayTotal - returning },
      d7: { in: b.in.d7, guest: b.guest.d7, total: sum((c) => c.d7) },
      d30: { in: b.in.d30, guest: b.guest.d30, total: sum((c) => c.d30) },
      daily: days.slice(0, 14).map((day, i) => ({ day, in: b.in.daily[i], guest: b.guest.daily[i], total: b.in.daily[i] + b.guest.daily[i] })),
    };
  } catch { return null; }
}
