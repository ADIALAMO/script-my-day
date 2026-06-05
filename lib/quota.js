/**
 * Single source of truth for per-tier daily limits.
 *
 * maxPanels:      how many panels the LLM generates (always 7 — free users get
 *                 the full narrative plan so the teaser feels real).
 * unlockedPanels: how many panels are fully visible with AI images.
 *                 Panels beyond this limit are shown as locked overlay cards.
 *                 Image generation is skipped for locked panels — zero wasted credits.
 */
// NOTE: `identity` is a MONTHLY allowance (not daily like the others) because each
// character image costs real money (~$0.06 via Grok Imagine). It is paid-only:
// anonymous/free = 0 acts as the tier gate. See lib/identity.js for enforcement.
export const TIER_LIMITS = {
  anonymous: { script: 2,        poster: 0,        comic: 0,        maxPanels: 0, unlockedPanels: 0,        identity: 0        },
  free:      { script: 3,        poster: 1,        comic: 1,        maxPanels: 7, unlockedPanels: 2,        identity: 0        },
  pro:       { script: Infinity, poster: 3,        comic: 2,        maxPanels: 7, unlockedPanels: 7,        identity: 30       },
  admin:     { script: Infinity, poster: Infinity, comic: Infinity, maxPanels: 7, unlockedPanels: Infinity, identity: Infinity },
};

/**
 * Returns the limit for a feature at a given tier.
 * Most features are daily; `identity` is monthly (see TIER_LIMITS note).
 */
export function limitFor(tier, feature) {
  return TIER_LIMITS[tier]?.[feature] ?? TIER_LIMITS.anonymous[feature] ?? 0;
}
