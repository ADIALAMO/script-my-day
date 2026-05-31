import { isAdminRequest } from '../../../lib/api-utils.js';
import redis from '../../../lib/redis.js';
import { getSessionAndTier } from '../../../lib/auth.js';

/**
 * Dev/testing endpoint — manually promote or demote the current session's user tier.
 *
 * Requires x-admin-key header matching ADMIN_SECRET env var.
 *
 * POST /api/admin/set-tier
 * Body: { tier: 'free' | 'pro' }
 *
 * Usage (curl):
 *   curl -X POST http://localhost:3000/api/admin/set-tier \
 *     -H "Content-Type: application/json" \
 *     -H "x-admin-key: YOUR_ADMIN_SECRET" \
 *     -H "Cookie: next-auth.session-token=YOUR_SESSION_COOKIE" \
 *     -d '{"tier":"pro"}'
 *
 * Or from the browser console while logged in:
 *   fetch('/api/admin/set-tier', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json', 'x-admin-key': 'YOUR_ADMIN_SECRET' },
 *     body: JSON.stringify({ tier: 'pro' })
 *   }).then(r => r.json()).then(console.log)
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  if (!isAdminRequest(req)) {
    return res.status(403).json({ success: false, error: 'Admin key required.' });
  }

  const { tier } = req.body ?? {};
  if (!['free', 'pro'].includes(tier)) {
    return res.status(400).json({ success: false, error: 'tier must be "free" or "pro".' });
  }

  const { userId, email } = await getSessionAndTier(req, res);
  if (!userId) {
    return res.status(401).json({ success: false, error: 'No active session — sign in first.' });
  }

  const key = `user:tier:${userId}`;
  if (tier === 'free') {
    await redis.del(key);
  } else {
    await redis.set(key, tier);
  }

  console.log(`🔧 Admin set-tier: ${email} (${userId}) → ${tier}`);
  return res.status(200).json({ success: true, userId, email, tier, redisKey: key });
}
