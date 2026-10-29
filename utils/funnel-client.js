import { isCapacitorNative } from './platform.js';

/**
 * Browser side of the funnel counters (pages/api/funnel-event.js). Three fixed steps, each sent AT MOST ONCE per page load: the "already sent" flags are plain
 * in-memory variables — nothing is written to localStorage / cookies, so this stores nothing on the device. The server counts distinct people anyway (HyperLogLog).
 * Fire-and-forget: never throws, never blocks, no identifier is sent (the server derives a one-way hash). No-op during SSR.
 */
const sent = new Set();
/** referrers whose visits are not real people (a click farm); Vercel Analytics still shows them */
export const EXCLUDED_REFERRER_HOSTS = ['clickbaitpays.me'];

export function isExcludedReferrer(referrer) {
  try {
    const host = new URL(referrer).hostname.toLowerCase();
    return EXCLUDED_REFERRER_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
  } catch { return false; }
}

export function funnelEvent(event) {
  try {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    if (sent.has(event)) return;
    sent.add(event);
    if (event === 'landing' && isExcludedReferrer(document.referrer)) return;
    fetch('/api/funnel-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event, native: isCapacitorNative() }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* advisory */ }
}
