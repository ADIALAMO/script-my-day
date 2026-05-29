import redis from '../../lib/redis.js';
import { getAllCircuitStates } from '../../lib/circuit-breaker.js';

// GET /api/provider-health
// Returns the live circuit-breaker state for all five image providers.
// No auth required — the data contains no credentials or user information.
export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  const states    = await getAllCircuitStates(redis);
  const entries   = Object.values(states);
  const openCount = entries.filter((s) => s.status === 'OPEN').length;

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    summary: {
      total:  entries.length,
      open:   openCount,
      closed: entries.length - openCount,
    },
    providers: states,
  });
}
