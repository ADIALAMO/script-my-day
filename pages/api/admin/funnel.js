import redis from '../../../lib/redis.js';
import { requireAdmin } from '../../../lib/admin-auth.js';
import { readFunnel } from '../../../lib/funnel-stats.js';

/**
 * GET /api/admin/funnel — the "Funnel (7 days)" card (lib/funnel-stats.js). SEPARATE from /api/admin/stats on purpose: it costs 50 Upstash commands (PFCOUNTs), so the
 * admin page asks for it on load and on the manual Refresh button ONLY, never on the auto-refresh. Same admin gate as the creators route.
 * Counts only; { funnel: null } when Redis could not answer.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!(await requireAdmin(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ funnel: await readFunnel(7, redis) });
}
