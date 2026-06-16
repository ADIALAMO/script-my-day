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

let _redis = null;
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
  'generate-storyboard': { requests:  6,  window: '60 s' },
  'upload-character':    { requests:  4,  window: '5 m'  },
  'relay-status':        { requests: 60,  window: '60 s' },
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

/**
 * Enforces the sliding-window rate limit for an endpoint.
 *
 * Usage in any API route (call before the quota gate):
 *
 *   if (await enforceRateLimit(req, res, 'generate-script')) return;
 *
 * Returns true  → rate limited; 429 response already sent; caller must return.
 * Returns false → within limits; caller continues normally.
 */
export async function enforceRateLimit(req, res, endpoint) {
  // Admin keys bypass rate limiting so operators can test without throttling.
  if (isAdminRequest(req)) return false;

  const limiter = getLimiter(endpoint);
  if (!limiter) {
    // Upstash credentials absent (local dev) — fail open.
    console.warn(`⚠️ Rate limiter unavailable for ${endpoint} — Upstash not configured`);
    return false;
  }

  try {
    const identifier       = await resolveRateLimitId(req);
    const { success, limit, remaining, reset } = await limiter.limit(identifier);

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
