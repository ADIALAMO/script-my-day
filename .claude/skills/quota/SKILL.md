---
name: quota
description: >-
  Safety rules for LIFESCRIPT's tier/quota system (Redis usage counters + Stripe
  tiers). Use when changing TIER_LIMITS, adding a paywalled/gated feature, touching
  any `usage:*` Redis key, editing quota checks in generate-poster / generate-script
  / generate-storyboard, the tier resolution in lib/auth.js, Stripe tier sync
  (pages/api/stripe/webhook.js, checkout, admin/set-tier), or the UpgradeModal
  limits table. Triggers on: quota, tier, limit, paywall, free/pro/anonymous,
  daily reset, Stripe subscription, usage counter.
---

# LIFESCRIPT — Tier & Quota Safety

Quota bugs silently break either revenue (gate too loose) or UX (gate too tight),
and the rules are subtle. The single source of truth for limits is
[config/limits.js](config/limits.js) (re-exported through [lib/quota.js](lib/quota.js)); read it
before changing anything. Newer limits (comic month/panels, regen, sheet uploads, magic-link, proxy) and
their env overrides are defined there too.

## Tiers & limits (`TIER_LIMITS`)
| feature | anonymous | free | pro | admin | period |
|---|---|---|---|---|---|
| script | 2 | 5 | 20 | ∞ | **daily** |
| poster | 1 (lifetime) | 2 | 3 | ∞ | **daily** |
| comic | 0 | 3 | 2 | ∞ | free = **monthly**, pro = **daily** |
| maxPanels | 0 | 7 | 7 | 7 | (LLM plan size) |
| unlockedPanels | 0 | 7 (1st comic ever) / 3 (later) | 7 | ∞ | per comic (stored in `comic:meta:<seed>`) |
| identity | 0 | 1 | 30 | ∞ | **monthly** (free = **lifetime**) |
| character-sheet uploads | 0 | 3 | 30 | ∞ | **monthly** (`usage:sheet:<id>:<YYYY-MM>`) |

`limitFor(tier, feature)` is the only accessor — use it; never read `TIER_LIMITS`
directly in routes. `Infinity` means uncapped (skip increment). Note `maxPanels` is
always 7 even for free (full narrative plan) — but `unlockedPanels` controls how
many actually get images; **locked panels skip image generation = zero wasted
credits.** Don't generate images for panels ≥ `unlockedPanels`.

## Redis key schema (each feature owns its own)
- Poster (daily): `usage:poster:<identifier>:<YYYY-MM-DD>` → `expireat(nextMidnightUTC())`
- Script (daily): `usage:script:<identifier>:<YYYY-MM-DD>`
- Comic (daily): owned by **generate-storyboard.js**, not generate-poster.
- Identity: monthly `usage:identity:<id>:<YYYY-MM>` / lifetime
  `usage:identity:lifetime:<id>` (no expiry) / **global daily spend**
  `usage:identity:global:<YYYY-MM-DD>` (powers the budget kill-switch) / **referral bonus**
  `usage:identity:bonus:<id>` (no expiry — raises the effective identity limit) — see the
  `identity` skill.
- Referral loop: `referral:codeof:<id>` / `referral:code:<code>` / `referral:by:<refereeId>`
  / `referral:count:<referrerId>` — owned by [lib/referral.js](lib/referral.js).
- Circuit breaker uses a separate `circuit:img:*` namespace — never mix the two.

`<identifier>` comes from `getSessionAndTier(req, res)` (userId for signed-in, else
an anonymous identifier). Always resolve tier+identifier through `lib/auth.js`,
never trust client-supplied tier/userId.

## Ownership rule that bites people
**Comic/storyboard quota is owned by [generate-storyboard.js](pages/api/generate-storyboard.js)**
(Free: monthly, Pro: daily — `lib/comic-quota.js`). Panel image calls in generate-poster.js
(`requestType === 'comic'|'storyboard'`) never touch that counter; they go through
`lib/comic-guard.js` instead (owner + this comic's unlocked count + per-user daily panel cap +
replacement budget), so direct API calls can't reach a locked panel or regenerate one repeatedly.
If you add comic-cost logic, put it in the storyboard route or comic-guard, not the poster route.

## The standard gate pattern (match it exactly)
1. `const { tier, identifier } = await getSessionAndTier(req, res)`
2. `const limit = limitFor(tier, feature)`
3. `limit === 0` → `403` with the right `CODES.*` (NEEDS_ACCOUNT / NEEDS_PRO).
4. Read `usage:*` key; if `limit !== Infinity && used >= limit` → `429` with
   `CODES.QUOTA_*`.
5. **Increment only AFTER a successful generation** (`incr` + `expireat` in a
   pipeline), and skip increment when `Infinity` or admin.
6. **Fail-open on Redis errors** in the *check* (log a warning, proceed) — a Redis
   outage must not block paying users. The increment is best-effort too.
   **EXCEPTION — identity is FAIL-CLOSED.** It's the only feature that spends real $
   per call, so when its quota can't be verified (Redis down) it degrades to the
   faceless cascade instead of proceeding. Don't apply the fail-open rule there.

## Aggregate cost ceiling — the identity budget kill-switch
Per-user quota stops one abuser; it does **not** cap TOTAL spend during a traffic
spike or a flood of fresh free signups. `DAILY_IDENTITY_BUDGET` (USD, optional env)
is a hard ceiling on aggregate identity spend per UTC day via the global counter
`usage:identity:global:<YYYY-MM-DD>`. Once hit, `identityBudgetReached()` (in
[lib/identity.js](lib/identity.js)) degrades identity to faceless — the app stays up,
just without faces — until midnight UTC. Worst-case cost/call assumed `$0.06` (Grok)
so the dollar cap is a true upper bound. Unset = no cap. This is the primary defense
for a small prepaid AI balance; any new per-call paid feature should get a similar one.

## Referral bonus credits (effective identity limit)
The referral loop ([lib/referral.js](lib/referral.js)) grants the **referrer** +1 identity
credit per activated friend, stored as `usage:identity:bonus:<id>` (no expiry). The identity
gate compares `used` against **`base limit + bonus`** (not the raw `limitFor`), so a rewarded
free user can make extra Star-Yourself posters. Keep `resolveIdentityGate` and
`identityQuotaExceeded` in sync on this. Cost is bounded by the per-referrer cap
(`REFERRAL_REWARD_CAP`, default 10) AND the global `DAILY_IDENTITY_BUDGET` kill-switch, which
still applies on top of any bonus. The grant is fail-safe (skipped, never blind/double) and
idempotent (one attribution per referee via `set(..., {nx:true})`).

## Stripe ↔ tier sync
> **Beta status:** Stripe runs in **TEST MODE** in production (intentional — Israeli
> founder has no Live payout path yet; see [TODO.md](TODO.md)). Pro "purchases" use test
> card `4242…` ("free Beta for friends"). All Stripe code is **env-driven** (test vs live
> = which keys are set in Vercel), so this is a config state, not a code branch. Going Live
> is a Phase-2.0 swap of keys + the Live webhook secret — no code change.

- `$9/mo` Pro via inline `price_data` in [checkout](pages/api/checkout/index.js)
  (no dashboard Price ID dependency). `userId` is in **both** session metadata and
  `subscription_data.metadata` so the webhook can read it from any lifecycle event.
- The webhook flips the user's tier in Redis. When adding a new gated capability,
  make sure both the webhook (grant) and the cancellation path (revoke) move the
  user between `free`/`pro` correctly.
- Double-subscribe guard: checkout returns `409 ALREADY_PRO` for existing Pro users
  → frontend routes them to the customer portal.
- `admin/set-tier` + `ADMIN_EMAILS`/`ADMIN_SECRET` bypass for testing.

## Checklist for any quota change
1. Update `TIER_LIMITS` in lib/quota.js (single source) — and the UpgradeModal
   table reads from it, so keep labels in sync.
2. Use `limitFor`, not raw `TIER_LIMITS`, in code paths.
3. Correct period: daily (`nextMidnightUTC`) vs monthly (`nextMonthStartUTC`) vs
   lifetime (no expiry).
4. Increment only on success; fail-open on check.
5. Put comic accounting in the storyboard route.
6. If it's paywalled, verify both the Stripe grant and revoke paths.

## Reservation pattern, comic guard and budgets
- **Reserve, don't read-then-write.** Script, comic, character-sheet and panel counters now use
  `INCR` then compare, and `DECR` on refusal / failure (lib/script-quota.js, comic-quota.js,
  sheet-quota.js, comic-guard.js, budget.js `reserveIdentityBudget`). Concurrent requests can no
  longer all pass the check.
- **Comic panels** are gated by lib/comic-guard.js: the storyboard opens `comic:meta:<seed>`
  (owner + unlocked count); every panel request needs it, spends the per-user daily panel cap and
  the per-comic replacement budget (`COMIC.regenLimit`). The browser limit is display only.
- **Plan/Pro flag**: read and written ONLY via lib/plan.js (`resolvePlan`, `grantPaidPro`,
  `revokePaidPro`, `setTierByAdmin`). Payment events never touch `admin` or admin-granted Pro.
- **Budgets** (`DAILY_IMAGE_BUDGET`, `DAILY_IDENTITY_BUDGET`): once-per-day log + Telegram alert via
  lib/budget-alerts.js; users get `IDENTITY_BUDGET_REACHED` / `IMAGE_BUDGET_REACHED` messages.
