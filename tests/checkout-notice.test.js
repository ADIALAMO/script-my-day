import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyProAfterCheckout, isProTier, CHECKOUT_VERIFY_DELAYS_MS } from '../utils/checkout-notice.js';

// fake timers: run callbacks in order of their delay, awaiting each
function harness() { const q = []; return { setTimer: (fn, ms) => { q.push({ fn, ms, dead: false }); return q.length - 1; }, clearTimer: (i) => { if (q[i]) q[i].dead = true; }, async run() { for (const t of [...q].sort((a, b) => a.ms - b.ms)) if (!t.dead) await t.fn(); }, q }; }

test('a non-Pro visitor (anonymous, free, error) gets no notice and no event, however often it asks', async () => {
  for (const me of [{ tier: 'anonymous' }, { tier: 'free' }, {}, null]) {
    const h = harness(); let shown = 0;
    verifyProAfterCheckout({ fetchMe: async () => me, onPro: () => shown++, setTimer: h.setTimer, clearTimer: h.clearTimer });
    await h.run(); assert.equal(shown, 0, JSON.stringify(me));
  }
  const h = harness(); let shown = 0;
  verifyProAfterCheckout({ fetchMe: async () => { throw new Error('offline'); }, onPro: () => shown++, setTimer: h.setTimer, clearTimer: h.clearTimer });
  await h.run(); assert.equal(shown, 0);
});

test('a Pro account shows the notice exactly once, even when the webhook is late (free at 0 s, Pro at 3 s)', async () => {
  const h = harness(); let shown = 0; const tiers = ['free', 'pro', 'pro'];
  verifyProAfterCheckout({ fetchMe: async () => ({ tier: tiers.shift() }), onPro: () => shown++, setTimer: h.setTimer, clearTimer: h.clearTimer });
  await h.run(); assert.equal(shown, 1);
  assert.deepEqual(CHECKOUT_VERIFY_DELAYS_MS, [0, 3000, 8000]); assert.ok(isProTier({ tier: 'pro' })); assert.ok(!isProTier({ tier: 'admin' }));
});

test('cancel stops everything', async () => {
  const h = harness(); let shown = 0;
  const cancel = verifyProAfterCheckout({ fetchMe: async () => ({ tier: 'pro' }), onPro: () => shown++, setTimer: h.setTimer, clearTimer: h.clearTimer });
  cancel(); await h.run(); assert.equal(shown, 0);
});

test('index.js no longer shows the notice or sends the GA event from the URL alone', () => {
  const src = readFileSync(new URL('../pages/index.js', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('function applyCheckoutParam()'), src.indexOf('function applyRefParam()'));
  assert.doesNotMatch(fn, /setCheckoutNotice\('success'\)/); assert.doesNotMatch(fn, /gtag\('event', 'subscribe'/);
  assert.match(src, /verifyProAfterCheckout\(\{/);
  assert.match(src, /onPro: \(\) => \{\s*setCheckoutNotice\('success'\);[\s\S]*?gtag\('event', 'subscribe'/);
});
