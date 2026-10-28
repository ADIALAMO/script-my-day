import redis from '../../../lib/redis.js';
import { requireAdmin } from '../../../lib/admin-auth.js';
import { readActiveCreators } from '../../../lib/creator-stats.js';

/**
 * GET /api/admin/active-creators — the "Active creators" card (lib/creator-stats.js). SEPARATE from /api/admin/stats on purpose: it costs 34 Upstash commands
 * (PFCOUNTs), so the admin page asks for it on load and on the manual Refresh button ONLY, never on the 30 s auto-refresh. Same admin gate as the waitlist route.
 * Counts only; { activeCreators: null } when Redis could not answer.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!(await requireAdmin(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ activeCreators: await readActiveCreators(redis) });
}
