/**
 * POST /api/character-event — counts a Star Yourself failure that happens IN THE BROWSER and never reaches /api/upload-character
 * (the photo could not be opened: decode_failed, or a HEIC-looking file that could not be opened: heic_detected).
 *
 *   body: { event: 'decode_failed' | 'heic_detected' }      anything else → 400, nothing is counted
 *
 * Numbers only (lib/character-stats.js): one INCR of stats:character:<UTC day>:<event>. No file name, type, size, image data or identifier is accepted or stored.
 * The rate-limit key is a one-way HMAC of the person (same pattern as /api/report-content), so not even that short-lived record holds a raw IP or user id.
 * The counts are ADVISORY: anyone can post the two fixed words (20 per 10 minutes), so they show a trend, not an audit trail.
 */
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { extractIdentifier } from '../../lib/api-utils.js';
import { reporterSegment } from '../../lib/upload-image.js';
import { getToken } from 'next-auth/jwt';
import { CLIENT_EVENTS, recordClientEvent } from '../../lib/character-stats.js';

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  let who = extractIdentifier(req);
  try { const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }); if (token?.uid) who = `u:${token.uid}`; } catch { /* guest */ }
  if (await enforceRateLimit(req, res, 'character-event', { identifier: `ce:${reporterSegment(who)}` })) return;

  const event = req.body?.event;
  if (typeof event !== 'string' || !CLIENT_EVENTS.includes(event)) return res.status(400).json({ success: false });

  await recordClientEvent(event);
  return res.status(204).end();
}
