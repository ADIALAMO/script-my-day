import { getSessionAndTier } from '../../lib/auth.js';
import redis from '../../lib/redis.js';
import { recordFunnel } from '../../lib/funnel-stats.js';
import { platformOfRequest } from '../../lib/client-platform.js';
import { isAdminRequest } from '../../lib/api-utils.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { userId, tier, plan, email } = await getSessionAndTier(req, res);
  res.setHeader('Cache-Control', 'no-store');

  // One-time "this account was just created" signal for the client GA4 `sign_up` event.
  // Read-then-delete so it fires exactly once. Best-effort — a Redis miss simply means
  // no sign_up event (never an error to the user).
  let justSignedUp = false;
  let signupMethod = null;
  if (userId) {
    try {
      const flag = await redis.get(`signup:fresh:${userId}`);
      if (flag) {
        justSignedUp = true;
        signupMethod = String(flag);
        await redis.del(`signup:fresh:${userId}`);
        if (!isAdminRequest(req)) await recordFunnel('signup', `u:${userId}`, tier, platformOfRequest(req));   // funnel: once per new account (the flag is read-then-deleted)
      }
    } catch { /* flag unavailable — skip the sign_up event */ }

    // "Last active" for the admin dashboard's All Users view. Throttled to once
    // per 24h (read-then-conditionally-write) rather than stamped on every call —
    // day-level granularity is enough for admin visibility and cuts the write
    // volume on this hot path (called on every page load) by ~two orders of
    // magnitude. Best-effort; never blocks the actual /me response.
    try {
      const key = `user:last_active:${userId}`;
      const last = await redis.get(key);
      const isStale = !last || (Date.now() - new Date(last).getTime()) > 24 * 60 * 60 * 1000;
      if (isStale) await redis.set(key, new Date().toISOString());
    } catch { /* best-effort — a missed stamp just means a stale "last active" */ }
  }

  // "Manage Subscription" only makes sense for a Pro user with a payment-provider customer on record (not for allowlist / admin-granted Pro).
  // One extra read, Pro users only; unreadable → false (the button simply stays hidden).
  let hasBillingCustomer = false;
  if (userId && tier === 'pro') {
    try { hasBillingCustomer = !!(await redis.get(`user:stripe_customer:${userId}`)); } catch { /* hidden on error */ }
  }

  return res.status(200).json({
    authenticated: !!userId,
    tier,
    hasBillingCustomer,
    // Why this plan applies (payment | admin | allowlist | unknown) — from lib/plan.js, the one resolver.
    plan: plan?.plan ?? 'free',
    grantedBy: plan?.grantedBy ?? null,
    email,
    justSignedUp,
    signupMethod,
  });
}
