/**
 * Referral loop — invite codes, attribution, and the reward grant, in one cohesive
 * module (mirrors lib/identity.js). The reward is +1 "Star Yourself" (identity) credit
 * to the REFERRER, granted only when an invited friend generates their FIRST poster.
 *
 * Cost safety (this grants the only per-call paid feature, so it is deliberately tight):
 *   • Per-referrer cap (REFERRAL_REWARD_CAP) bounds a single referrer's granted credits.
 *   • Self-referral blocked (referrer ≠ referee).
 *   • One attribution per referee EVER (atomic set-if-not-exists).
 *   • Aggregate spend still bounded by lib/identity.js DAILY_IDENTITY_BUDGET kill-switch.
 *   • Any Redis error → NO grant, no throw (fail-safe; never block or double-spend).
 *
 * Redis keys (see the `quota` skill):
 *   referral:codeof:u:<userId>   → the user's own short code (lazily minted)
 *   referral:code:<code>         → <userId>            (reverse lookup)
 *   referral:by:<refereeUserId>  → <referrerUserId>    (attribution + idempotency guard)
 *   referral:count:<referrerUserId> → integer          (successful referrals, UI + cap)
 *   usage:identity:bonus:u:<userId> → integer, NO expiry (granted identity credits — read
 *                                     by lib/identity.js to raise the effective limit)
 */
import redis from './redis.js';

// Max identity credits a single referrer can earn (bounds per-referrer $ exposure;
// at ~$0.06/credit, the default 10 caps one referrer at ~$0.60). Env-overridable.
const REWARD_CAP = (() => {
  const n = parseInt(process.env.REFERRAL_REWARD_CAP, 10);
  return Number.isFinite(n) && n > 0 ? n : 10;
})();

const CODE_LEN = 6;
const CODE_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

// Identity identifier for an authed user — must match getSessionAndTier()'s `u:<userId>`
// so the bonus key lines up with what resolveIdentityGate reads.
const ident = (userId) => `u:${userId}`;
const bonusKey = (userId) => `usage:identity:bonus:${ident(userId)}`;

function randomCode() {
  let c = '';
  for (let i = 0; i < CODE_LEN; i++) {
    c += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return c;
}

/** Parse a single cookie value out of the raw Cookie header. */
function readCookie(req, name) {
  const raw = req.headers?.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

/** Clear the ls_ref cookie on the response (called once the referral has been resolved). */
function clearRefCookie(res) {
  try {
    res.setHeader('Set-Cookie', 'ls_ref=; Path=/; Max-Age=0; SameSite=Lax');
  } catch {
    /* headers already sent — harmless; idempotency guard prevents a re-grant anyway */
  }
}

/**
 * Return the user's stable invite code, minting one on first use. Idempotent: the same
 * user always resolves to the same code. Collision-safe via set-if-not-exists on the
 * reverse key. Throws only if Redis is unavailable (callers handle/degrade).
 */
export async function getOrCreateCode(userId) {
  const ownKey = `referral:codeof:${ident(userId)}`;
  const existing = await redis.get(ownKey);
  if (existing) return existing;

  // Mint: find a free code, claim the reverse key atomically, then record it as the
  // user's own. If another concurrent mint won the own-key race, defer to that code.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const claimed = await redis.set(`referral:code:${code}`, String(userId), { nx: true });
    if (!claimed) continue; // code already taken — retry
    const wonOwn = await redis.set(ownKey, code, { nx: true });
    if (wonOwn) return code;
    // Lost the own-key race: a parallel mint already set this user's code. Use theirs.
    return await redis.get(ownKey);
  }
  throw new Error('referral code minting failed after retries');
}

/**
 * Invite link + live stats for the signed-in user. Counters degrade to 0 on a Redis
 * read error so the modal still renders the link.
 */
export async function getReferralStats(userId) {
  const code = await getOrCreateCode(userId);
  const base = (process.env.NEXTAUTH_URL || 'https://lifescript.app').replace(/\/$/, '');
  let referrals = 0;
  let bonusCredits = 0;
  try {
    referrals = parseInt(await redis.get(`referral:count:${userId}`), 10) || 0;
    bonusCredits = parseInt(await redis.get(bonusKey(userId)), 10) || 0;
  } catch {
    /* counters unavailable — link still works */
  }
  return { code, link: `${base}/?ref=${code}`, referrals, bonusCredits };
}

/**
 * Resolve a pending referral when the referee completes their first poster. Cookie-gated
 * (no cookie → instant no-op, zero Redis traffic), idempotent, and fail-safe. Grants the
 * referrer +1 identity credit (under the cap) and clears the cookie. Never throws.
 *
 * @returns {boolean} true only when a reward was actually granted (for logging).
 */
export async function maybeRedeemReferral(req, res, refereeUserId) {
  const code = readCookie(req, 'ls_ref');
  if (!code || !refereeUserId) return false;

  try {
    const referrerUserId = await redis.get(`referral:code:${code}`);
    if (!referrerUserId) { clearRefCookie(res); return false; }      // unknown/expired code

    if (String(referrerUserId) === String(refereeUserId)) {          // self-referral
      clearRefCookie(res);
      return false;
    }

    // Attribute ONCE, ever. nx fails (null) if this referee was already attributed.
    const claimed = await redis.set(`referral:by:${refereeUserId}`, String(referrerUserId), { nx: true });
    clearRefCookie(res); // resolved either way — don't let it fire again
    if (!claimed) return false;

    // Grant the reward only while the referrer is under their cap.
    const count = parseInt(await redis.get(`referral:count:${referrerUserId}`), 10) || 0;
    if (count >= REWARD_CAP) return false;

    await redis.incr(`referral:count:${referrerUserId}`);
    await redis.incr(bonusKey(referrerUserId)); // +1 effective identity credit (no expiry)
    return true;
  } catch (e) {
    // Redis down or unexpected error: skip the grant rather than risk a blind/duplicate
    // spend. The cookie persists, so a later poster can still redeem once Redis recovers.
    console.warn(`⚠️ Referral redemption skipped (fail-safe): ${e.message}`);
    return false;
  }
}
