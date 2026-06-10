/**
 * Single source of truth for per-tier daily limits.
 *
 * maxPanels:      how many panels the LLM generates (always 7 — free users get
 *                 the full narrative plan so the teaser feels real).
 * unlockedPanels: how many panels are fully visible with AI images.
 *                 Panels beyond this limit are shown as locked overlay cards.
 *                 Image generation is skipped for locked panels — zero wasted credits.
 */
// NOTE: `identity` is normally a MONTHLY allowance (paid tiers) because each character
// image costs real money (~$0.06 Grok / ~$0.039 Gemini). EXCEPTION: `free` gets a single
// LIFETIME identity poster (the "see yourself as a comic hero" taste) — tracked under a
// no-expiry key and limited to the POSTER track only. See lib/identity.js for enforcement.
//
// ANONYMOUS POSTER is ALSO a LIFETIME allowance (1, no expiry) — a zero-friction taste for
// guests who haven't signed up yet, so they experience the product before committing an email.
// It is the faceless poster only (identity stays 0 — the selfie is the reason to sign in).
// generate-poster.js routes the anonymous tier to the no-expiry key `usage:poster:lifetime:<id>`.
// Everything else for anonymous (script) stays DAILY.
export const TIER_LIMITS = {
  anonymous: { script: 2,        poster: 1,        comic: 0,        maxPanels: 0, unlockedPanels: 0,        identity: 0        },
  free:      { script: 5,        poster: 2,        comic: 1,        maxPanels: 7, unlockedPanels: 7,        identity: 1        },
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
