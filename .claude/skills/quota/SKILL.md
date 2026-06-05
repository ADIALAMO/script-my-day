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
[lib/quota.js](lib/quota.js); read it before changing anything.

## Tiers & limits (`TIER_LIMITS`)
| feature | anonymous | free | pro | admin | period |
|---|---|---|---|---|---|
| script | 2 | 3 | ∞ | ∞ | **daily** |
| poster | 0 | 1 | 3 | ∞ | **daily** |
| comic | 0 | 1 | 2 | ∞ | **daily** |
| maxPanels | 0 | 7 | 7 | 7 | (LLM plan size) |
| unlockedPanels | 0 | 2 | 7 | ∞ | per comic |
| identity | 0 | 1 | 30 | ∞ | **monthly** (free = **lifetime**) |

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
  `usage:identity:lifetime:<id>` (no expiry) — see the `identity` skill.
- Circuit breaker uses a separate `circuit:img:*` namespace — never mix the two.

`<identifier>` comes from `getSessionAndTier(req, res)` (userId for signed-in, else
an anonymous identifier). Always resolve tier+identifier through `lib/auth.js`,
never trust client-supplied tier/userId.

## Ownership rule that bites people
**Comic/storyboard quota is owned by [generate-storyboard.js](pages/api/generate-storyboard.js).**
Panel image calls in generate-poster.js (`requestType === 'comic'|'storyboard'`) do
**NOT** increment any poster counter — they only enforce the per-panel
`unlockedPanels` gate (a second, independent paywall layer so direct API calls
can't bypass it). If you add comic-cost logic, put it in the storyboard route, not
the poster route.

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

## Stripe ↔ tier sync
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
