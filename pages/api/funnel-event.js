/**
 * POST /api/funnel-event — counts a funnel step that happens IN THE BROWSER (lib/funnel-stats.js).
 *
 *   body: { event: 'landing' | 'typed' | 'share', native?: boolean }      anything else in `event` → 400, nothing is counted
 *
 * Numbers only: one PFADD of a one-way keyed hash of the person into stats:funnel:<day>:<step>:<web|app>:<in|guest>. `native` (isCapacitorNative() on the
 * client) only picks web vs app; nothing else is read from the body. The rate-limit key is a one-way HMAC of the person (same pattern as /api/character-event).
 * Advisory by nature: anyone can post the three fixed words (20 per 10 minutes). Requests carrying the admin API KEY are not counted.
 */
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { extractIdentifier, isAdminRequest } from '../../lib/api-utils.js';
import { reporterSegment } from '../../lib/upload-image.js';
import { getToken } from 'next-auth/jwt';
import { CLIENT_STEPS, recordFunnel } from '../../lib/funnel-stats.js';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  let who = extractIdentifier(req);
  let tier = 'anonymous';
  try { const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }); if (token?.uid) { who = `u:${token.uid}`; tier = 'free'; } } catch { /* guest */ }
  if (await enforceRateLimit(req, res, 'funnel-event', { identifier: `fe:${reporterSegment(who)}` })) return;

  const event = req.body?.event;
  if (typeof event !== 'string' || !CLIENT_STEPS.includes(event)) return res.status(400).json({ success: false });

  if (!isAdminRequest(req)) await recordFunnel(event, who, tier, req.body?.native === true ? 'app' : 'web');
  return res.status(204).end();
}
