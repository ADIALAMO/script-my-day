/**
 * POST /api/adult-confirmation   body: { adult: true }
 *
 * Records, for the signed-in ACCOUNT, that the user declared "I am 18 or older" (needed once for "Star Yourself").
 * Anonymous callers cannot confirm (401): there is no account to attach it to. Idempotent — a repeat keeps the first time.
 * A self-declaration, not age verification.
 */
import { getSessionAndTier } from '../../lib/auth.js';
import { writeAdultConfirmation } from '../../lib/adult-confirmation.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { CODES } from '../../lib/messages.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });
  if (await enforceRateLimit(req, res, 'adult-confirmation')) return;
  res.setHeader('Cache-Control', 'no-store');
  if ((req.body || {}).adult !== true) return res.status(400).json({ success: false, code: CODES.ADULT_CONFIRMATION_REQUIRED });
  try {
    const { userId } = await getSessionAndTier(req, res);
    if (!userId) return res.status(401).json({ success: false, code: CODES.NEEDS_ACCOUNT });
    const r = await writeAdultConfirmation(userId);
    if (!r.confirmed) return res.status(503).json({ success: false, code: CODES.SERVER_ERROR });
    return res.status(200).json({ success: true, adultConfirmed: true });
  } catch (err) {
    console.error('adult-confirmation failed:', err.message);
    return res.status(503).json({ success: false, code: CODES.SERVER_ERROR });
  }
}
