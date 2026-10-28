import { requireAdmin } from '../../../lib/admin-auth.js';
import { readScriptStages } from '../../../lib/script-stats.js';

/**
 * GET /api/admin/script-stages — which stage served each script, last 14 UTC days, newest first (lib/script-stats.js: counts and token totals only).
 * SEPARATE from /api/admin/stats on purpose: it is 14 Upstash reads (one per day), more than half of an auto-refresh cycle, and the Upstash free tier allows 500K commands per MONTH.
 * The admin page asks for it on load and on the manual Refresh button ONLY (like the active-creators card). Same admin gate as the waitlist route.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!(await requireAdmin(req, res))) return;
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ scriptStages: await readScriptStages(14) });
}
