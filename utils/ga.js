import { isCapacitorNative } from './platform.js';

/**
 * Google Analytics (GA4) loads ONLY on the website and ONLY after the visitor accepted analytics cookies.
 *
 *   - pages/_document.js defines a `window.gtag` stub + the Consent Mode defaults. Until loadGoogleAnalytics() runs, that stub DROPS
 *     every command except `consent`, so events fired before acceptance are never queued and never replayed later.
 *   - nothing here runs inside the Capacitor (Android) app: no script, no config, no events there. Vercel Analytics is unaffected.
 *   - callers: GoogleAnalyticsLoader in pages/_app.js (returning visitors who accepted) and CookieConsent's "Accept" button.
 */
export const GA_ID = 'G-YL145XYBD3';
export const CONSENT_KEY = 'lifescript_cookie_v2';   // {analytics: boolean} — written by CookieConsent

/** true when this browser stored an explicit "accept analytics" */
export function hasAnalyticsConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return !!raw && JSON.parse(raw)?.analytics === true;
  } catch {
    return false;
  }
}

/** Idempotent. Returns true when GA is (now) loaded, false when it was not allowed to load. */
export function loadGoogleAnalytics() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (isCapacitorNative()) return false;
  if (window.__lsGa === true) return true;
  window.__lsGa = true;                                   // from now on the stub forwards event/config commands
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag !== 'function') window.gtag = function gtag() { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', GA_ID);
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${GA_ID}`;
  document.head.appendChild(s);
  return true;
}
