import test from 'node:test';
import assert from 'node:assert/strict';
import { isAppUserAgent, platformOfRequest } from '../lib/client-platform.js';

// Real-shape user agents. The Capacitor app is a stock Android System WebView ("; wv)").
const UA = {
  capacitorApp: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.231205.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36',
  capacitorAppOld: 'Mozilla/5.0 (Linux; Android 10; SM-G973F Build/QP1A.190711.020; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36',
  facebookInApp: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.231205.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/440.0.0.30.113;]',
  facebookInAppFban: 'Mozilla/5.0 (Linux; Android 13; SM-S918B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 [FBAN/EMA;FBLC/en_US;FBAV/435.0.0.4.109;]',
  instagramInApp: 'Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/UQ1A.231205.015; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36 Instagram 310.0.0.37.109 Android (34/14; 420dpi; 1080x2400; Google/google; Pixel 7; panther; panther; en_US; 543293760)',
  lineInApp: 'Mozilla/5.0 (Linux; Android 13; SM-A546B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 Line/13.5.0',
  tiktokInApp: 'Mozilla/5.0 (Linux; Android 13; Pixel 6 Build/TQ3A.230901.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/119.0.6045.193 Mobile Safari/537.36 musical_ly_2023302030 BytedanceWebview/d8a21c6',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.144 Mobile Safari/537.36',
  chromeDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  safariIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  facebookIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/440.0.0.30.113;]',
};

test('our Capacitor app (a plain Android WebView) is the app', () => {
  assert.equal(isAppUserAgent(UA.capacitorApp), true);
  assert.equal(isAppUserAgent(UA.capacitorAppOld), true);
});

test('Facebook, Instagram, Line and TikTok in-app browsers are WebViews too and are NOT the app', () => {
  for (const k of ['facebookInApp', 'facebookInAppFban', 'instagramInApp', 'lineInApp', 'tiktokInApp']) assert.equal(isAppUserAgent(UA[k]), false, k);
});

test('Chrome on Android, desktop and iOS browsers are web', () => {
  for (const k of ['chromeAndroid', 'chromeDesktop', 'safariIos', 'facebookIos']) assert.equal(isAppUserAgent(UA[k]), false, k);
});

test('missing / odd user agents are web, never a throw', () => {
  for (const v of [undefined, null, '', 5, {}, []]) assert.equal(isAppUserAgent(v), false);
  assert.equal(platformOfRequest({}), 'web'); assert.equal(platformOfRequest(undefined), 'web');
  assert.equal(platformOfRequest({ headers: { 'user-agent': UA.capacitorApp } }), 'app');
  assert.equal(platformOfRequest({ headers: { 'user-agent': UA.facebookInApp } }), 'web');
});

test('"Line" only matches the Line app token, not Linux', () => {
  assert.equal(isAppUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 7 Build/X; wv) AppleWebKit/537.36 Version/4.0 Chrome/120 Mobile Safari/537.36'), true);
});
