/**
 * Single source of truth for per-tier daily limits.
 *
 * maxPanels:      how many panels the LLM generates (always 7 — free users get
 *                 the full narrative plan so the teaser feels real).
 * unlockedPanels: how many panels are fully visible with AI images.
 *                 Panels beyond this limit are shown as locked overlay cards.
 *                 Image generation is skipped for locked panels — zero wasted credits.
 */
export const TIER_LIMITS = {
  anonymous: { script: 2,        poster: 0, comic: 0, maxPanels: 0, unlockedPanels: 0 },
  free:      { script: 3,        poster: 1, comic: 1, maxPanels: 7, unlockedPanels: 2 },
  pro:       { script: Infinity, poster: 3, comic: 2, maxPanels: 7, unlockedPanels: 7 },
};

/** Returns the daily limit for a feature at a given tier. */
export function limitFor(tier, feature) {
  return TIER_LIMITS[tier]?.[feature] ?? TIER_LIMITS.anonymous[feature] ?? 0;
}
