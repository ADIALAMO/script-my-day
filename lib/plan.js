/**
 * SINGLE SOURCE OF TRUTH for "what plan is this user on, and why".
 *
 * Everything that reads or changes the Pro flag goes through here:
 *   READ   resolvePlan()            ← lib/auth.js getSessionAndTier() (the per-request resolver)
 *   WRITE  grantPaidPro()           ← Stripe webhook  (checkout.session.completed)
 *          revokePaidPro()          ← Stripe webhook  (customer.subscription.deleted)
 *          setTierByAdmin()         ← /api/admin/set-tier
 *   The VIP allowlist (PRO_ALLOWLIST) is evaluated here too, never stored.
 *
 * Storage (unchanged): user:tier:<id> = 'pro' | 'admin' (absent = Free), plus
 * user:tier_source:<id> = {source:'stripe'|'admin', by?, at} and the stats:pro:members set.
 *
 * Protection rules (the point of centralising this):
 *   • a payment event NEVER overwrites an `admin` tier, and never changes the source of a Pro
 *     that an admin granted;
 *   • a cancellation NEVER revokes `admin`, nor Pro granted by an admin, nor a Pro of unknown
 *     origin that has no payment-provider customer on record.
 */
import { recordProSource, clearProSource, parseAllowlist } from './pro-source.js';

// Lazy: same reason as lib/auth.js — keeps the offline Redis stub out of module-load time.
async function getRedis() {
  return (await import('./redis.js')).default;
}

export function isProAllowlisted(email) {
  if (!email) return false;
  return parseAllowlist().includes(String(email).toLowerCase());
}

/** user:tier_source value (object or JSON string, as Upstash may hand back either) → {source, by, at}. */
export function parseGrantSource(raw) {
  if (!raw) return { source: null, by: undefined, at: null };
  try {
    const p = typeof raw === 'object' ? raw : JSON.parse(raw);
    return { source: p.source || null, by: p.by, at: p.at || null };
  } catch {
    return { source: null, by: undefined, at: null };
  }
}

/**
 * Pure classification from the stored values.
 * @returns {{tier:'free'|'pro'|'admin', plan:'free'|'pro', isPro:boolean,
 *            grantedBy:null|'payment'|'admin'|'allowlist'|'unknown'}}
 */
export function classifyPlan({ tierValue, rawSource, allowlisted = false }) {
  let tier = 'free';
  if (tierValue === 'pro') tier = 'pro';
  else if (tierValue === 'admin') tier = 'admin';

  const { source } = parseGrantSource(rawSource);
  let grantedBy = null;
  if (tier === 'admin') grantedBy = 'admin';
  else if (tier === 'pro') grantedBy = source === 'stripe' ? 'payment' : source === 'admin' ? 'admin' : 'unknown';
  else if (allowlisted) { tier = 'pro'; grantedBy = 'allowlist'; } // lifts free → pro only

  return { tier, plan: tier === 'free' ? 'free' : 'pro', isPro: tier !== 'free', grantedBy };
}

/**
 * The per-request resolver. Redis trouble → Free (never blocks anyone), but the allowlist still
 * applies because it needs no Redis.
 */
export async function resolvePlan({ userId, email }) {
  let tierValue = null;
  let rawSource = null;
  try {
    const redis = await getRedis();
    [tierValue, rawSource] = await redis.mget(`user:tier:${userId}`, `user:tier_source:${userId}`);
  } catch {
    // Redis unavailable — fail open to 'free' so a paying user is not blocked.
  }
  return classifyPlan({ tierValue, rawSource, allowlisted: isProAllowlisted(email) });
}

// ─── Writes ───────────────────────────────────────────────────────────────────────────

async function readGrant(redis, userId) {
  const [tierValue, rawSource] = await redis.mget(`user:tier:${userId}`, `user:tier_source:${userId}`);
  return { tierValue, source: parseGrantSource(rawSource).source };
}

/**
 * A payment succeeded. Grants Pro unless something stronger is already in place.
 * @returns {Promise<{changed:boolean, reason:string}>}
 */
export async function grantPaidPro(userId, stripeCustomerId) {
  const redis = await getRedis();
  const { tierValue, source } = await readGrant(redis, userId);

  // The customer id is always recorded (the billing portal needs it), whatever happens next.
  if (stripeCustomerId) await redis.set(`user:stripe_customer:${userId}`, stripeCustomerId);

  if (tierValue === 'admin') return { changed: false, reason: 'admin-protected' };
  if (tierValue === 'pro' && source === 'admin') return { changed: false, reason: 'admin-granted-kept' };

  await redis.set(`user:tier:${userId}`, 'pro');
  try { await redis.sadd('stats:pro:members', userId); }
  catch (e) { console.warn(`⚠️ Pro member set add skipped (Redis): ${e.message}`); }
  await recordProSource(userId, 'stripe');
  return { changed: true, reason: 'granted' };
}

/**
 * A subscription ended. Revokes ONLY Pro that came from a payment.
 * @returns {Promise<{changed:boolean, reason:string}>}
 */
export async function revokePaidPro(userId) {
  const redis = await getRedis();
  const { tierValue, source } = await readGrant(redis, userId);

  if (!tierValue) return { changed: false, reason: 'not-pro' };
  if (tierValue === 'admin') return { changed: false, reason: 'admin-protected' };
  if (source === 'admin') return { changed: false, reason: 'admin-granted-kept' };

  // Source 'stripe' → ours to revoke. No source recorded (grant predates tracking): only treat it
  // as a payment if a payment-provider customer is on record; otherwise keep it.
  if (source !== 'stripe') {
    const customer = await redis.get(`user:stripe_customer:${userId}`);
    if (!customer) return { changed: false, reason: 'unknown-origin-kept' };
  }

  await redis.del(`user:tier:${userId}`);
  try { await redis.srem('stats:pro:members', userId); }
  catch (e) { console.warn(`⚠️ Pro member set remove skipped (Redis): ${e.message}`); }
  await clearProSource(userId);
  return { changed: true, reason: 'revoked' };
}

/** Admin dashboard / API-key grant or revoke. tier ∈ 'free' | 'pro' | 'admin'. */
export async function setTierByAdmin(userId, tier, by) {
  const redis = await getRedis();
  const key = `user:tier:${userId}`;
  if (tier === 'free') await redis.del(key);
  else await redis.set(key, tier);

  // SADD/SREM are idempotent so SCARD stays accurate however often a tier is re-applied.
  // 'admin' counts as Pro for the paying-users headline. Best-effort.
  try {
    if (tier === 'free') await redis.srem('stats:pro:members', userId);
    else                 await redis.sadd('stats:pro:members', userId);
  } catch (e) {
    console.warn(`⚠️ Pro member set update skipped (Redis): ${e.message}`);
  }

  if (tier === 'free') await clearProSource(userId);
  else await recordProSource(userId, 'admin', by);
}
