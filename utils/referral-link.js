/**
 * Client-safe referral-link helper (no Redis import — safe to bundle in components).
 * Swaps utm_medium on an invite link so GA4 attributes traffic to the right share
 * channel (whatsapp / native / copy / poster_share) while keeping source + campaign.
 */
export function withUtmMedium(link, medium) {
  try {
    const u = new URL(link);
    u.searchParams.set('utm_medium', medium);
    return u.toString();
  } catch {
    return link; // malformed/relative link → return as-is rather than break the share
  }
}
