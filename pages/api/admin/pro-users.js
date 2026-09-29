import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth.js';
import { isAdminRequest } from '../../../lib/api-utils.js';
import redis from '../../../lib/redis.js';
import { parseAllowlist } from '../../../lib/pro-source.js';

// Checks whether the session email is in the ADMIN_EMAILS allowlist.
function isAllowedAdminSession(email) {
  if (!email || !process.env.ADMIN_EMAILS) return false;
  const allowed = process.env.ADMIN_EMAILS
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

/**
 * GET /api/admin/pro-users
 *
 * Who's Pro, and how. Cross-references three sources:
 *   1. stats:pro:members  (Redis set) — every user with a stored tier of
 *      'pro' or 'admin', granted via Stripe or the admin dashboard. Their
 *      user:tier_source:<id> entry (see lib/pro-source.js) says which, and by
 *      whom. Grants made before this tracking existed show as source 'unknown'.
 *   2. PRO_ALLOWLIST (env) — VIP emails lifted to Pro at session time
 *      (lib/auth.js isProAllowlisted), never written to Redis. Resolved here by
 *      cross-referencing each allowlisted email against user:email:<email>.
 *   3. Allowlisted emails with no matching account at all → pendingAllowlist:
 *      invited, but never signed in.
 *
 * Auth: same gate as /api/admin/set-tier and /api/admin/stats.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!isAdminRequest(req) && !isAllowedAdminSession(session?.user?.email)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  try {
    const allowlist = parseAllowlist();

    // ── 1. Redis-tracked Pro/admin members (Stripe + admin dashboard grants) ──
    const memberIds = await redis.smembers('stats:pro:members');

    let users = [];
    if (memberIds.length > 0) {
      // One mget for everything: [user:<id>, user:tier:<id>, user:tier_source:<id>]
      // per member, in order — same O(1)-round-trip style as /api/admin/stats.
      const keys = memberIds.flatMap(id => [
        `user:${id}`,
        `user:tier:${id}`,
        `user:tier_source:${id}`,
      ]);
      const flat = await redis.mget(...keys);

      users = memberIds.map((userId, i) => {
        const rawUser   = flat[i * 3];
        const tier      = flat[i * 3 + 1] || 'pro';
        const rawSource = flat[i * 3 + 2];

        const userObj = rawUser
          ? (typeof rawUser === 'object' ? rawUser : JSON.parse(rawUser))
          : null;
        const email = userObj?.email ?? null;

        let source = 'unknown';
        let by     = undefined;
        let since  = null;
        if (rawSource) {
          const parsed = typeof rawSource === 'object' ? rawSource : JSON.parse(rawSource);
          source = parsed.source || 'unknown';
          by     = parsed.by;
          since  = parsed.at || null;
        }

        return {
          userId,
          email,
          name: userObj?.name ?? null,
          tier,
          source,
          by,
          since,
          alsoAllowlisted: !!(email && allowlist.includes(email.toLowerCase())),
        };
      });
    }

    // ── 2 & 3. Allowlisted emails not already covered by the Redis set ────────
    const coveredEmails = new Set(
      users.map(u => u.email).filter(Boolean).map(e => e.toLowerCase())
    );
    const remaining = allowlist.filter(e => !coveredEmails.has(e));
    const pendingAllowlist = [];

    if (remaining.length > 0) {
      const lookupKeys = remaining.map(email => `user:email:${email}`);
      const found = await redis.mget(...lookupKeys);

      remaining.forEach((email, i) => {
        const stored = found[i];
        if (!stored) {
          pendingAllowlist.push(email);
          return;
        }
        const userId = typeof stored === 'object' ? (stored.id ?? String(stored)) : String(stored);
        users.push({
          userId,
          email,
          name: null,
          tier: 'pro',
          source: 'allowlist',
          by: undefined,
          since: null,
          alsoAllowlisted: false, // source already IS allowlist — badge would be redundant
        });
      });
    }

    // ── Sort: newest grant first, undated (unknown/allowlist) entries last ────
    users.sort((a, b) => {
      if (a.since && b.since) return new Date(b.since) - new Date(a.since);
      if (a.since) return -1;
      if (b.since) return 1;
      return 0;
    });

    return res.status(200).json({ count: users.length, users, pendingAllowlist });
  } catch (e) {
    console.warn(`⚠️ /api/admin/pro-users failed (Redis): ${e.message}`);
    return res.status(200).json({ count: 0, users: [], pendingAllowlist: [], _error: e.message });
  }
}
