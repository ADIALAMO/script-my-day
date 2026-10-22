/**
 * The Guide button pulses (gold glow + a gentle bounce every few seconds, styles/globals.css .tour-button--attention) until the visitor has pressed it ONCE.
 * "Seen" is a per-browser flag (localStorage) — nothing is sent anywhere. It is read after mount (never during SSR, so there is no flash and no hydration mismatch).
 */
export const GUIDE_SEEN_KEY = 'ls_guide_seen_v1';

function store(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

export function hasSeenGuide(storage) {
  try { return store(storage)?.getItem(GUIDE_SEEN_KEY) === 'true'; } catch { return false; }
}

export function markGuideSeen(storage) {
  try { store(storage)?.setItem(GUIDE_SEEN_KEY, 'true'); } catch { /* storage blocked: the button just keeps pulsing until the next visit */ }
}

/** The effect runs only while it can help: not after the first press, not during a tour (the tour's last step spotlights this very button), not while it is disabled or its menu is open. */
export function shouldAttract({ seen, tourRunning = false, disabled = false, menuOpen = false }) {
  return !seen && !tourRunning && !disabled && !menuOpen;
}
