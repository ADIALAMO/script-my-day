/**
 * GET /api/character
 *
 * Restores the caller's saved character reference from Redis so a user who
 * switched device or cleared their cache never loses their hero — and we never
 * re-run the (paid) two-stage upload pipeline for a character they already have.
 *
 * Returns { success, characterImageUrl } where characterImageUrl is the styled
 * Character Sheet (falls back to the raw selfie if the sheet step had failed).
 * Fail-soft: any error returns characterImageUrl:null rather than an error code,
 * so the client simply behaves as "no character yet".
 */
import redis from '../../lib/redis.js';
import { isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const isAdmin = isAdminRequest(req);
    let identifier = 'admin';
    if (!isAdmin) {
      const ctx = await getSessionAndTier(req, res);
      identifier = ctx.identifier;
    }

    const raw = await redis.get(`character:${identifier}`);
    if (!raw) return res.status(200).json({ success: true, characterImageUrl: null });

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return res.status(200).json({
      success: true,
      characterImageUrl: data?.styledUrl || data?.url || null,
    });
  } catch (err) {
    console.warn(`⚠️ character GET fail-soft: ${err.message}`);
    return res.status(200).json({ success: true, characterImageUrl: null });
  }
}
