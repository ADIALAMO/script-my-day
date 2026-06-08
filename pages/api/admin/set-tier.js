import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth.js';
import { isAdminRequest } from '../../../lib/api-utils.js';
import redis from '../../../lib/redis.js';
import { getSessionAndTier } from '../../../lib/auth.js';

// Checks whether the session email is in the ADMIN_EMAILS allowlist.
// ADMIN_EMAILS env var: comma-separated list of authorised email addresses.
function isAllowedAdminSession(email) {
  if (!email || !process.env.ADMIN_EMAILS) return false;
  const allowed = process.env.ADMIN_EMAILS
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

/**
 * POST /api/admin/set-tier
 *
 * Auth (either is sufficient):
 *   • x-admin-key header matching ADMIN_SECRET_KEY env var  (curl / scripts)
 *   • Active NextAuth session whose email is in ADMIN_EMAILS  (admin dashboard)
 *
 * Body:
 *   { tier: 'free' | 'pro', targetEmail?: string, targetUserId?: string }
 *
 * Resolution order for the target user:
 *   1. targetUserId  — use directly
 *   2. targetEmail   — look up userId via the NextAuth Upstash adapter index
 *   3. (neither)     — fall back to the current session user
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const session = await getServerSession(req, res, authOptions);
  const sessionEmail = session?.user?.email ?? null;

  if (!isAdminRequest(req) && !isAllowedAdminSession(sessionEmail)) {
    return res.status(403).json({ success: false, error: 'Admin access required.' });
  }

  // ── Input validation ───────────────────────────────────────────────────────
  const { tier, targetEmail, targetUserId } = req.body ?? {};

  if (!['free', 'pro', 'admin'].includes(tier)) {
    return res.status(400).json({ success: false, error: 'tier must be "free", "pro", or "admin".' });
  }

  // ── Resolve target user ────────────────────────────────────────────────────
  let userId = targetUserId ?? null;
  let resolvedEmail = targetEmail ?? null;

  if (!userId && targetEmail) {
    // The @next-auth/upstash-redis-adapter stores the email → userId index at
    // this key. It uses the normalised (lowercased) email as written by NextAuth.
    const stored = await redis.get(`user:email:${targetEmail.toLowerCase()}`);
    if (!stored) {
      return res.status(404).json({
        success: false,
        error: `No account found for ${targetEmail}. The user must have signed in at least once.`,
      });
    }
    // Upstash may deserialise to an object or return a plain string depending on
    // how the adapter wrote the value. Guard both shapes.
    userId = typeof stored === 'object' ? (stored.id ?? String(stored)) : String(stored);
    resolvedEmail = targetEmail;
  }

  if (!userId) {
    // No target specified — fall back to the currently authenticated user.
    const ctx = await getSessionAndTier(req, res);
    userId = ctx.userId;
    resolvedEmail = ctx.email;
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: 'No target user. Provide targetEmail, targetUserId, or have an active session.',
    });
  }

  // ── Write tier to Redis ────────────────────────────────────────────────────
  const key = `user:tier:${userId}`;
  if (tier === 'free') {
    await redis.del(key);
  } else {
    await redis.set(key, tier);
  }

  // ── Maintain the Pro member set for the dashboard (/api/admin/stats) ────────
  // SADD/SREM are idempotent so SCARD stays accurate no matter how often a tier
  // is re-applied. 'admin' counts as Pro for the paying-users headline. VIPs lifted
  // via PRO_ALLOWLIST aren't stored here (resolved at session time) — known caveat.
  // Best-effort: a counter hiccup must never fail the actual tier write above.
  try {
    if (tier === 'free') await redis.srem('stats:pro:members', userId);
    else                 await redis.sadd('stats:pro:members', userId);
  } catch (e) {
    console.warn(`⚠️ Pro member set update skipped (Redis): ${e.message}`);
  }

  return res.status(200).json({ success: true, userId, email: resolvedEmail, tier, redisKey: key });
}
