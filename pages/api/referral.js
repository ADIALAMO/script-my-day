import { getSessionAndTier } from '../../lib/auth.js';
import { getReferralStats, rememberReferrerName } from '../../lib/referral.js';

/**
 * GET /api/referral — the signed-in user's invite link + live stats
 * ({ code, link, referrals, bonusCredits }). Mints the code lazily on first call.
 * Anonymous callers get 401 (you must be signed in to have an invite code).
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' });
  res.setHeader('Cache-Control', 'no-store');

  const { userId, name } = await getSessionAndTier(req, res);
  if (!userId) return res.status(401).json({ authenticated: false });

  try {
    // Persist the referrer's first name (best-effort) so /i/<code> can greet invitees.
    await rememberReferrerName(userId, name);
    const stats = await getReferralStats(userId);
    return res.status(200).json({ authenticated: true, ...stats });
  } catch (e) {
    console.error('referral stats error:', e.message);
    return res.status(500).json({ message: 'Could not load referral info.' });
  }
}
