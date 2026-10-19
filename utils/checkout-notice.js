/**
 * "Welcome to Pro" must follow the ACCOUNT's real tier, never the address bar: `/?checkout=success` can be typed by anyone, and the Stripe webhook that
 * grants Pro is asynchronous, so the page asks the server (/api/me) a few times after the return and only then shows the notice (and sends the GA4 event).
 * A visitor whose tier is not Pro gets nothing (no notice, no event).
 */
export const CHECKOUT_VERIFY_DELAYS_MS = [0, 3000, 8000];

export const isProTier = (me) => me?.tier === 'pro';

/**
 * @param {{ fetchMe: () => Promise<any>, onPro: () => void, delays?: number[], setTimer?: Function, clearTimer?: Function }} o
 * @returns {() => void} cancel
 */
export function verifyProAfterCheckout({ fetchMe, onPro, delays = CHECKOUT_VERIFY_DELAYS_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let done = false; const timers = [];
  delays.forEach((ms) => {
    timers.push(setTimer(async () => {
      if (done) return;
      let me = null;
      try { me = await fetchMe(); } catch { /* try again at the next delay */ }
      if (done) return;
      if (isProTier(me)) { done = true; onPro(); }
    }, ms));
  });
  return () => { done = true; timers.forEach((t) => clearTimer(t)); };
}
