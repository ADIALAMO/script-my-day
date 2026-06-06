import { getSessionAndTier } from '../../lib/auth.js';
import redis from '../../lib/redis.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { userId, tier, email } = await getSessionAndTier(req, res);
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
      }
    } catch { /* flag unavailable — skip the sign_up event */ }
  }

  return res.status(200).json({
    authenticated: !!userId,
    tier,
    email,
    justSignedUp,
    signupMethod,
  });
}
