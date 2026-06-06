// Single flag for whether real Stripe billing is live to the public.
//
// While false (Stripe still in Test Mode pre-launch), the public sees a Pro
// WAITLIST instead of the checkout — so nobody can self-unlock unlimited
// generation with the test card and burn the AI/infra budget. Invited VIPs
// still get Pro via the PRO_ALLOWLIST email allowlist (see lib/auth.js),
// bypassing this flag entirely.
//
// Flip to 'true' (Vercel env) the day Stripe goes Live — no code change needed.
// NEXT_PUBLIC_ so the browser bundle can read it.
export const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === 'true';
