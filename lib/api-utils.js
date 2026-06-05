/**
 * Shared utilities for API route handlers.
 * Eliminates copy-paste across generate-script.js, generate-poster.js,
 * and generate-storyboard.js.
 */

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
 * Resolves the best available client identifier from a request.
 * Priority: x-device-id header → body.deviceId → first IP in x-forwarded-for → socket address.
 */
export function extractIdentifier(req, bodyDeviceId) {
  return (
    req.headers['x-device-id'] ||
    bodyDeviceId ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

/**
 * Extracts and sanitizes the admin key from request headers.
 * Accepts both canonical lowercase and capitalized header names.
 */
export function extractAdminKey(req) {
  return sanitize(req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || '');
}

/**
 * Returns true when the client's admin key matches the server secret.
 * Always returns false when the secret is not configured.
 */
export function isAdminRequest(req) {
  const clientKey = extractAdminKey(req);
  const serverSecret = sanitize(
    process.env.ADMIN_SECRET_KEY || process.env.ADMIN_SECRET || ''
  );
  return serverSecret !== '' && clientKey === serverSecret;
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
