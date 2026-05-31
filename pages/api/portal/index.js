import { getStripe } from '../../../lib/stripe.js';
import { getSessionAndTier } from '../../../lib/auth.js';
import redis from '../../../lib/redis.js';

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const { userId } = await getSessionAndTier(req, res);

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }

  // ── Stripe Customer ID lookup ──────────────────────────────────────────────
  // Stored by the webhook when checkout.session.completed fires. If absent the
  // user either never completed a purchase or subscribed before this key was
  // introduced — either way the portal cannot be opened without a customer ID.
  const stripeCustomerId = await redis.get(`user:stripe_customer:${userId}`);

  if (!stripeCustomerId) {
    return res.status(404).json({
      success: false,
      error:   'No billing record found. If you believe this is an error, please contact support.',
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
