import { getStripe } from '../../../lib/stripe.js';
import redis from '../../../lib/redis.js';

// ── Critical: disable Next.js body parser ─────────────────────────────────────
// Stripe signature verification requires the raw, un-parsed request body as a
// Buffer. If Next.js parses it first (its default), the byte sequence changes
// and constructEvent throws a SignatureVerificationError every time.
export const config = {
  api: { bodyParser: false },
};

// ── Raw body collector ────────────────────────────────────────────────────────
// Reads the readable stream into a single Buffer. No external dependency needed.
function collectRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk =>
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    );
    req.on('end',   () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// ── Tier helpers ──────────────────────────────────────────────────────────────

async function activatePro(userId, stripeCustomerId) {
  const ops = [redis.set(`user:tier:${userId}`, 'pro')];
  if (stripeCustomerId) {
    ops.push(redis.set(`user:stripe_customer:${userId}`, stripeCustomerId));
  }
  await Promise.all(ops);
  // Keep the dashboard Pro member set (/api/admin/stats) in sync. Idempotent.
  try { await redis.sadd('stats:pro:members', userId); }
  catch (e) { console.warn(`⚠️ Pro member set add skipped (Redis): ${e.message}`); }
  if (!stripeCustomerId) {
    console.warn(`⚠️ Stripe webhook: Pro activated for ${userId} — no customer ID, billing portal disabled`);
  }
}

async function revokePro(userId) {
  // del removes the key entirely; getSessionAndTier defaults absent keys to 'free'.
  await redis.del(`user:tier:${userId}`);
  try { await redis.srem('stats:pro:members', userId); }
  catch (e) { console.warn(`⚠️ Pro member set remove skipped (Redis): ${e.message}`); }
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig           = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error('❌ Stripe webhook: missing signature header or STRIPE_WEBHOOK_SECRET env var.');
    return res.status(400).json({ error: 'Webhook configuration error.' });
  }

  // ── Signature verification ────────────────────────────────────────────────
  let event;
  try {
    const rawBody = await collectRawBody(req);
    event = getStripe().webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    // This fires when:
    //   • The body was modified in transit (proxy issue)
    //   • bodyParser was accidentally left enabled
    //   • Wrong webhook secret (test vs live keys mixed up)
    console.error('❌ Stripe webhook signature verification failed:', err.message);
    return res.status(400).json({ error: `Signature error: ${err.message}` });
  }

  // ── Event routing ─────────────────────────────────────────────────────────
  // Return 200 immediately after processing — Stripe retries any event that
  // doesn't receive a 2xx within 30s. Return 500 only for genuine processing
  // failures that benefit from a retry.
  try {
    switch (event.type) {

      // ── Subscription created / payment confirmed ────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object;

        // Skip sessions that aren't paid yet (e.g. BACS debit, bank transfer).
        // Those fire a separate payment_intent.succeeded when funds actually clear.
        // For card payments (our only payment_method_type) this is always 'paid'.
        if (session.payment_status !== 'paid') {
          break;
        }

        const userId = session.metadata?.userId;
        if (!userId) {
          // This means checkout/index.js didn't pass metadata — programmer error.
          console.error('❌ checkout.session.completed: no userId in session.metadata.', session.id);
          break;
        }

        await activatePro(userId, session.customer);
        break;
      }

      // ── Subscription cancelled (user or payment failure) ────────────────────
      // Fires when a subscription ends for any reason:
      //   • Customer cancels via portal
      //   • Payment fails too many times and Stripe auto-cancels
      //   • Subscription is deleted via API (e.g. admin refund)
      //
      // We read userId from subscription.metadata because this event has no
      // session object — userId was embedded in subscription_data.metadata
      // inside checkout/index.js precisely for this case.
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const userId = subscription.metadata?.userId;

        if (!userId) {
          console.error('❌ customer.subscription.deleted: no userId in subscription.metadata.', subscription.id);
          break;
        }

        await revokePro(userId);
        break;
      }

      // ── Acknowledge all other events without processing ─────────────────────
      // Stripe will stop retrying events that receive a 200. Silently ignoring
      // unknown types here is correct — only subscribe to the events you need
      // in the Stripe Dashboard webhook settings.
      default:
        break;
    }
  } catch (err) {
    console.error('🔴 Stripe webhook processing error:', {
      eventType: event.type,
      eventId:   event.id,
      message:   err.message,
    });
    // 500 tells Stripe to retry — appropriate for transient errors like a
    // Redis timeout. Permanent errors (missing metadata) are handled above
    // with a break so they don't retry endlessly.
    return res.status(500).json({ error: 'Webhook processing failed. Will retry.' });
  }

  return res.status(200).json({ received: true });
}
