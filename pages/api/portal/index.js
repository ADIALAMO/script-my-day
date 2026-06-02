import { getStripe } from '../../../lib/stripe.js';
import { getSessionAndTier } from '../../../lib/auth.js';
import redis from '../../../lib/redis.js';

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const { userId, email } = await getSessionAndTier(req, res);

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }

  // ── Stripe Customer ID lookup ──────────────────────────────────────────────
  // Primary: Redis key written by the webhook on checkout.session.completed.
  // Fallback: if the webhook hasn't fired yet (race condition in the seconds
  // immediately after checkout), search Stripe by the user's email and cache
  // the result so subsequent portal opens are instant.
  let stripeCustomerId = await redis.get(`user:stripe_customer:${userId}`);

  if (!stripeCustomerId && email) {
    try {
      const stripe     = getStripe();
      const customers  = await stripe.customers.list({ email, limit: 1 });
      if (customers.data.length > 0) {
        stripeCustomerId = customers.data[0].id;
        await redis.set(`user:stripe_customer:${userId}`, stripeCustomerId);
        console.log(`📋 Portal: cached Stripe customer via email fallback → ${stripeCustomerId}`);
      }
    } catch (lookupErr) {
      console.warn('Portal: Stripe customer fallback lookup failed:', lookupErr.message);
    }
  }

  if (!stripeCustomerId) {
    return res.status(404).json({
      success: false,
      error:   'Billing record not ready yet. If you just upgraded, please wait a moment and try again.',
      code:    'NO_CUSTOMER',
    });
  }

  // ── Base URL ───────────────────────────────────────────────────────────────
  const returnUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, '');

  // ── Create portal session ──────────────────────────────────────────────────
  try {
    const stripe        = getStripe();
    const portalSession = await stripe.billingPortal.sessions.create({
      customer:   stripeCustomerId,
      return_url: returnUrl,
    });

    return res.status(200).json({ success: true, url: portalSession.url });

  } catch (err) {
    console.error('🔴 Stripe portal session creation failed:', {
      message: err.message,
      type:    err.type,
      code:    err.code,
    });

    return res.status(500).json({
      success: false,
      error:   'Could not open billing portal. Please try again.',
    });
  }
}
