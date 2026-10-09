/**
 * Guests (anonymous visitors): how they are identified, how trivially that can be bypassed, and the real daily
 * worst-case cost under the current limits and global budgets. These scenarios DOCUMENT current behaviour (guest
 * behaviour is intentionally unchanged); DAILY_IMAGE_BUDGET is set to 0.14 here (= 10 Klein images/day).
 */
import { after } from 'node:test';
import assert from 'node:assert/strict';
import { boot } from './setup.mjs';

const ctx = await boot({ file: '15-guests', env: { DAILY_IMAGE_BUDGET: '0.14' } });
after(() => ctx.afterAll());
const { scenario, invoke, providers, fake } = ctx;
const script = await ctx.route('generate-script');
const poster = await ctx.route('generate-poster');
const JOURNAL = { journalEntry: 'I walked along the beach with my family and we laughed all afternoon.', genre: 'drama' };
const guestScript = (ip, extra = {}) => invoke(script, { body: { ...JOURNAL, ...(extra.body || {}) }, headers: extra.headers || {}, cookies: extra.cookies || {}, ip });
const guestPoster = (ip, extra = {}) => invoke(poster, { body: { prompt: 'A lone figure walks into the rain' }, headers: extra.headers || {}, ip });

scenario('N1', 'a guest is identified by the client IP ONLY (x-real-ip → last x-forwarded-for → socket): cookies, x-device-id, body deviceId, User-Agent and language do not create or split an identity',
  'one IP = one shared quota whatever the other signals say; a new IP = a fresh quota', async () => {
    const ip = '203.0.113.201';
    const variants = [
      { headers: { 'x-device-id': 'device-A', 'user-agent': 'Mozilla/5.0 A', 'accept-language': 'he' }, cookies: { guest: 'a' }, body: { deviceId: 'A' } },
      { headers: { 'x-device-id': 'device-B', 'user-agent': 'Mozilla/5.0 B', 'accept-language': 'en' }, cookies: { guest: 'b' }, body: { deviceId: 'B' } },
      { headers: { 'x-device-id': 'device-C' }, cookies: {}, body: {} },
    ];
    const statuses = [];
    for (const v of variants) statuses.push((await guestScript(ip, v)).status);
    assert.deepEqual(statuses, [200, 200, 429], 'three "different browsers" on one IP share the 2-script quota');
    assert.deepEqual(fake.keys('usage:script:').map((k) => k.split(':')[2]), [ip], 'the quota key is the bare IP — no cookie / device / fingerprint component');
    assert.equal((await guestScript('203.0.113.202')).status, 200, 'another IP: fresh quota');
    // x-forwarded-for: only the LAST entry counts (the first is client-supplied); x-real-ip wins when present
    const r1 = await invoke(script, { body: JOURNAL, ip: undefined, headers: { 'x-real-ip': '', 'x-forwarded-for': '9.9.9.9, 203.0.113.203' } });
    assert.equal(r1.status, 200);
    assert.ok(fake.keys('usage:script:').some((k) => k.includes(':203.0.113.203:')), 'last XFF entry used');
    assert.ok(!fake.keys('usage:script:').some((k) => k.includes(':9.9.9.9:')), 'the client-supplied first entry is ignored');
    return { actual: 'identity = IP string only; cookies/device ids/UA ignored; XFF first entry ignored', evidence: 'lib/api-utils.js:48-69 extractTrustedIp; lib/auth.js:245' };
  });

scenario('N2', 'FIXED: every IPv6 address of one /64 (privacy addresses) is ONE guest; a different /64 is a different guest',
  'first address of the /64 gets 2 scripts + 1 poster; the other addresses of the same /64 get nothing extra; a new /64 gets a fresh allowance', async () => {
    const same = ['2001:db8:1:1::1', '2001:db8:1:1::2', '2001:db8:1:1::3', '2001:db8:1:1:aaaa:bbbb:cccc:dddd'];     // same /64
    assert.equal((await guestScript(same[0])).status, 200); assert.equal((await guestScript(same[0])).status, 200);
    assert.equal((await guestPoster(same[0])).status, 200);
    for (const ip of same) {
      assert.equal((await guestScript(ip)).status, 429, ip);
      assert.equal((await guestPoster(ip)).status, 429, ip);
    }
    assert.equal((await guestScript('2001:db8:1:2::1')).status, 200, 'a different /64 is a different guest');
    return { actual: `${same.length} IPv6 addresses of ONE /64 = ONE guest allowance (key 2001:db8:1:1::/64); other /64 = new guest`, evidence: 'lib/api-utils.js normalizeGuestIp; IPv4 rotation (VPN/proxies/CGNAT) is unchanged and still mints new guests' };
  });

scenario('N3', 'real worst-case cost of guest SCRIPT abuse per day: no global cap exists for LLM spend — cost = (#IPs the attacker owns) × 2 scripts',
  'paid Gemini calls scale linearly with IPs and are NOT stopped by DAILY_IMAGE_BUDGET / DAILY_IDENTITY_BUDGET', async () => {
    const N = 50;
    for (let i = 1; i <= N; i++) { const ip = `198.18.${Math.floor(i / 200)}.${i % 200 + 1}`; await guestScript(ip); await guestScript(ip); await guestScript(ip); }
    const calls = providers.counts.gemini;
    assert.equal(calls, N * 2, 'every IP got its full 2 scripts (1 paid Gemini call each since hedging)');
    const lo = calls * 0.0084, hi = calls * 0.0104;
    const row = (n) => `${n} IPs → ${n * 2} scripts → $${(n * 2 * 0.0084).toFixed(2)}–$${(n * 2 * 0.0104).toFixed(2)}`;
    return { actual: `${N} guest IPs → ${calls} paid Gemini calls = $${lo.toFixed(2)}–$${hi.toFixed(2)}/day (price × assumed 2.8k in / 3k out tokens)`, evidence: `extrapolation per day: ${[100, 1000, 10000].map(row).join(' | ')}` };
  });

scenario('N4', 'real worst-case cost of guest POSTER abuse: free Cloudflare first; when it is down, paid Klein is bounded by DAILY_IMAGE_BUDGET (here 10 images), then free Pollinations',
  'Klein calls ≤ 10 for 30 guest IPs; the rest served by the free provider', async () => {
    providers.mode.cloudflare = 500;
    for (let i = 1; i <= 30; i++) assert.equal((await guestPoster(`198.19.0.${i}`)).status, 200);
    assert.equal(providers.counts.klein, 10);
    assert.ok(providers.counts.pollinations >= 20);
    assert.equal(fake.num('usage:image:paid:global:2026-10-15'), 10);
    return { actual: `Klein ${providers.counts.klein} (= budget 0.14 / 0.014), Pollinations ${providers.counts.pollinations}: image spend per day ≤ DAILY_IMAGE_BUDGET`, evidence: 'guest posters are lifetime-1 per IP; the budget is shared with all users' };
  });

scenario('N5', 'guests cannot reach any other paid feature: storyboard, comic panels, identity upload, face poster (covered in A1–A4) and their upload-panel allowance is tiny',
  'comic/identity 403; R2 panel/poster uploads capped at 20/5 per 30 days per IP', async () => {
    const storyboard = await ctx.route('generate-storyboard');
    const r = await invoke(storyboard, { body: { script: 'x'.repeat(60), lang: 'en' }, ip: '198.19.1.1' });
    assert.equal(r.status, 403);
    const { UPLOAD_LIMITS } = await import('../../config/limits.js');
    assert.deepEqual(UPLOAD_LIMITS.anonymous, { panels: 20, posters: 5 });
    return { actual: 'storyboard 403; guest R2 uploads ≤ 20 panels + 5 posters per 30 days per IP' };
  });

scenario('N5', 'guest IP retention: the lifetime guest-poster key expires after 90 days, refreshed on every use; a guest silent for 90 days gets a new allowance, one who returns earlier does not',
  'TTL ≈ 90 d; day-80 return refreshes it (still 429 at day 100); 90 d of silence → key gone → new poster allowed', async () => {
    const DAY = 86400_000; const ip = '203.0.113.77'; const key = `usage:poster:lifetime:${ip}`;
    ctx.setNow('2026-11-01T12:00:00Z');
    assert.equal((await guestPoster(ip)).status, 200);
    const ttl0 = fake.ttl(key); assert.ok(ttl0 > 89 * 86400 && ttl0 <= 90 * 86400, `ttl ${ttl0}`);
    ctx.setNow(new Date(Date.UTC(2026, 10, 1, 12) + 80 * DAY).toISOString());      // day 80: back again
    assert.equal((await guestPoster(ip)).status, 429, 'allowance not reset early');
    assert.ok(fake.ttl(key) > 89 * 86400, 'the refused attempt refreshed the expiry');
    ctx.setNow(new Date(Date.UTC(2026, 10, 1, 12) + 100 * DAY).toISOString());     // day 100: only 20 days since the last visit
    assert.equal((await guestPoster(ip)).status, 429, 'still the same spent allowance 100 days after the first poster');
    ctx.setNow(new Date(Date.UTC(2026, 10, 1, 12) + 100 * DAY + 91 * DAY).toISOString()); // 91 days of silence
    assert.equal(fake.num(key), 0, 'the IP key is gone after 90 days without use');
    assert.equal((await guestPoster(ip)).status, 200, 'a guest back after 90+ days gets a fresh allowance (accepted)');
    return { actual: 'ttl 90 d; refreshed by every attempt; expires only after 90 days of silence; new allowance afterwards', evidence: 'lib/poster-quota.js + config/limits.js GUEST_RETENTION.ipDays' };
  });
