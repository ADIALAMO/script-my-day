import Stripe from 'stripe';

// Module-level singleton: survives across requests within the same warm
// serverless container. Both the checkout and webhook routes import this
// to avoid constructing separate instances with separate HTTP keep-alive pools.
let _stripe = null;

export function getStripe() {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not configured.');
    _stripe = new Stripe(key);
  }
  return _stripe;
}
