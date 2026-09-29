import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth.js';
import { isAdminRequest } from '../../../lib/api-utils.js';
import redis from '../../../lib/redis.js';
import { parseAllowlist } from '../../../lib/pro-source.js';

function isAllowedAdminSession(email) {
  if (!email || !process.env.ADMIN_EMAILS) return false;
  const allowed = process.env.ADMIN_EMAILS
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

const MAX_LIMIT = 200;

// Turns a flat ZRANGE ...WITHSCORES result ([member, score, member, score, …])
// into [{ userId, since }]. `since` is the signup unix-ms score; 0 is the
// backfill sentinel (see scripts/backfill-user-signups.js) and is surfaced to
// callers as null ("before tracking started"), same convention as pro-source's
// "Unknown" badge for pre-existing data.
function pairsFromFlatZRange(flat) {
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    const score = Number(flat[i + 1]) || 0;
    out.push({ userId: flat[i], since: score > 0 ? score : null });
  }
  return out;
}

/**
 * GET /api/admin/users?limit=&offset=&tier=all|free|pro|admin&email=
 *
 * Every user who has ever signed up (not just Pro — see pro-users.js for
 * grant provenance, which this deliberately does not duplicate or replace).
 *
 * Pagination: simple offset/limit off the stats:users:all sorted set
 * (score = signup ms), which gives exact, cheap, newest-first paging for the
 * default tier=all view.
 *
 * Known v1 scale limitation for tier=free|pro|admin: there is no per-tier
 * time-ordered index, only stats:pro:members (a plain, unordered set — the
 * same one pro-users.js already loads in full with no pagination at all).
 * A tier-filtered request here loads the FULL stats:users:all history in one
 * call and filters/paginates in memory. That's cheap at beta scale (the
 * whole point of this endpoint existing now) but doesn't scale indefinitely;
 * if the signup volume grows large enough for this to matter, the fix is a
 * mirrored per-tier sorted set written alongside stats:users:all, the same
 * way stats:pro:members already exists alongside it — deliberately not
 * built now since it wasn't asked for and beta scale doesn't need it yet.
 *
 * Auth: same gate as /api/admin/set-tier, /api/admin/stats, /api/admin/pro-users.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!isAdminRequest(req) && !isAllowedAdminSession(session?.user?.email)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const limit  = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
  const tier   = ['free', 'pro', 'admin'].includes(req.query.tier) ? req.query.tier : 'all';
  const emailQuery = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';

  try {
    const allowlist = parseAllowlist();

    // ── Global totals (independent of pagination/filter/search) ─────────────
    const total = await redis.zcard('stats:users:all');
    const proMemberIds = await redis.smembers('stats:pro:members');
    let proTierById = new Map();
    if (proMemberIds.length > 0) {
      const tierValues = await redis.mget(...proMemberIds.map(id => `user:tier:${id}`));
      proMemberIds.forEach((id, i) => proTierById.set(id, tierValues[i] || 'pro'));
    }
    const proCount   = [...proTierById.values()].filter(t => t === 'pro').length;
    const adminCount = [...proTierById.values()].filter(t => t === 'admin').length;
    const totalByTier = {
      free:  Math.max(0, total - proMemberIds.length),
      pro:   proCount,
      admin: adminCount,
    };

    // ── Build the candidate {userId, since} list for this request ───────────
    let candidates;
    let hasMore;

    if (emailQuery) {
      // Exact-email search — ignores the tier filter (search intent overrides
      // browse filter). Redis has no substring index here, so this is the one
      // supported search mode for v1 (see plan's scale notes).
      const stored = await redis.get(`user:email:${emailQuery}`);
      const userId = stored ? (typeof stored === 'object' ? (stored.id ?? String(stored)) : String(stored)) : null;
      if (!userId) {
        return res.status(200).json({ total, totalByTier, users: [], limit, offset: 0, hasMore: false });
      }
      const score = await redis.zscore('stats:users:all', userId).catch(() => null);
      const since = Number(score) > 0 ? Number(score) : null;
      candidates = [{ userId, since }];
      hasMore = false;
    } else if (tier === 'all') {
      const flat = await redis.zrange('stats:users:all', offset, offset + limit - 1, { rev: true, withScores: true });
      candidates = pairsFromFlatZRange(flat);
      hasMore = offset + limit < total;
    } else {
      // Tier-filtered browse — see the scale note in the handler doc comment.
      const flat = await redis.zrange('stats:users:all', 0, -1, { rev: true, withScores: true });
      const all = pairsFromFlatZRange(flat);
      const filtered = tier === 'free'
        ? all.filter(p => !proTierById.has(p.userId))
        : all.filter(p => proTierById.get(p.userId) === tier);
      candidates = filtered.slice(offset, offset + limit);
      hasMore = filtered.length > offset + limit;
    }

    if (candidates.length === 0) {
      return res.status(200).json({ total, totalByTier, users: [], limit, offset, hasMore: false });
    }

    // ── Batch-fetch details for the page ─────────────────────────────────────
    const keys = candidates.flatMap(c => [
      `user:${c.userId}`,
      `user:tier:${c.userId}`,
      `user:signup_provider:${c.userId}`,
      `user:last_active:${c.userId}`,
    ]);
    const flat = await redis.mget(...keys);

    const users = [];
    const ghostUserIds = [];

    candidates.forEach((c, i) => {
      const rawUser  = flat[i * 4];
      const tierVal  = flat[i * 4 + 1];
      const provider = flat[i * 4 + 2];
      const lastSeen = flat[i * 4 + 3];

      if (!rawUser) {
        // user:<id> is gone — the account was deleted (manually, per
        // request-deletion.js's human-processed flow) after being indexed.
        // Exclude it and self-heal the index below rather than showing a
        // ghost row with no email.
        ghostUserIds.push(c.userId);
        return;
      }

      const userObj = typeof rawUser === 'object' ? rawUser : JSON.parse(rawUser);
      const email = userObj?.email ?? null;

      users.push({
        userId: c.userId,
        email,
        name: userObj?.name ?? null,
        tier: tierVal || 'free',
        signupProvider: provider || null,
        signupAt: c.since ? new Date(c.since).toISOString() : null,
        lastActiveAt: lastSeen || null,
        alsoOnAllowlist: !!(email && allowlist.includes(email.toLowerCase())),
      });
    });

    // Best-effort self-heal: drop deleted users from the index so future
    // requests don't keep re-discovering (and re-filtering) the same ghosts.
    if (ghostUserIds.length > 0) {
      try {
        await redis.zrem('stats:users:all', ...ghostUserIds);
      } catch (e) {
        console.warn(`⚠️ Ghost-user index cleanup skipped (Redis): ${e.message}`);
      }
    }

    return res.status(200).json({ total, totalByTier, users, limit, offset, hasMore });
  } catch (e) {
    console.warn(`⚠️ /api/admin/users failed (Redis): ${e.message}`);
    return res.status(200).json({
      total: 0, totalByTier: { free: 0, pro: 0, admin: 0 },
      users: [], limit, offset, hasMore: false, _error: e.message,
    });
  }
}
