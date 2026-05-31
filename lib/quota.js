/**
 * Single source of truth for per-tier daily limits.
 *
 * maxPanels: max comic panels returned to the client.
 *   anonymous → 0  (blocked at quota gate before panels are ever generated)
 *   free      → 2  (short teaser comic)
 *   pro       → 7  (full arc)
 */
export const TIER_LIMITS = {
  anonymous: { script: 2,        poster: 0, comic: 0, maxPanels: 0 },
  free:      { script: 3,        poster: 1, comic: 1, maxPanels: 2 },
  pro:       { script: Infinity, poster: 3, comic: 2, maxPanels: 7 },
};

/** Returns the daily limit for a feature at a given tier. */
export function limitFor(tier, feature) {
  return TIER_LIMITS[tier]?.[feature] ?? TIER_LIMITS.anonymous[feature] ?? 0;
}
