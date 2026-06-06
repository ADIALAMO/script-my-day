# LIFESCRIPT — TODO

## 💳 Payments — CURRENT STATE: Stripe **TEST MODE** (Beta) 🟡

**Decision (intentional):** during the viral Beta, Stripe runs in **Test Mode** in
production. The founder operates from Israel; Stripe does **not** support Israeli
bank accounts/entities directly, so Live billing is blocked until a payout path
exists (see Phase 2.0 below). This is a deliberate hand-brake, not a bug.

**Why this is safe:**
- Auth/signup and the **free tier** (1 poster/day, 1 lifetime "Star Yourself") work
  with **zero payment** — that's the viral hook, fully functional for everyone.
- Pro purchase in Test Mode: friends use a Stripe **test card** (`4242 4242 4242
  4242`, any future expiry/CVC) to get Pro free → framed as a **"free Beta for
  friends."** A cold visitor who tries a real card just gets a graceful decline
  (no crash). The viral loop does **not** depend on real payments.

**Code is env-driven — no code change needed to stay in Test Mode.** Just set the
Vercel env vars to the TEST keys:
- [ ] `STRIPE_SECRET_KEY = sk_test_...`
- [ ] `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = pk_test_...`
- [ ] `STRIPE_WEBHOOK_SECRET = whsec_...` ← **the TEST-mode signing secret**

### ⚠️ Webhook gotcha (must verify or Pro won't activate)
The webhook signing secret **differs between Test and Live**, and the endpoint must
be registered in the Stripe **Test-mode** dashboard. If the secret/endpoint is from
Live while the keys are Test, signature verification fails → the webhook never flips
the user to `pro` in Redis → "purchase" succeeds on Stripe but the app stays Free.
- [ ] In Stripe Dashboard **(Test mode toggle ON)** → Developers → Webhooks → add the
      prod endpoint `https://lifescript.app/api/stripe/webhook`, copy its `whsec_…`
      into `STRIPE_WEBHOOK_SECRET`.
- [ ] Smoke test: complete a `4242` checkout → confirm Navbar shows Pro (tier flips
      in Redis via the webhook).

> Optional polish (not required): add a small "Beta — free Pro for friends" hint in
> `UpgradeModal` so testers know to use card 4242. Ask before building.

---

## 🚀 Phase 2.0 — go Stripe **LIVE** (a real payout path)

Trigger: do this **only** once there's revenue intent/traction (first willing-to-pay
users, or the agreed MRR/signups trigger) — not before. The app is payment-key
agnostic, so going Live is "swap env keys + register the Live webhook." **Zero
architecture change** either way. The only coupling is the webhook secret/endpoint
and the inline `$9/mo` price (no dashboard Price ID — travels to any account).

### Option A — Payoneer / Mercury (virtual US bank) + US Stripe
- **What:** open a US receiving account (Payoneer "Global Payment Service" or, easier
  for Stripe, **Mercury**) and a US Stripe account; payouts land there, withdraw to
  the Israeli bank.
- **Pros:** fast, cheap/free, no incorporation, validate revenue quickly.
- **Cons:** Stripe still wants a US business identity; using a US address without a
  real entity is **gray-area vs Stripe ToS** → risk of account freeze / funds hold.
  Payoneer is only the *banking* layer, not a *legal* entity. Fine for small
  validation; **not** for scale or holding meaningful balances.

### Option B — Stripe Atlas (US LLC / C-corp) ✅ recommended for the real thing
- **What:** Atlas forms a real US entity (Delaware) + EIN + US bank (Mercury) + Stripe
  Live, ~$500 one-time + annual costs (registered agent ~$100/yr, DE franchise tax).
- **Pros:** fully legitimate Stripe Live, clean payouts, and **investor-ready** — VCs
  expect a US **C-corp** (Atlas supports it). This is the right vehicle if/when raising.
- **Cons:** cost + **US tax filing obligations even at $0 revenue** (foreign-owned LLC
  → Form 5472/1120, penalties if missed); accounting overhead.

### Recommendation
- **Now (Beta):** stay Test Mode. Don't spend $500 on Atlas pre-traction.
- **When validating first revenue cheaply:** Mercury + US Stripe is the fastest hop
  (accept the ToS risk for small volume).
- **When you commit to raising / scaling:** **Stripe Atlas C-corp** — clean, durable,
  and what investors want. Do it *with* the fundraise, not before.
- Middle path some IL founders use: Mercury + a US LLC via Atlas/Firstbase/Doola — but
  any entity triggers annual US tax filings, so only once it's worth the overhead.

### When we flip to Live (checklist for future-me)
- [ ] Live keys in Vercel (`sk_live_`, `pk_live_`).
- [ ] Register the **Live** webhook endpoint → put its `whsec_` in `STRIPE_WEBHOOK_SECRET`.
- [ ] Re-run the `4242`→ now a **real card** smoke test; confirm tier flips to `pro`.
- [ ] Update `UpgradeModal` copy if the "Beta" framing was added.
