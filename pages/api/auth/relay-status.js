import { Redis } from '@upstash/redis';

/**
 * GET /api/auth/relay-status?token=<relay_token>
 *
 * Polling endpoint used by the iOS PWA to detect when the user has completed
 * magic-link authentication in external Safari. Returns only 'pending' or
 * 'verified' — no user data ever leaves this endpoint.
 *
 * Once the PWA sees 'verified' it calls signIn('relay-exchange') which reads
 * and atomically deletes the Redis entry, returning null on any subsequent call.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { token } = req.query;
  if (!token || typeof token !== 'string' || token.length > 64) {
    return res.status(400).json({ error: 'Invalid token' });
  }

  res.setHeader('Cache-Control', 'no-store');

  const url        = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  // If Upstash is not configured (local dev), return pending — fail open.
  if (!url || !redisToken) {
    return res.status(200).json({ status: 'pending' });
  }

  try {
    const redis = new Redis({ url, token: redisToken });
    const raw   = await redis.get(`relay:${token}`);

    if (!raw) return res.status(200).json({ status: 'pending' });

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return res.status(200).json({
      status: data?.status === 'verified' ? 'verified' : 'pending',
    });
  } catch {
    // Redis error — fail open so the PWA keeps polling rather than crashing.
    return res.status(200).json({ status: 'pending' });
  }
}
