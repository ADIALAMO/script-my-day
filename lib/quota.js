/**
 * Tier limits accessor. The TABLE (and every tunable number in it) lives in config/limits.js;
 * routes must keep using limitFor(tier, feature) rather than reading the table directly.
 */
import { TIER_LIMITS, COMIC_PERIOD } from '../config/limits.js';

export { TIER_LIMITS };

/**
 * Returns the limit for a feature at a given tier.
 * Most features are daily; `identity` is monthly (Free: lifetime); `comic` follows
 * COMIC_PERIOD (Free: monthly, Pro: daily).
 */
export function limitFor(tier, feature) {
  return TIER_LIMITS[tier]?.[feature] ?? TIER_LIMITS.anonymous[feature] ?? 0;
}

/** 'day' | 'month' — the window of the comic quota for a tier. */
export function comicPeriodFor(tier) {
  return COMIC_PERIOD[tier] ?? 'day';
}
