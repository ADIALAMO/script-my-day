import redis from './redis.js';

/**
 * Records how a user came to have Pro (or admin) tier, for the admin dashboard's
 * "Pro Users" audit view. `source` is 'stripe' or 'admin' — 'allowlist' is never
 * written here: it's computed live in getSessionAndTier() from PRO_ALLOWLIST and
 * surfaced by pages/api/admin/pro-users.js via cross-reference, not stored.
 * Best-effort: a Redis hiccup here must never fail the tier grant itself.
 */
export async function recordProSource(userId, source, by) {
  try {
    const entry = { source, at: new Date().toISOString() };
    if (by) entry.by = by;
    await redis.set(`user:tier_source:${userId}`, JSON.stringify(entry));
  } catch (e) {
    console.warn(`⚠️ Pro source record skipped (Redis): ${e.message}`);
  }
}

export async function clearProSource(userId) {
  try {
    await redis.del(`user:tier_source:${userId}`);
  } catch (e) {
    console.warn(`⚠️ Pro source clear skipped (Redis): ${e.message}`);
  }
}

/**
 * PRO_ALLOWLIST (env) as a normalised (lowercased, trimmed) email array.
 * Shared by pages/api/admin/pro-users.js and pages/api/admin/users.js so
 * both compute "alsoOnAllowlist" the same way without duplicating the parse.
 */
export function parseAllowlist() {
  if (!process.env.PRO_ALLOWLIST) return [];
  return process.env.PRO_ALLOWLIST
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
}
