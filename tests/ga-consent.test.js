// Google Analytics loads ONLY on the website and ONLY after the visitor accepted analytics; never inside the Android app.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const plain = (args) => JSON.parse(JSON.stringify([...args]));   // the sandbox's objects come from another realm

// ── the real _document.js stub, executed in a sandbox ─────────────────────────────────────────────────────────────────
function runStub(stored) {
  const src = read('pages/_document.js');
  const code = src.slice(src.indexOf('(function() {', src.indexOf('dangerouslySetInnerHTML')), src.indexOf('})();', src.indexOf('dangerouslySetInnerHTML')) + 5);
  const store = new Map(stored === undefined ? [] : [['lifescript_cookie_v2', stored]]);
  const window = { localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null) } };
  const ctx = vm.createContext({ window, localStorage: window.localStorage, JSON });
  ctx.dataLayer = undefined; window.dataLayer = undefined;
  vm.runInContext(code.replace(/window\.dataLayer = window\.dataLayer \|\| \[\];/, 'window.dataLayer = window.dataLayer || []; var dataLayer = window.dataLayer;'), ctx);
  return window;
}

test('the stub keeps the Consent Mode defaults (denied first visit / per stored choice) and DROPS events + config until GA is loaded', () => {
  let w = runStub(undefined);
  assert.equal(w.dataLayer.length, 1);
  assert.deepEqual(plain(w.dataLayer[0]), ['consent', 'default', { analytics_storage: 'denied', ad_storage: 'denied', wait_for_update: 500 }]);
  w.gtag('event', 'generate_script_start', { genre: 'drama' }); w.gtag('config', 'G-X'); w.gtag('js', new Date());
  assert.equal(w.dataLayer.length, 1, 'events/config/js before acceptance are neither sent nor queued');
  w.gtag('consent', 'update', { analytics_storage: 'granted' });
  assert.equal(w.dataLayer.length, 2, 'consent commands still pass');
  w.__lsGa = true; w.gtag('event', 'x', {});
  assert.equal(w.dataLayer.length, 3, 'once GA is loaded, events flow');
  w = runStub(JSON.stringify({ analytics: true }));
  assert.deepEqual(plain(w.dataLayer[0]), ['consent', 'default', { analytics_storage: 'granted', ad_storage: 'denied' }]);
  w = runStub(JSON.stringify({ analytics: false }));
  assert.equal(plain(w.dataLayer[0])[2].analytics_storage, 'denied');
});

// ── utils/ga.js with a fake DOM ───────────────────────────────────────────────────────────────────────────────────────
let appended; let native;
beforeEach(() => {
  appended = []; native = false;
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), _store: store };
  globalThis.window = { dataLayer: [], Capacitor: { isNativePlatform: () => native } };
  globalThis.window.gtag = function () { if (globalThis.window.__lsGa === true || arguments[0] === 'consent') globalThis.window.dataLayer.push(arguments); };
  globalThis.document = { createElement: () => ({}), head: { appendChild: (el) => appended.push(el) } };
});

const ga = await import('../utils/ga.js');
const platform = await import('../utils/platform.js');

test('loadGoogleAnalytics: injects gtag.js once, then js + config; idempotent', () => {
  if (platform.isCapacitorNative()) return;   // @capacitor/core reads its own global; the web path is what this test covers
  assert.equal(ga.loadGoogleAnalytics(), true);
  assert.equal(appended.length, 1); assert.equal(appended[0].src, 'https://www.googletagmanager.com/gtag/js?id=G-YL145XYBD3'); assert.equal(appended[0].async, true);
  assert.deepEqual(window.dataLayer.map((a) => a[0]), ['js', 'config']);
  assert.equal(ga.loadGoogleAnalytics(), true); assert.equal(appended.length, 1, 'never twice');
});

test('hasAnalyticsConsent: only an explicit {analytics:true}', () => {
  assert.equal(ga.hasAnalyticsConsent(), false);
  localStorage.setItem('lifescript_cookie_v2', JSON.stringify({ analytics: false })); assert.equal(ga.hasAnalyticsConsent(), false);
  localStorage.setItem('lifescript_cookie_v2', 'garbage'); assert.equal(ga.hasAnalyticsConsent(), false);
  localStorage.setItem('lifescript_cookie_v2', JSON.stringify({ analytics: true })); assert.equal(ga.hasAnalyticsConsent(), true);
});

// ── source pins ──────────────────────────────────────────────────────────────────────────────────────────────────────
test('source: no unconditional gtag.js / config anywhere; _app loads GA only with consent; the banner never shows in the app and loads GA on Accept; ga.js refuses native', () => {
  const app = read('pages/_app.js');
  assert.doesNotMatch(app, /googletagmanager\.com\/gtag\/js|gtag\('config'|from 'next\/script'/);
  assert.match(app, /if \(hasAnalyticsConsent\(\)\) loadGoogleAnalytics\(\);/);
  for (const f of ['pages/_document.js', 'pages/index.js', 'components/CookieConsent.jsx']) assert.doesNotMatch(read(f), /googletagmanager\.com\/gtag\/js/, f);
  const banner = read('components/CookieConsent.jsx');
  assert.match(banner, /if \(isCapacitorNative\(\)\) return;/);
  assert.match(banner, /loadGoogleAnalytics\(\);/);
  const decline = banner.slice(banner.indexOf('const handleDecline'), banner.indexOf('const banner'));
  assert.doesNotMatch(decline, /loadGoogleAnalytics/);
  const lib = read('utils/ga.js');
  assert.match(lib, /if \(isCapacitorNative\(\)\) return false;/);
  assert.match(read('pages/_document.js'), /function gtag\(\) \{ if \(window\.__lsGa === true \|\| arguments\[0\] === 'consent'\) dataLayer\.push\(arguments\); \}/);
  // CSP still allows the loader host (it is injected at runtime now)
  assert.match(read('next.config.js'), /https:\/\/www\.googletagmanager\.com/);
});
