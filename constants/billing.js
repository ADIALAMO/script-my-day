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
//
// LAUNCH CHECKLIST — while no payment provider is live, ALL web copy says "Pro coming soon" with NO price and
// NO "cancel anytime" (tests/native-copy.test.js + limits-copy.test.js enforce it). The day a provider goes live,
// revisit: constants/limits-copy.js (proNotAvailable*, termsPlans*, faqPlans*, proBlurb*), constants/modalData.js
// (Terms §3 + Privacy §5 + the "When can I upgrade" guide item), components/LaunchTicket.jsx, lib/messages.js
// (NEEDS_PRO / QUOTA_COMIC_MONTH / IDENTITY_LIFETIME_USED), components/StoryboardView.jsx locked-panel CTAs,
// the web-only components/UpgradeModal.jsx (still shows $9 — only reachable when this flag is true), store-listing/*.
export const BILLING_ENABLED = process.env.NEXT_PUBLIC_BILLING_ENABLED === 'true';
