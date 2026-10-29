/**
 * FUNNEL counters — how many DIFFERENT people reach each step. Numbers only: no id, e-mail or IP is stored.
 *
 *   stats:funnel:<UTC day>:<step>:<web|app>:<in|guest>     HyperLogLog (PFADD), expires `creatorStatsDays` (60) after that day's end
 *
 * Same machinery as lib/creator-stats.js: the element is creatorSegment(identifier) (one-way keyed HMAC, stable across days so a 7-day union counts a
 * returning person once; a HyperLogLog cannot be listed). Server steps are recorded next to the existing success counters; the three browser steps
 * (landing, typed, share) arrive through POST /api/funnel-event. Never for the admin API KEY. recordFunnel is bounded (~0.5 s), never throws and never
 * changes a response. Each step is its OWN counter, so a step can occasionally exceed the one before it (a person skipped or the step was not measured).
 */
import redis from './redis.js';
import { nextMidnightUTC } from './api-utils.js';
import { creatorSegment, objectKeySecretConfigured } from './upload-image.js';
import { creatorClass } from './creator-stats.js';
import { RETENTION } from '../config/limits.js';

export const FUNNEL_STEPS = ['landing', 'typed', 'script_req', 'script_ok', 'poster_req', 'poster_ok', 'comic_start', 'star_start', 'share', 'signup'];
export const CLIENT_STEPS = ['landing', 'typed', 'share'];
export const FUNNEL_PLATFORMS = ['web', 'app'];
export const FUNNEL_CLASSES = ['in', 'guest'];
const BUDGET_MS = 500;

const utcDay = (d = new Date()) => d.toISOString().split('T')[0];
export const funnelKey = (step, platform, cls, day = utcDay()) => `stats:funnel:${day}:${step}:${platform}:${cls}`;

/** one person reaching `step`. identifier = getSessionAndTier's ("u:<id>" or the guest IP), tier its tier, platform 'web' | 'app'. Anything unknown is ignored. */
export async function recordFunnel(step, identifier, tier, platform) {
  if (!identifier || !tier || !FUNNEL_STEPS.includes(step) || !FUNNEL_PLATFORMS.includes(platform)) return;
  if (!objectKeySecretConfigured()) return;   // creator-stats already warns/alerts about the missing secret
  let timer;
  try {
    const key = funnelKey(step, platform, creatorClass(tier));
    const pipe = redis.pipeline();
    pipe.pfadd(key, creatorSegment(identifier));
    pipe.expireat(key, nextMidnightUTC() + RETENTION.creatorStatsDays * 86400);
    await Promise.race([pipe.exec(), new Promise((resolve) => { timer = setTimeout(resolve, BUDGET_MS); })]);
  } catch { /* visibility only */ } finally { clearTimeout(timer); }
}

/**
 * Last `days` UTC days (default 7). One pipeline of 5 PFCOUNTs per step (50 commands): the union of all 4 segments, then each segment.
 * [{ step, total, web: { in, guest }, app: { in, guest } }] in funnel order. Fail-open: null on any error.
 */
export async function readFunnel(days = 7, client = redis, now = new Date()) {
  try {
    const dayList = Array.from({ length: days }, (_, i) => utcDay(new Date(now.getTime() - i * 86400000)));
    const keysOf = (step, p, c) => dayList.map((d) => funnelKey(step, p, c, d));
    const pipe = client.pipeline();
    for (const step of FUNNEL_STEPS) {
      pipe.pfcount(...FUNNEL_PLATFORMS.flatMap((p) => FUNNEL_CLASSES.flatMap((c) => keysOf(step, p, c))));
      for (const p of FUNNEL_PLATFORMS) for (const c of FUNNEL_CLASSES) pipe.pfcount(...keysOf(step, p, c));
    }
    const r = (await pipe.exec()).map((v) => Number(v) || 0);
    return FUNNEL_STEPS.map((step, i) => {
      const o = i * 5;
      return { step, total: r[o], web: { in: r[o + 1], guest: r[o + 2] }, app: { in: r[o + 3], guest: r[o + 4] } };
    });
  } catch { return null; }
}
