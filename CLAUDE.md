# LIFESCRIPT Studio — Architecture & Context

> **What it is:** A bilingual (Hebrew/English, RTL-aware) web app that turns a
> user's day/life into a **cinematic screenplay**, then into a **movie poster**, a
> **comic book**, and **reels**. Signature feature: **"Star Yourself"** — upload a
> face and become the character in your own poster. Tagline: *"הפוך את היום שלך
> לתסריט קולנועי מרתק" / "Turn your day into a captivating cinematic script."*

## Stack
- **Next.js 15 (Pages Router) + React 19**, deployed on **Vercel**.
- **Tailwind CSS 3** + **framer-motion**; `lucide-react` icons.
- **Upstash Redis** — quota counters + circuit-breaker state.
- **Cloudflare R2** (S3 API) — image/asset storage (`posters/`, `panels/`,
  `characters/` prefixes).
- **Stripe** — `$9/mo` Pro subscription (inline `price_data`, no dashboard Price ID).
- **NextAuth** — Google OAuth + email magic-link.
- **AI:** multi-provider cascade (text + image) with a circuit breaker — see below.
- Admin notifications via Telegram; transactional email via nodemailer.

## Directory map
```
pages/
  index.js                 Main SPA (hero, script form, poster/comic/reel UI)
  admin.js                 Admin dashboard
  api/
    generate-script.js     → lib/story-service.js (text cascade)
    generate-poster.js     Image cascade + identity gate (poster & comic panels)
    generate-storyboard.js Comic/storyboard plan — OWNS comic quota
    upload-character.js    "Star yourself" upload → Character Sheet
    character.js           Character read/restore
    upload-panel.js        Persist a generated panel to R2
    provider-health.js     Circuit-breaker status snapshot
    checkout/ portal/ stripe/webhook.js   Stripe billing
    auth/[...nextauth].js  NextAuth
    me.js  feedback.js  proxy-image.js  admin/set-tier.js
lib/
  agent.js          buildScriptPrompt + SYSTEM_PROMPT + per-genre GENRE_DNA
  story-service.js  generateScript() 5-stage text cascade
  circuit-breaker.js  Redis circuit breaker (circuit:img:* keys)
  identity.js       "Star yourself" providers, gate, credit accounting
  quota.js          TIER_LIMITS — single source of truth for limits
  blob-store.js     Cloudflare R2 put/decode
  auth.js           getSessionAndTier (tier + identifier resolution)
  messages.js       CODES.* — localized message symbols
  redis.js  stripe.js  api-utils.js
components/  React UI (PosterRenderer, StoryboardView, CharacterModal, UpgradeModal, …)
constants/   genres.js, language.js, modalData.js, showcase.js (bilingual copy)
hooks/       usePosterGeneration, useStoryboardGeneration, useCharacter, …
```

## Core subsystems (each has a dedicated skill in `.claude/skills/`)

### 1. AI provider cascade + circuit breaker → skill `providers`
Two independent cascades, each tries providers in order and returns the first success.
- **Text** ([lib/story-service.js](lib/story-service.js)): Stage 1 Google **Gemini**
  (parallel race across flash models, winner aborts the rest) → 2 OpenRouter **Gemma 3**
  → 3 **Cohere** Command R+ → 4 **DeepSeek** → 5 OpenRouter **free** models. ~60s budget.
- **Image** ([pages/api/generate-poster.js](pages/api/generate-poster.js)): P1 **Cloudflare**
  Workers AI flux-1-schnell → P2 **OpenRouter** flux.2-klein → P3 **HuggingFace** FLUX.1-schnell
  → P4 **Pollinations** (anonymous, throttled 1 req/15s, last resort). All fail → placeholder
  SVG at HTTP 200 (never a JSON error).
- **Circuit breaker** ([lib/circuit-breaker.js](lib/circuit-breaker.js)): Redis `circuit:img:*`,
  status-aware open durations (429→45s, 503→20s, 402/403→until UTC midnight, default 15s),
  **config errors (no HTTP status) never trip the circuit**. Fail-open. `PROVIDER_KEY` +
  `PROVIDERS` must include every runner by `fn.name`.
- **Dead ends (don't relitigate):** Prodia (paywall) removed; Pollinations stays last.

### 2. FLUX image prompting → skill `flux-prompt`
All image providers are FLUX-family. **FLUX wants clean positive prose, not keyword
stacks, weights, or negations.** Negation/anatomy nouns *summon* defects — do **not**
add "no extra fingers / correct hands" guards (documented losing loop). Posters get a
cinematic 35mm wrapper; comic panels stay bare prose. The textless-poster suffix is the
one sanctioned exception. The LLM emits the image prompt as the mandatory `[image: …]`
last line of every script (per-genre `poster` templates in `GENRE_DNA`).

### 3. "Star Yourself" identity → skill `identity`
Reference-conditioned image gen via OpenRouter: **Grok** (`x-ai/grok-imagine-image-quality`,
~$0.06, signature look) and **Gemini** (`google/gemini-2.5-flash-image`, ~$0.039, parity).
Pro+/admin run QUALITY (Grok→Gemini); the free lifetime taste runs VALUE (Gemini→Grok) to
cap cost. Identity providers are prepended to the faceless cascade; on failure it degrades
to faceless and **no credit is spent** (gated on `faceApplied`). `resolveIdentityGate`
enforces tier + quota **before** any paid call. Moderation (nemotron) is **fail-closed**.
Faces stored in R2 (`characters/`), Redis holds only the URL.

### 4. Tiers & quota → skill `quota`
Single source of truth: `TIER_LIMITS` in [lib/quota.js](lib/quota.js). Always use
`limitFor(tier, feature)`, never read the table directly in routes.

| feature | anon | free | pro | admin | period |
|---|---|---|---|---|---|
| script | 2 | 3 | ∞ | ∞ | daily |
| poster | 0 | 1 | 3 | ∞ | daily |
| comic | 0 | 1 | 2 | ∞ | daily |
| unlockedPanels | 0 | 2 | 7 | ∞ | per comic |
| identity | 0 | 1 | 30 | ∞ | monthly (free = **lifetime, no expiry**) |

Redis keys: `usage:<feature>:<identifier>:<YYYY-MM-DD>` (daily, `expireat` next UTC
midnight) / `usage:identity:<id>:<YYYY-MM>` (monthly) / `usage:identity:lifetime:<id>`
(no expiry). **Comic quota is owned by generate-storyboard.js**, not generate-poster.js.
Pattern: check → 403/429 with a `CODES.*` → increment only on success → fail-open on Redis
errors. Stripe `$9/mo` Pro; `userId` in both session + subscription metadata for the webhook.

**Pro source tracking** ([lib/pro-source.js](lib/pro-source.js)): every Stripe or admin-dashboard
Pro/admin grant writes `user:tier_source:<userId>` → `{source, by?, at}`. Three sources: `stripe`
(webhook), `admin` (admin dashboard, `by` = granting admin's email), `allowlist` (never written —
computed live from `PRO_ALLOWLIST` + cross-referenced against `user:email:*`). Powers the admin
dashboard's "Pro Users" view (`pages/api/admin/pro-users.js`); grants predating this mechanism
show as `unknown`.

**All-users index** ([lib/auth.js](lib/auth.js) `events.signIn`): `stats:users:all` is a Redis
sorted set (score = signup unix-ms, member = userId), written once per new account alongside the
plain `stats:users:total` counter — gives O(log N) newest-first pagination for the admin
dashboard's "All Users" view (`pages/api/admin/users.js`), unlike a bare counter. `user:signup_provider:<userId>`
(plain string, `'google'`\|`'email'`) is written the same call. Signups predating this mechanism
were backfilled via `scripts/backfill-user-signups.js` (one-time `SCAN MATCH user:email:*`,
`ZADD ... NX` with score `0` — sorts last, shown as "before tracking started"; their provider is
left unset, shown as "Unknown" — same precedent as pro-source above). `user:last_active:<userId>`
is stamped by `/api/me`, throttled to once per 24h. A deleted user (see
[pages/api/request-deletion.js](pages/api/request-deletion.js) — logs the request for **manual**
processing only, does not itself delete any keys) is detected at read time in `users.js` — a
missing `user:<id>` record excludes it from the response and opportunistically `ZREM`s it, self-healing
the index regardless of how the deletion actually happened.

### 5. Bilingual + RTL → skill `bilingual`
Every user-facing string must exist in **both** `he` and `en`. Components branch on a
`lang` prop (`lang === 'he' ? … : …`); data files use paired keys (`label: {he, en}`,
`titleHe`/`titleEn`). Hebrew needs `dir="rtl"` + `font-heebo` and mirrored directional
classes. API errors return `CODES.*` symbols (localized client-side), not raw English.
Generated-content language is auto-detected (`detectLanguage` / `HEBREW_RANGE`) and the
script LLM is hard-locked to the input language.

## Conventions & gotchas
- Provider errors are thrown as `"<Name> <httpStatus>: <body slice>"` so
  `extractStatusCode` can parse them for the circuit breaker. Preserve this shape.
- Quota/identity checks **fail-open** on Redis outages (never block paying users);
  increments are best-effort and happen **after** success.
- Never trust client-supplied tier/userId — resolve via `getSessionAndTier`.
- R2 character assets are immutable (`max-age=…, immutable`); Redis stores only pointers.
- `.env.example` documents every required env var.

## Project stage & growth
LIFESCRIPT is **deployed and live**; the current bottleneck is **distribution +
traction**, not features. Marketing, user acquisition, and investor outreach are handled
by the `growth` skill (`.claude/skills/growth/`). Recommended sequence: viral share loop →
concentrated launch (Product Hunt + communities) → fundraise once there's traction evidence.

## The `.claude/skills/` skills (auto-load by context)
`providers` · `flux-prompt` · `identity` · `quota` · `bilingual` · `growth`. They activate
automatically when you touch the matching area; read the relevant one before changing that
subsystem.
