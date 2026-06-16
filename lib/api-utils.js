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
 * Resolves the best available client identifier for anonymous quota tracking.
 * Uses only server-derived, non-spoofable signals.
 */
export function extractIdentifier(req) {
  return extractTrustedIp(req);
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
