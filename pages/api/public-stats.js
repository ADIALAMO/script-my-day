import redis from '../../lib/redis.js';

// GET /api/public-stats
// Returns the all-time script count for public social-proof display.
// No auth required — single Redis GET, no user data exposed.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

  try {
    const raw = await redis.get('stats:script:total');
    const count = parseInt(raw, 10) || 0;
    return res.status(200).json({ count });
  } catch {
    return res.status(200).json({ count: 0 });
  }
}
