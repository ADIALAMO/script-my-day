/**
 * Application-level rate limiting for expensive AI generation endpoints.
 *
 * Uses @upstash/ratelimit's sliding-window algorithm backed by the same
 * Upstash Redis instance as the quota system. Sliding window is chosen over
 * fixed window specifically because it eliminates the boundary-burst problem:
 * a fixed-window counter resets at e.g. :00 and :60, so an attacker can send
 * N requests at :59 and N more at :01 — 2N requests in 2 seconds. Sliding
 * window counts every request against the preceding <window> seconds, closing
 * that gap.
 *
 * Identifier strategy (matches the user's request for per-user limits):
 *   Authenticated  → "u:<userId>"   extracted from the NextAuth JWT (zero
 *                                   Redis round-trips — just a cookie decode).
 *   Anonymous      → "ip:<trustedIp>" using the hardened extractTrustedIp()
 *                                   which reads Vercel's non-spoofable headers.
 *
 * Fail-open policy: if Upstash is temporarily unreachable, the rate-limit
 * check is skipped with a warning — same convention as the quota system.
 * A transient Redis outage must never block a legitimate paying user.
 *
 * Admin bypass: requests carrying a valid x-admin-key header skip rate limiting
 * entirely (handled inside enforceRateLimit to keep routes concise).
 */

import { Ratelimit } from '@upstash/ratelimit';
import { Redis }     from '@upstash/redis';
import { getToken }  from 'next-auth/jwt';
import { extractTrustedIp, isAdminRequest } from './api-utils.js';
import { AUTH_EMAIL_LIMITS, PROXY_IMAGE } from '../config/limits.js';

// ── Upstash client for rate limiting ─────────────────────────────────────────
// A dedicated instance separate from lib/redis.js so the offline stub in that
// module does not interfere with Ratelimit's internal Lua-script calls.
// Returns null when credentials are absent (local dev without .env) so that
// enforceRateLimit can degrade gracefully instead of throwing.
function buildRedis() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

let _redis; // intentionally no initializer — must start as `undefined`, not
             // `null`, for the lazy-init check below to ever run buildRedis()
function getRedis() {
  if (_redis === undefined) _redis = buildRedis();
  return _redis;
}

// ── Per-endpoint sliding-window configuration ─────────────────────────────────
//
// Values are deliberately generous for normal human usage — a real user will
// never come close to these limits. Their purpose is to reject automated burst
// attacks (50-200 simultaneous requests) BEFORE they reach the quota counter,
// closing the race window where concurrent reads all pass the quota check
// before any INCR has fired.
//
// generate-poster is set higher (20/60s) to accommodate storyboard comics:
// the client generates up to 7 panel images in quick succession, so a tight
// limit would break legitimate Pro users mid-comic.
const ENDPOINT_CONFIG = {
  'generate-script':     { requests: 12,  window: '60 s' },
  'generate-poster':     { requests: 20,  window: '60 s' },
  'generate-storyboard': { requests: 12,  window: '60 s' },
  'upload-character':    { requests:  4,  window: '5 m'  },
  'relay-status':        { requests: 90,  window: '60 s' },
  // A comic uploads up to 7 panels (plus replacements); 30/min is generous for that.
  'upload-panel':        { requests: 30,  window: '60 s' },
  // Temporary reel-crash diagnostics (see pages/api/reel-diagnostic.js). One message per reel
  // attempt per tester device: 30/h per IP covers ~3 testers sharing a network; the global bucket
  // keeps a many-IP flood from saturating the shared Telegram chat.
  // Magic-link e-mails (lib/auth-email-limit.js) — numbers in config/limits.js.
  'auth-email-ip':   { requests: AUTH_EMAIL_LIMITS.perIpPerHour,    window: '1 h' },
  'auth-email-addr': { requests: AUTH_EMAIL_LIMITS.perEmailPerHour, window: '1 h' },
  'proxy-image':     { requests: PROXY_IMAGE.perIpPerMinute,        window: '60 s' },
  'reel-diagnostic':        { requests: 30,  window: '1 h' },
  'reel-diagnostic-global': { requests: 100, window: '1 h' },
};

// Lazily-initialised Ratelimit singletons — one per endpoint, re-used across
// warm serverless invocations to avoid re-instantiating on every request.
const _limiters = {};

function getLimiter(endpoint) {
  if (_limiters[endpoint]) return _limiters[endpoint];

  const redis = getRedis();
  if (!redis) return null; // credentials absent → fail open downstream

  const cfg = ENDPOINT_CONFIG[endpoint];
  if (!cfg) throw new Error(`rate-limit: unknown endpoint "${endpoint}"`);

  _limiters[endpoint] = new Ratelimit({
    redis,
    limiter:   Ratelimit.slidingWindow(cfg.requests, cfg.window),
    // Namespace rate-limit keys away from quota keys so a Redis SCAN/KEYS
    // command never accidentally matches both namespaces.
    prefix:    `rl:${endpoint}`,
    analytics: false,
  });

  return _limiters[endpoint];
}

// ── Identifier resolution ─────────────────────────────────────────────────────

/**
 * Resolves the rate-limit key for a request:
 *   authenticated  → "u:<userId>"   (JWT decode, no Redis round-trip)
 *   anonymous      → "ip:<trustedIp>"
 *
 * Keeping it consistent with the quota system's identifier shape means a
 * future "per-user rate limit dashboard" can join both datasets easily.
 */
async function resolveRateLimitId(req) {
  try {
    // getToken reads the signed JWT from the cookie — it never touches Redis.
    // Returns null when the user is not signed in or the cookie is absent.
    const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    if (token?.uid) return `u:${token.uid}`;
  } catch {
    // JWT decode failure (corrupt cookie, missing secret) → fall back to IP.
  }
  return `ip:${extractTrustedIp(req)}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

// ── Optional in-process fallback (opt-in, see enforceRateLimit's `fallback` option) ──────────
// A small per-instance sliding log, used only when a route asks for it AND Redis is
// unconfigured / errors / times out. Bounded: at most `max` timestamps per key, and the map
// is pruned if it ever grows large.
const _fallbackHits = new Map();
function fallbackLimit(key, { max, windowMs }) {
  const now = Date.now();
  const hits = (_fallbackHits.get(key) || []).filter((t) => now - t < windowMs);
  if (hits.length >= max) {
    _fallbackHits.set(key, hits);
    return { success: false, limit: max, remaining: 0, reset: hits[0] + windowMs };
  }
  hits.push(now);
  _fallbackHits.set(key, hits);
  if (_fallbackHits.size > 5000) {
    for (const [k, v] of _fallbackHits) if (!v.length || now - v[v.length - 1] >= windowMs) _fallbackHits.delete(k);
  }
  return { success: true, limit: max, remaining: max - hits.length, reset: now + windowMs };
}

// When an opted-in route (one passing `fallback`) sees Redis fail or time out, skip Redis for a
// short while and go straight to the in-process fallback, so a dead/hanging Redis costs the
// first request one timeout instead of every request (and every limiter call in a request).
const REDIS_RETRY_AFTER_MS = 30_000;
let _redisDownUntil = 0;

function withTimeout(promise, ms) {
  if (!ms) return promise;
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`rate-limit redis timeout (${ms}ms)`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Enforces the sliding-window rate limit for an endpoint.
 *
 * Usage in any API route (call before the quota gate):
 *
 *   if (await enforceRateLimit(req, res, 'generate-script')) return;
 *
 * Returns true  → rate limited; 429 response already sent; caller must return.
 * Returns false → within limits; caller continues normally.
 *
 * Optional third argument — all opt-in; omitting it leaves behaviour exactly as before:
 *   identifier  fixed bucket key (e.g. 'global') instead of the per-user/IP one.
 *   timeoutMs   give up on Redis after this long (the call is raced BEFORE `res` is touched,
 *               so a late answer can never write a second response).
 *   fallback    { max, windowMs } — when Redis is unconfigured, errors or times out, enforce
 *               this limit in-process (per serverless instance) instead of failing fully open.
 *   extraBody   extra fields merged into the 429 JSON body (e.g. NextAuth's client needs `url`).
 */
export async function enforceRateLimit(req, res, endpoint, opts = {}) {
  // Admin keys bypass rate limiting so operators can test without throttling.
  if (isAdminRequest(req)) return false;

  const { identifier: fixedId, timeoutMs, fallback, extraBody } = opts;

  const limiter = getLimiter(endpoint);
  if (!limiter && !fallback) {
    // This branch means buildRedis() returned null, which only happens when
    // UPSTASH_REDIS_REST_URL/TOKEN are genuinely absent (see buildRedis above) —
    // fail open rather than block requests over a missing rate limiter.
    console.warn(`⚠️ Rate limiter unavailable for ${endpoint} — UPSTASH_REDIS_REST_URL/UPSTASH_REDIS_REST_TOKEN not set`);
    return false;
  }

  try {
    const identifier = fixedId ?? await resolveRateLimitId(req);

    let result;
    if (limiter && !(fallback && Date.now() < _redisDownUntil)) {
      try {
        result = await withTimeout(limiter.limit(identifier), timeoutMs);
      } catch (err) {
        if (!fallback) throw err; // unchanged behaviour: handled by the outer catch (fail open)
        _redisDownUntil = Date.now() + REDIS_RETRY_AFTER_MS;
        result = fallbackLimit(`${endpoint}:${identifier}`, fallback);
      }
    } else {
      result = fallbackLimit(`${endpoint}:${identifier}`, fallback);
    }
    const { success, limit, reset } = result;

    if (!success) {
      const retryAfterSec = Math.ceil((reset - Date.now()) / 1000);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit',     String(limit));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset',     String(reset));
      res.status(429).json({
        success: false,
        code:    'RATE_LIMITED',
        message: 'Too many requests. Please slow down and try again.',
        ...(extraBody || {}),
      });
      return true; // caller must `return` immediately
    }

    return false; // within limit — proceed

  } catch (err) {
    // Upstash temporarily unreachable — fail open so a Redis hiccup never
    // blocks a paying user. The daily quota counters remain the backstop.
    console.warn(`⚠️ Rate limit check skipped for ${endpoint} (Upstash error): ${err.message}`);
    return false;
  }
}
