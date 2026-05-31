import { getStripe } from '../../../lib/stripe.js';
import { getSessionAndTier } from '../../../lib/auth.js';

// ── Pro plan definition ───────────────────────────────────────────────────────
// Using inline price_data avoids a hard dependency on a pre-created Stripe
// Dashboard Product/Price ID. Stripe automatically deduplicates products by
// name within your account, so no phantom duplicates accumulate in the Dashboard.
const PRO_LINE_ITEM = {
  price_data: {
    currency: 'usd',
    product_data: {
      name: 'LifeScript Pro',
      description: 'Unlimited scripts · 3 posters/day · Full comic books · Reels generation',
      // Images and metadata can be added here later without changing the webhook.
    },
    unit_amount: 900,              // $9.00 — stored in cents as Stripe requires
    recurring: { interval: 'month' },
  },
  quantity: 1,
};

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed.' });
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────
  // getSessionAndTier resolves JWT → Redis tier in one call. We need both
  // userId (for metadata) and email (to pre-fill Stripe checkout).
  const { userId, tier, email } = await getSessionAndTier(req, res);

  if (!userId) {
    return res.status(401).json({ success: false, error: 'Authentication required.' });
  }

  // Guard against double-subscription: a Pro user hitting this endpoint would
  // create a second active subscription. Return early so the frontend can
  // redirect them to the customer portal instead.
  if (tier === 'pro') {
    return res.status(409).json({
      success: false,
      error: 'Already subscribed.',
      code: 'ALREADY_PRO',
    });
  }

  // ── Base URL ───────────────────────────────────────────────────────────────
  // NEXT_PUBLIC_APP_URL must be set in Vercel env vars.
  // Fallback to NEXTAUTH_URL for local dev where both are configured.
  const baseUrl = (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    'http://localhost:3000'
  ).replace(/\/$/, ''); // strip trailing slash

  try {
    const stripe = getStripe();

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [PRO_LINE_ITEM],

      // Pre-fill the email so the user doesn't have to type it again.
      customer_email: email ?? undefined,

      // ── Metadata ────────────────────────────────────────────────────────────
      // userId is embedded in TWO places intentionally:
      //
      //   1. session.metadata          — available on checkout.session.completed
      //   2. subscription_data.metadata — available on customer.subscription.*
      //      events (renewal, cancellation, etc.)
      //
      // The webhook reads from whichever event it receives, so userId is always
      // accessible regardless of which Stripe lifecycle event fires.
      metadata: { userId },
      subscription_data: {
        metadata: { userId },
      },

      // ── Redirect URLs ──────────────────────────────────────────────────────
      // ?checkout=success lets the frontend detect the return and show a
      // confirmation (e.g. open UpgradeModal in success state).
      success_url: `${baseUrl}/?checkout=success`,
      cancel_url:  `${baseUrl}/?checkout=cancelled`,

      // Allow discount codes created in the Stripe Dashboard.
      allow_promotion_codes: true,
    });

    // Return the hosted Checkout URL — the frontend redirects to it.
    return res.status(200).json({ success: true, url: session.url });

  } catch (err) {
    // Log the full error server-side (visible in Vercel logs) without leaking
    // internal Stripe details or stack traces to the client.
    console.error('🔴 Stripe checkout session creation failed:', {
      message: err.message,
      type:    err.type,       // StripeCardError, StripeInvalidRequestError, etc.
      code:    err.code,       // e.g. 'parameter_invalid_empty'
      param:   err.param,      // which parameter caused the error
    });

    return res.status(500).json({
      success: false,
      error: 'Could not create checkout session. Please try again.',
    });
  }
}
