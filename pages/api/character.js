/**
 * GET /api/character
 *
 * Restores the caller's saved character reference from Redis so a user who
 * switched device or cleared their cache never loses their hero — and we never
 * re-run the (paid) two-stage upload pipeline for a character they already have.
 *
 * Returns { success, characterImageUrl } where characterImageUrl is the styled
 * Character Sheet. Fail-soft: any error returns characterImageUrl:null rather than an error code,
 * so the client simply behaves as "no character yet". A reference that was reported / hidden is never returned.
 *
 * DELETE /api/character — "Remove my character" (owner only): deletes the caller's own Star Yourself objects from storage
 * (everything under their HMAC folder + what their pointer names) and then the Redis pointer. Answers { success:true } or, when
 * something could not be deleted, a retryable SERVER_ERROR (the pointer is kept so the user can try again).
 */
import redis from '../../lib/redis.js';
import { isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { keyFromPublicUrl, blobConfigured } from '../../lib/blob-store.js';
import { readAdultConfirmation } from '../../lib/adult-confirmation.js';
import { removeCharacterObjects } from '../../lib/character-store.js';
import { objectKeySecretConfigured } from '../../lib/upload-image.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { CODES } from '../../lib/messages.js';

async function resolveIdentifier(req, res) {
  if (isAdminRequest(req)) return 'admin';
  return (await getSessionAndTier(req, res)).identifier;
}

export default async function handler(req, res) {
  if (req.method === 'DELETE') return handleDelete(req, res);
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const ctx = isAdminRequest(req) ? { identifier: 'admin', userId: null, admin: true } : await getSessionAndTier(req, res);
    const identifier = ctx.identifier;
    // The account's 18+ confirmation, so the client knows whether to ask (existing users with a character are asked the next time they open the feature).
    // Unreadable → omitted (the client treats "unknown" like "not confirmed" and the upload route re-checks on the server anyway).
    let adultConfirmed;
    if (ctx.admin) adultConfirmed = true;
    else { try { adultConfirmed = (await readAdultConfirmation(ctx.userId)).confirmed; } catch { /* omitted */ } }

    const raw = await redis.get(`character:${identifier}`);
    if (!raw) return res.status(200).json({ success: true, characterImageUrl: null, adultConfirmed });

    const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
    const url = data?.styledUrl || data?.url || null;
    // Reported / hidden (or marked for cleanup): treat as "no character" and forget the stale pointer.
    const key = keyFromPublicUrl(url);
    if (key && await redis.get(`report:hidden:${key}`)) {
      try { await redis.del(`character:${identifier}`); } catch { /* best effort */ }
      return res.status(200).json({ success: true, characterImageUrl: null, adultConfirmed });
    }
    return res.status(200).json({ success: true, characterImageUrl: url, adultConfirmed });
  } catch (err) {
    console.warn(`⚠️ character GET fail-soft: ${err.message}`);
    return res.status(200).json({ success: true, characterImageUrl: null });
  }
}

async function handleDelete(req, res) {
  if (await enforceRateLimit(req, res, 'remove-character')) return;
  try {
    const identifier = await resolveIdentifier(req, res);
    if (!blobConfigured() || !objectKeySecretConfigured()) return res.status(503).json({ success: false, code: CODES.SERVER_ERROR });
    const r = await removeCharacterObjects(identifier);
    return res.status(200).json({ success: true, status: r.status, partial: r.partial, matched: r.matched, deleted: r.deleted, failed: r.failed });
  } catch (err) {
    console.error('character DELETE failed:', err.message);
    return res.status(500).json({ success: false, code: CODES.SERVER_ERROR });
  }
}
