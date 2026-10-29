/**
 * Web vs Android-app detection from the User-Agent, for SERVER-side funnel steps (lib/funnel-stats.js).
 *
 * The Capacitor app is a stock Android System WebView, whose UA carries "; wv)". But Facebook, Instagram and other in-app browsers on Android are
 * WebViews too, so "; wv)" ALONE would count every click from a social post as "app". A UA is the app only when it has "; wv)" AND matches none of
 * the known in-app browsers below. Advisory: a UA can be anything. Client-reported steps use isCapacitorNative() instead (utils/platform.js).
 * TODO (next Android release): set `android.appendUserAgent` ("LifeScriptApp/<version>") in capacitor.config and switch to that marker — see CLAUDE.md.
 */
const WEBVIEW = /;\s*wv\)/;
const IN_APP_BROWSER = /FBAN|FBAV|FB_IAB|FBIOS|FB4A|FBSV|Instagram|Barcelona|Messenger|\bLine\/\d|TikTok|musical_ly|BytedanceWebview|Snapchat|Twitter|LinkedInApp|Pinterest|MicroMessenger|KAKAOTALK|NAVER\(inapp|Telegram|WhatsApp|GSA\//i;

/** true only for a UA that is an Android WebView and not a known in-app browser */
export function isAppUserAgent(ua) {
  if (typeof ua !== 'string' || !ua) return false;
  return WEBVIEW.test(ua) && !IN_APP_BROWSER.test(ua);
}

/** 'app' | 'web' for a request, from its User-Agent header */
export function platformOfRequest(req) {
  return isAppUserAgent(req?.headers?.['user-agent']) ? 'app' : 'web';
}
