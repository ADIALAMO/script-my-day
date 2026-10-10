/**
 * Shared utilities for API route handlers.
 * Eliminates copy-paste across generate-script.js, generate-poster.js,
 * and generate-storyboard.js.
 */

import { timingSafeEqual, createHash } from 'crypto';
import { sanitize } from '../utils/input-processor.js';

/**
 * Unix timestamp (seconds) of the next UTC midnight.
 * Used as the expiry for all daily-quota Redis keys so they
 * reset on the calendar-day boundary rather than 24 h after first use.
 */
export function nextMidnightUTC() {
  const now = new Date();
  return Math.floor(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)) / 1000
  );
}

/**
 * Unix timestamp (seconds) of the first instant of next month (UTC).
 * Used as the expiry for MONTHLY-quota Redis keys (currently the identity
 * counter) so they reset on the calendar-month boundary. Date.UTC handles
 * the December → next-January year rollover automatically.
 */
export function nextMonthStartUTC() {
  const now = new Date();
  return Math.floor(
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)) / 1000
  );
}

/**
 * Returns the real client IP from Vercel-trusted headers.
 *
 * Resolution order:
 *   1. x-real-ip        — set by Vercel infrastructure; cannot be forged by clients.
 *   2. x-forwarded-for  — LAST entry (Vercel appends the edge-node-observed IP at the
 *                         end). The FIRST entry is client-supplied and must be ignored.
 *   3. socket address   — direct TCP source (local dev / non-Vercel environments).
 *
 * Deliberately ignores x-device-id and body.deviceId — both are fully
 * client-controlled and were previously the primary quota-key source, making
 * anonymous quota trivially bypassable by rotating the header value.
 */
export function extractTrustedIp(req) {
  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();

  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    const ips = forwarded.split(',').map((s) => s.trim()).filter(Boolean);
    // Last entry is the IP as observed by Vercel's edge node — trustworthy.
    const last = ips[ips.length - 1];
    if (last) return last;
  }

  return req.socket?.remoteAddress || 'unknown';
}

/**
 * Guest key for an IP. IPv4 is returned as is. IPv6 collapses to its /64 prefix, because one
 * household/device owns a whole /64 (privacy extensions rotate the low 64 bits at will), so keying
 * on the full address would hand every rotated address a fresh guest allowance.
 *   2001:db8:1:1:aaaa:bbbb:cccc:dddd → 2001:db8:1:1::/64      ::ffff:1.2.3.4 → 1.2.3.4
 * Anything that does not parse is returned unchanged.
 */
export function normalizeGuestIp(ip) {
  if (typeof ip !== 'string') return ip;
  let a = ip.trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (!a.includes(':')) return a;                                   // IPv4 / unknown
  const mapped = a.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) return mapped[1];
  // an embedded IPv4 tail (a.b.c.d) occupies the last two groups
  const tail = a.match(/^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (tail) {
    const [, head, b1, b2, b3, b4] = tail;
    a = head + ((+b1 << 8) | +b2).toString(16) + ':' + ((+b3 << 8) | +b4).toString(16);
  }
  const halves = a.split('::');
  if (halves.length > 2) return ip;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if (halves.length === 1 ? left.length !== 8 : missing < 1) return ip;
  const groups = halves.length === 1 ? left : [...left, ...Array(missing).fill('0'), ...right];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return ip;
  return groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':') + '::/64';
}

/**
 * Resolves the best available client identifier for anonymous quota tracking.
 * Uses only server-derived, non-spoofable signals; IPv6 is aggregated to its /64.
 */
export function extractIdentifier(req) {
  return normalizeGuestIp(extractTrustedIp(req));
}

/**
 * Extracts and sanitizes the admin key from request headers.
 * Accepts both canonical lowercase and capitalized header names.
 */
export function extractAdminKey(req) {
  return sanitize(req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || '');
}

/**
 * Constant-time string comparison via SHA-256 hashing.
 *
 * Why hash first: crypto.timingSafeEqual() requires both Buffers to be the
 * same byte-length — feeding strings of different lengths throws. Hashing
 * both sides to SHA-256 (always 32 bytes) normalises the length without
 * leaking which side is longer, closing length-based timing side-channels.
 */
function safeCompare(a, b) {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Returns true when the client's admin key matches the server secret.
 * Uses a constant-time comparison to prevent timing-based secret enumeration.
 * Always returns false when the secret is not configured.
 */
export function isAdminRequest(req) {
  const clientKey    = extractAdminKey(req);
  const serverSecret = sanitize(
    process.env.ADMIN_SECRET_KEY || process.env.ADMIN_SECRET || ''
  );
  if (!serverSecret) return false;
  return safeCompare(clientKey, serverSecret);
}

/**
 * Extracts a developer tier-preview override from the x-dev-tier header.
 * Only 'free' and 'pro' are accepted — anything else returns null.
 * This header is only trusted when isAdminRequest() is true; API routes
 * must enforce that guard themselves before calling this function.
 */
export function extractDevTier(req) {
  const val = (req.headers['x-dev-tier'] || '').toLowerCase().trim();
  return val === 'free' || val === 'pro' ? val : null;
}

/**
 * Validates a client-supplied comicSeed before it's ever interpolated into a
 * Redis key (comic:mode:<comicSeed>) or trusted for anything else. Bounded
 * length + a safe charset — makeClientComicSeed() only ever produces plain
 * digit strings, but this stays intentionally a little more permissive
 * (alphanumeric + - _) so a future seed-format change doesn't silently break
 * validation, while still ruling out colons/slashes/etc. that could cause key
 * collisions or injection into other Redis namespaces.
 */
export function isValidComicSeed(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
}
