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
  credit-failure.js   OpenRouter credit (HTTP 402): counter + deduped Telegram alert + recovery notice
  character-stats.js  Star Yourself outcome counters (stats:character:<day>:<outcome>, 60 days)
  identity.js       "Star yourself" providers, gate, credit accounting
  quota.js          TIER_LIMITS — single source of truth for limits
  blob-store.js     Cloudflare R2 put/decode
  auth.js           getSessionAndTier (tier + identifier resolution)
  messages.js       CODES.* — localized message symbols
  redis.js  stripe.js  api-utils.js
components/  React UI (PosterRenderer, StoryboardView, CharacterModal, UpgradeModal, …)
tools/quality-eval/  OFFLINE script-quality benchmark (never part of the app; own keys/budget) — see model inventory below
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
  Workers AI flux-1-schnell → P2 **HuggingFace** FLUX.1-schnell (OMITTED from the cascade
  unless `HF_PROVIDER_ENABLED='true'` — see dead ends below) → P3 **OpenRouter** flux.2-klein
  (Pollinations was REMOVED from every chain in the content-safety hotfix — an unfiltered anonymous
  public service is not acceptable under Google Play's AI-Generated Content policy; there is no env
  switch, it is gone from the code). All fail → placeholder SVG at HTTP 200 (never a JSON error).
  **A content refusal ends the request** (Cloudflare 8007 NSFW, an OpenRouter/Grok/Gemini safety
  block → `isContentRefusal` in [lib/content-safety.js](lib/content-safety.js)): placeholder +
  `CODES.CONTENT_REFUSED`, reservations released, **never retried on another provider**. Only technical
  failures (timeout, 429, 5xx, schema errors) fall through.
  **Output check** ([lib/image-check.js](lib/image-check.js)): every generated image (poster, panel, identity
  image, Character Sheet) is classified BEFORE it is shown or stored. Primary = the PAID `nvidia/nemotron-3.5-content-safety` on DeepInfra with `provider.data_collection:"deny"` (budget `DAILY_NEMOTRON_BUDGET`; see 4g) (strict, pinned
  `User Safety: safe|unsafe` parse); fallback = `google/gemini-2.5-flash-lite` **via OpenRouter** (same key, `provider.data_collection:"deny"`, strict
  JSON verdict, paid ≈ $0.00012/image, capped by `DAILY_CHECK_BUDGET`, default $0.50/day, 0 = off; no Google key needed) after a 429/5xx/timeout OR an unreadable reply of the primary (a clear
  primary "unsafe" is final, never re-asked); once consulted, the fallback's verdict alone decides. Nemotron is called with `reasoning:{effort:"none"}`, `max_tokens:512` and the
  neutral text "Image to check." (probe-verified; the old "Classify … safe or unsafe" prompt gave false positives). Unsafe → placeholder +
  `CONTENT_REFUSED`; no checker available → placeholder + `CONTENT_CHECK_UNAVAILABLE` (retryable, quota back).
  **Second opinion** (`secondOpinion` in image-check.js): when Nemotron says "safe", the SAME bytes get one more paid question to Gemini Flash-Lite — nudity / sexualized
  content / any sexualized depiction of a person who looks like a minor? — strict `image_safety` json_schema, parsed with the fallback's strict parser; "unsafe", a refusal and
  an unreadable reply hold the image back (`CONTENT_REFUSED`); no answer (circuit open, budget spent or 0, failure, timeout, no time left) → `CONTENT_CHECK_UNAVAILABLE`
  (fail-closed). Own budget `DAILY_IMAGE_SAFETY_BUDGET` (default $0.50, 0 = off = fail closed) and own circuit `check_imgsafety`. An image the Gemini FALLBACK
  already approved is not asked twice. One image = one extra call: the `imgok` marker below carries the result.
  generate-poster leaves an `imgok:<sha256>` marker (6 h) and upload-panel stores ONLY bytes that carry it (no marker — a direct API
  POST, an edited file, an expired marker, a Redis outage — → `{url:null,unverified:true}`, nothing written to `panels/`/`posters/`, no model call, no quota spent; admin key
  does not bypass). It does no checking of its own.
  **Reports** (`feat/content-report`): `ReportButton` on posters, panels and reels → `POST /api/report-content`
  ([lib/report.js](lib/report.js)). Reporters are counted by a keyed HMAC (never raw IP/id); the OWNER's report hides
  at once, anyone else needs 2 distinct. Hiding = object moved to the PRIVATE bucket `R2_QUARANTINE_BUCKET_NAME`
  ([lib/quarantine.js](lib/quarantine.js)) + `report:hidden:<key>` (proxy-image answers 410; upload-panel refuses the same
  bytes via `report:hidden:h:<sha256>`). **Script reports**: `ReportButton kind="script"` in the ScriptOutput toolbar → `{script:{genre,lang}}` only (fixed lists, NEVER text — scripts live only on the device): the owner gets a Telegram alert with reason / genre / language, `stats:report:script:<day>` counts them, the script is hidden on the reporter's device (`utils/reported-store.js scriptKey`, djb2 fingerprint) and its export menu disappears. Unset quarantine bucket = nothing deleted, alert says "still public". Restore /
  **Gallery reports:** the static showcase items (`constants/showcase.js`, files in `public/`) have the same flag (cards, genre view, poster lightbox, reel lightbox) with a
  `{ gallery: 'poster:<id>'|'reel:<id>' }` ref validated against the showcase lists ([lib/gallery-report.js](lib/gallery-report.js) — path from our list, never the client). Local hide only
  (`gallery:<ref>` in the reported-store) + a Telegram alert with the `public/` path on every distinct reporter; no Redis mark, no threshold, copy says "hidden for you". Remove the file by hand (git rm + deploy).
  permanent delete / find objects: [scripts/takedown-object.mjs](scripts/takedown-object.mjs). The `imgok:<sha256>` marker
  carries the provider tag, copied into the R2 object metadata. Circuit keys `check_nemotron` / `check_gemini` reuse circuit-breaker.js. Cloudflare's request body is `{ prompt, steps: 6 }`
  ONLY — confirmed empirically against the real API that `seed` and `negative_prompt` are both
  rejected as unknown properties (code 5006); every call 400'd before this was fixed.
- **Circuit breaker** ([lib/circuit-breaker.js](lib/circuit-breaker.js)): Redis `circuit:img:*`,
  status-aware open durations (429→45s, 503→20s, 402/403/410→until UTC midnight, default 15s),
  **config errors (no HTTP status) never trip the circuit**. Fail-open. Cascade entries are
  `{ fn, key }` pairs — `key` is a plain string literal that must exactly match one of
  circuit-breaker.js's own `PROVIDERS` entries (asserted at module load). Do NOT key anything
  off `fn.name`/`Function.prototype.name` — Next's production minifier renames every top-level
  function declaration (confirmed: `runHuggingFace` compiled to `function q`), so that silently
  broke the circuit breaker AND `DAILY_IMAGE_BUDGET` tracking for a long stretch before this was
  caught and fixed. `KLEIN_COST_USD` (same file, env-overridable via `KLEIN_COST_USD`) feeds the
  `DAILY_IMAGE_BUDGET` maxCalls math directly — it must track OpenRouter's real per-image price
  for `flux.2-klein-4b`, not a stale estimate (it drifted to 0.0035 against a real $0.014 for a
  long stretch, silently under-counting spend 4x). Verify the live figure at openrouter.ai/logs
  before trusting this constant.
- **Dead ends (don't relitigate):** Prodia (paywall) removed; Pollinations removed (content safety).
  HuggingFace's `hf-inference` route for FLUX.1-schnell returns a permanent HTTP 410 as of
  ~July 2026 (model pulled, confirmed via HF's own community forum — not a quota issue, won't
  self-heal) — gated behind `HF_PROVIDER_ENABLED` (default unset/disabled) rather than removed
  outright, so the escape hatch stays available without a deploy if the account ever needs it
  (e.g. a genuine 402/403 on some other model) — flip the flag only after swapping
  `runHuggingFace` to a model confirmed to actually work on the free `hf-inference` tier (SD3-
  medium is the only text-to-image model currently listed there per HF's own docs; untested for
  latency/availability as of this writing — the free tier has shifted mostly to CPU inference).

**Model inventory (production code, verified 2026-10-27)** — every model the app can call, through which key, in which order:

| Feature | Model id | Key | Role |
|---|---|---|---|
| Script | `google/gemini-2.5-flash` | `OPENROUTER_API_KEY` | Stage 0, `deny` |
| Script | `google/gemma-3-27b-it`, `google/gemma-3-12b-it`, `deepseek/deepseek-chat` | `OPENROUTER_API_KEY` | Stages 2 / 4, `deny` |
| Script (privacy mode OFF only) | direct Gemini flash models, Cohere `command-r-plus-08-2024`, `google/gemma-4-31b-it:free` | `GOOGLE_GEMINI_API_KEY`, `COHERE_API_KEY`, ~~`OPENROUTER_FREE_KEY`~~ (removed) | Stages 1 / 3 / 5 (Stage 5 never runs: no key) — not asked while `DAILY_SCRIPT_BUDGET` > 0 (the default) |
| Storyboard | `google/gemini-2.5-flash-lite` leader; `google/gemma-3-27b-it` hedge; then gemma-3-12b, deepseek | `OPENROUTER_API_KEY` | `deny` |
| Storyboard (privacy mode OFF only) | `:free` net on `OPENROUTER_FREE_KEY` (removed: never runs), direct `gemini-2.5-flash` / `-flash-lite` on `GOOGLE_GEMINI_API_KEY` | | last fallbacks |
| Faceless image | Cloudflare `flux-1-schnell` (P1) → `black-forest-labs/flux.2-klein-4b` via OpenRouter (**P3, active paid fallback**, capped by `DAILY_IMAGE_BUDGET`) | Cloudflare / `OPENROUTER_API_KEY` | HF is off unless `HF_PROVIDER_ENABLED` |
| Star Yourself image + Character Sheet | `x-ai/grok-imagine-image-quality`, `google/gemini-2.5-flash-image` | `OPENROUTER_API_KEY` | quality tier Grok→Gemini, free taste Gemini→Grok |
| Image check | `nvidia/nemotron-3.5-content-safety` (paid, DeepInfra) primary, `google/gemini-2.5-flash-lite` fallback / second opinion / text classifier / minor screen | `OPENROUTER_API_KEY` | every call carries `deny`; Nemotron is metered by `DAILY_NEMOTRON_BUDGET`. (Until 2026-10 the primary was the `:free` slug = NVIDIA's training free endpoint; it cannot be combined with `deny`.) |

Klein, Grok and Gemini-image also send `provider.data_collection:"deny"` since 2026-10 (see 4g).
`OPENROUTER_FREE_KEY` has been **REMOVED from all environments** (owner, 2026-10-27; it was dormant while privacy mode is on). The code treats it as optional and was verified with the key absent in both privacy modes: script Stage 5 and the free storyboard models are skipped (one startup warning, no empty-key request); `tools/quality-eval`'s `:free` model would get a 401 without it. **`anthropic/claude-haiku-5.5` and `openai/gpt-6-luna` are only the JUDGES of `tools/quality-eval`** (offline benchmark, same OpenRouter key); they show up in the OpenRouter activity dashboard but are not called by the app. Probe scripts in `scripts/` also call Nemotron / Gemini Flash-Lite with the production key.
Direct Google (`generativelanguage.googleapis.com`) calls exist at two places only (script Stage 1, storyboard last fallback); both are gated on privacy mode being OFF. `GOOGLE_GEMINI_API_KEY` is on the FREE tier and is NOT used in production (privacy mode), so the Privacy Policy no longer mentions it (the old `NEXT_PUBLIC_GEMINI_API_TIER` switch was removed).

**Script privacy routes (`fix/audit-age-script-history`)**: Stage 0 of the text cascade is paid **Gemini 2.5 Flash through OpenRouter** with `provider.data_collection:"deny"` (`runPaidScript` in lib/story-service.js; budget `DAILY_SCRIPT_BUDGET`
default $10, 0 = OFF = the old cascade; counter `usage:script:paid:global:<day>` at `SCRIPT_PAID_COST_USD` 0.008/call; own circuit `script_paid`; budget spent / circuit open / budget unverifiable = skipped, never an error). While the budget env is > 0 the journal
text goes ONLY to deny-capable OpenRouter models: after Stage 0 only Gemma 27b/12b and DeepSeek run (all probe-verified to accept `deny`, scripts/probe-script-routes.mjs, 2026-10-20); the free Google key (Stage 1), Cohere and the free models are NOT asked, also when the paid
budget is spent. Stats: `stats:script:stage:<day>` hash (lib/script-stats.js: stage served, `paid:<outcome>`, paid token totals; 60 days; admin dashboard card + `scriptStages` in /api/admin/stats). The creator credit is the protagonist name (`protagonistNameFrom`, utils/producer-name.js).
The comic storyboard follows the same switch: while the budget env is > 0 every OpenRouter storyboard call carries `deny` and the free OpenRouter net and the direct free-tier Google key are NOT asked (tests/integration/38-storyboard-privacy.test.js).

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
enforces tier + quota **before** any paid call. Faces stored in R2 (`characters/`), Redis holds only the URL.
**Selfie upload = user-supplied media (`fix/ugc-selfie-hardening`)** — the only place a user supplies an image (there is no replace-panel / own-image upload anywhere):
- **18+ confirmation (`feat/adult-confirmation-star-yourself`)**: asked ONCE per ACCOUNT, stored server-side as `user:adult:<userId>` = `{at, v}` ([lib/adult-confirmation.js](lib/adult-confirmation.js), written by `POST /api/adult-confirmation`, first timestamp kept).
  `upload-character` refuses an account without it (403 `ADULT_CONFIRMATION_REQUIRED`, before any quota / storage / paid call; Redis unreadable → 503, fail CLOSED); a client-sent `adult` flag is ignored. The admin KEY (no account) is not blocked. `GET /api/character` returns `adultConfirmed` so
  CharacterModal shows the 18+ step first (existing users who already have a character keep it in generation and are asked the next time they open the feature; "Remove my character" stays reachable from that step). The Star Yourself entry shows "18+" / "מגיל 18" before the user starts.
  Not confirming never blocks scripts / posters / comics / reels (the faceless path). Still a self-declaration — never "age verification"; the apparent-minor screen is unchanged. The key embeds the user id, so `scripts/delete-user-data.js` removes it with the account.
- Type by BYTES: JPEG/PNG/WebP only (`sniffImage`), content type + key extension from the bytes; SVG/GIF/anything else → `IMAGE_UNSUPPORTED` before any reservation or call.
- The SAME `checkImage` as generated images (Nemotron + Gemini second opinion) on the exact stored bytes, **fail-closed** (`SAFETY_REJECTED` / `CONTENT_CHECK_UNAVAILABLE`, reservations given back), then the
  best-effort minor screen. It shares the existing `DAILY_IMAGE_SAFETY_BUDGET` / `check_imgsafety` (one extra ≈ $0.00012 call per upload, rate-limited 4 / 5 min; no separate budget so far — watch `usage:check:imgsafety:global:<day>`).
- The raw selfie (public R2, the provider fetches it by URL) is **deleted after EVERY attempt** and is **never the reference**. If the sheet fails the request fails (503 `CHARACTER_SHEET_FAILED` / 422 refused /
  503 unavailable) — provider error refunds quota + budget slot; an unsafe/unavailable/unstorable sheet refunds the user's sheet quota and keeps the global slot. A delete that keeps failing
  → `report:hidden:<raw>` + Telegram alert; the daily sweep moves it to quarantine ([lib/character-store.js](lib/character-store.js)).
- **Client state** ([utils/character-store.js](utils/character-store.js), wrapped by hooks/useCharacter.js): ONE `hasCharacter` (= a URL is known; never "status ready", never the outcome of a running/failed request). A confirmed upload ALWAYS turns `starring` ON (persisted) and removing the character forgets the stored preference, so the Star button is on right after upload and after a reload; a restore keeps a deliberate OFF. A restore answer that started before an upload/remove is discarded. Tests: tests/character-store.test.js.
- **Retention (R2 lifecycle rules, set in the Cloudflare dashboard — NOT in code, so they can't be verified here)**: `characters/` 90 days, `posters/` 60, `panels/` 30 (counted from object creation, run asynchronously). The Redis pointer expires 90 days after upload (never refreshed). The privacy text promises `RETENTION.characterObjectDays` (100 = "within about", covers lag), `posterObjectDays` (60) and `panelObjectDays` (30); keep them in step with the dashboard. The raw selfie is deleted by code after every upload attempt.
- **Re-upload replaces**: after the new sheet is stored AND the new pointer written, `deletePreviousCharacter` ([lib/character-store.js](lib/character-store.js)) deletes the objects the previous pointer named — own scope only (exact HMAC folder / exact legacy id), never the new keys; a failed delete is logged (class/http) and never fails the upload.
- Owner controls: `DELETE /api/character` ("Remove my character" in CharacterModal) deletes the caller's own `characters/<owner>/` objects AND legacy `characters/<id>-(raw|sheet)-<stamp>.jpg` keys whose embedded id EXACTLY equals the caller's identifier (listing hint by prefix, exact decision; the pointer never widens the set), then the pointer — always. The answer is honest: `status` `removed` | `partial` (some files could not be deleted: `failed`, stuck ones marked hidden, a repeat call finishes) | `nothing-found` (no stored file matched; NOT a full success). `characters/<owner>/<uuid>-raw|sheet.<ext>` keys are reportable
  (kind `character`, same Telegram alert), quarantinable and sweepable — one scope definition in [lib/object-scope.js](lib/object-scope.js) (legacy `characters/u:<id>-…` keys: manual only,
  scripts/takedown-object.mjs / delete-user-data.js). Hidden references are never used (identity gate + `GET /api/character`). `/api/proxy-image` serves `panels/` + `posters/` ONLY.
- All stored images (R2 objects, the proxy) are cached **one day, not immutable** (`IMAGE_CACHE_CONTROL` / `IMAGE_CACHE_SECONDS`, config/limits.js) so a quarantined image leaves caches soon. Objects uploaded BEFORE
  this change keep their old `immutable` header (can't change without a copy).
- Creator credit (`producerName`) is free text printed on the poster: `utils/producer-name.js` runs the keyword blocklist client-side (blocked → "Guest" + a hint); no server route stores or renders it (the only server
  consumer, `feedback.js` → owner's Telegram, applies the same blocklist).
- READ-ONLY inventory of leftover raw selfies (counts/ages only, no keys): `node scripts/list-leftover-raw-selfies.mjs` (docs-private/legacy-raw-selfie-cleanup-plan.md for the cleanup decision).
- Legacy raw selfies (`characters/<id>-raw-<stamp>.jpg`) are cleaned up with `scripts/quarantine-legacy-raw-selfies.mjs`: dry run by default, `--apply` = typed confirmation, MOVE to the private quarantine bucket only
  (never delete), each one only if its sheet exists and no Redis pointer names it (re-checked right before the move). Counts-only output, `stage=… class=… http=…` failures.
  Legacy pointers (`character:<id>` = `{url: RAW, styledUrl: SHEET}`, written until 2026-10-09) are first rewritten with `scripts/migrate-legacy-character-pointers.mjs` (`url := styledUrl`; dry run by default,
  typed `MIGRATE <n>`, backup in Redis 30 days, Lua compare-and-set keeping the TTL, read-back + sheet HEAD, idempotent, `--rollback <runId>`); needs a READ-WRITE Upstash token.

### 4. Tiers & quota → skill `quota`
Single source of truth: `TIER_LIMITS` in [config/limits.js](config/limits.js) (re-exported by [lib/quota.js](lib/quota.js)). Always use
`limitFor(tier, feature)`, never read the table directly in routes.

| feature | anon | free | pro | admin | period |
|---|---|---|---|---|---|
| script | 2 | 5 | 20 | ∞ | daily |
| poster | 1 (lifetime) | 2 | 3 | ∞ | daily |
| comic | 0 | 3 | 2 | ∞ | free = **monthly**, pro = daily |
| unlockedPanels | 0 | 7 for the 1st comic ever, then 3 | 7 | ∞ | per comic |
| identity | 0 | 1 | 30 | ∞ | monthly (free = **lifetime, no expiry**) |
| character-sheet uploads | 0 | 3 | 30 | ∞ | **monthly** (each is a paid generation; key `usage:sheet:<id>:<YYYY-MM>`) |

All tunables live in [config/limits.js](config/limits.js) (env overrides for the newer numbers;
see that file). `lib/quota.js` only re-exports the table and `limitFor`.

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

### 4a. Text output safety + minors screen (`fix/text-safety`)
`lib/text-check.js`: every script/storyboard OUTPUT passes the blocklist (all genres) and then the paid Gemini Flash-Lite JSON classifier on **every genre**
(via OpenRouter, `runFallbackJson` in lib/image-check.js). Held back → ONE regeneration with `REGENERATION_SAFETY_LINE` (only if enough of the 60 s route
budget is left) → `CONTENT_REFUSED`; quota released in every refusal. Classifier unavailable (down / own circuit open / own budget spent / no time):
**romance + horror fail CLOSED** (`CONTENT_CHECK_UNAVAILABLE`, 503); **every other genre is returned on the blocklist result alone** and
`stats:textcheck:degraded:<day>` is incremented (a number, never text or keys). `lib/minor-screen.js`: best-effort apparent-minor screen at Star Yourself
upload (after the quota reservations, before anything is stored): a clear "minor" → `MINOR_REJECTED` (422); "adult" / "unsure" (incl. a model refusal) → allowed; a TECHNICAL failure (provider error, unreadable reply, open `check_minor` circuit, spent/unverifiable budget) FAILS CLOSED → 503 `PHOTO_CHECK_UNAVAILABLE` (retryable, nothing stored, reservations back). It is
NOT age verification — never describe it so (tests/text-safety.test.js scans the repo).
**Six independent paid budgets and circuits** (five checks incl. the Nemotron primary + the storyboard first engine; nothing is shared, so one running dry or failing can never switch off another):

| check | budget env (default) | counter key | circuit |
|---|---|---|---|
| image fallback | `DAILY_CHECK_BUDGET` ($0.50) | `usage:check:paid:global:<day>` | `check_gemini` |
| text classifier | `DAILY_TEXT_CHECK_BUDGET` ($0.30) | `usage:check:text:global:<day>` | `check_text` |
| minor screen | `DAILY_MINOR_CHECK_BUDGET` ($0.50) | `usage:check:minor:global:<day>` | `check_minor` |
| image second opinion | `DAILY_IMAGE_SAFETY_BUDGET` ($0.50) | `usage:check:imgsafety:global:<day>` | `check_imgsafety` |
| image primary checker (paid Nemotron, DeepInfra, `deny`) | `DAILY_NEMOTRON_BUDGET` ($1.00; upper-bound $0.0002/call = 5,000 checks/day, measured $0.0001468) | `usage:check:nemotron:global:<day>` | `check_nemotron` |
| storyboard first engine (Gemini Flash-Lite via OpenRouter) | `DAILY_STORYBOARD_BUDGET` ($1.00) | `usage:storyboard:paid:global:<day>` | `storyboard_gemini` |

### 4c. Report gaps + one-time scan (`fix/report-gaps-and-scan`)
Legacy object keys (no owner segment) count as owner-equivalent in `lib/report.js` (one report hides). `quarantineObject` retries the copy and the delete
3× inline; `takedownAfterUpload` closes the upload-vs-report race; the 31st alert in an hour sends ONE "volume high" count alert. **Daily cron**
`/api/cron/sweep-hidden` (vercel.json, 04:00 UTC, auth = `Authorization: Bearer $CRON_SECRET`, fail-closed 401) moves hidden objects that are still
public into the private bucket (`lib/report-sweep.js`; MOVE only, never deletes; digest to Telegram only when there is something to say);
`scripts/takedown-object.mjs sweep [--apply]` is the manual twin. `scripts/scan-existing-images.mjs` is the MANUAL one-time scan of old
objects (dry run by default; `--quarantine-from` is a separate typed-confirmation step; never automated). `--recheck-from <first.json> --out <second.json>` gives the flagged ones a second opinion (paid route by default, separate file, first file never modified). A failed `--quarantine-from` move prints only `stage=… class=… [http=…]` (class from an allowlist in [lib/safe-error.js](lib/safe-error.js), never a key, bucket, URL or body).

### 4d. Comic storyboard cascade + frame resilience (`fix/storyboard-resilience`)
**Server** ([pages/api/generate-storyboard.js](pages/api/generate-storyboard.js), [lib/storyboard-parse.js](lib/storyboard-parse.js), [lib/storyboard-engines.js](lib/storyboard-engines.js)): the LEADER is **Gemini 2.5 Flash-Lite THROUGH OpenRouter**
(`runPrimaryPaid`: same OpenRouter key, `provider.data_collection:"deny"`, strict `json_schema`, `max_tokens:2000`; slug overridable with `STORYBOARD_PRIMARY_MODEL`) — the direct Google key is on the FREE tier (no billing) so it is
only the LAST fallback. It is metered like the other paid Gemini calls: its OWN budget `DAILY_STORYBOARD_BUDGET` (default $1.00 ≈ 833 calls at 0.0012; key `usage:storyboard:paid:global:<day>`; 0 = off; `reserveCheckBudget('storyboard')`, slot
released when no completion was produced) and its OWN circuit `storyboard_gemini` (429 → 45 s …); budget spent / circuit open / budget unverifiable (Redis down, fail-closed) = the engine is SKIPPED, never a failure. The HEDGE OpenRouter
`gemma-3-27b-it` joins after 4 s, or AT ONCE when the leader fails or is skipped; then one after another gemma-3-12b, deepseek, the free net, and LAST direct Gemini flash, then flash-lite. OpenRouter calls ask for `json_schema` ({panels:[...]} wrapper —
a strict root must be an object) with `provider.require_parameters:true`; on 400/404/422 the SAME model is asked once more without the schema (data_collection kept). `max_tokens` was 750: it cut 7-panel / Hebrew answers off mid-array
(unparseable). `parseStoryboard` accepts bare / fenced / wrapper / prose-wrapped answers and SALVAGES a truncated array (complete panels with a `visual`, >= 4). One shared engine deadline (`ENGINE_DEADLINE_MS` 38 s; every attempt gets
min(12 s, time left), none starts with < 3 s left); a regeneration ends by 48 s; past `ROUTE_HARD_MS` (55 s) the route answers a clean JSON failure and RELEASES the comic quota (a function killed at 60 s never does). Each attempt logs engine,
model, finish reason, token counts, panels, how it parsed, ms, and for the paid engine `usedToday` / `maxToday` / `capUsd` (or `skipped: budget|circuit-open|budget-unverifiable`) — never prompts, outputs or keys. The image-safety pipeline is untouched.
**Client** ([hooks/useStoryboardGeneration.js](hooks/useStoryboardGeneration.js), [utils/frame-error.js](utils/frame-error.js), [constants/comic-copy.js](constants/comic-copy.js)): every storyboard / panel fetch has an AbortController timeout (62 s / 55 s).
A frame failure is classified: network, timeout, non-JSON, 5xx, placeholder, unchecked image = RETRYABLE; refusals, blocked prompts, image budget and quota answers = terminal ("Frame Lost"); `COMIC_SESSION_EXPIRED` = offer a new comic;
`RATE_LIMITED` keeps its amber path. A connection-level failure gets ONE automatic retry after ~1.5 s (deferred while the tab is hidden); a comic generated THIS session also retries its failed frames once when the tab becomes visible again
(never a restored comic — that would spend credits unasked). The retryable tile says "Frame didn't load" + "Retry this frame"; two or more show "Generate missing frames" (2 at a time). The comic's session (`comicSeed`, `sessionId`, `unlocked`) is
saved in the History entry (`comicMeta`) together with the text-only panels, so reopening an entry whose images never arrived makes its frames "missing, retryable" (the server session lasts 24 h); an old entry without it shows plain lost frames.
A retry of a frame whose request never arrived / failed is a normal first attempt (the server rolls failed attempts back); if the server DID render it and only the answer was lost, it counts as one of the comic's replacements.

### 4e. OpenRouter credit exhaustion (`fix/openrouter-credit-resilience`)
One OpenRouter balance pays for scripts, storyboards, Klein, Grok / Gemini-image AND every safety check (Nemotron `:free` included: OpenRouter documents errors "including for free models" at a negative balance). When it runs out every call answers **HTTP 402**. A **per-API-key limit** (a key created with a spend limit, e.g. the $5/month dev key) is a different answer for the same outage: **HTTP 403** with `error.metadata.scope: "key_limit"` (and `limit_source: "openrouter_key_limit"`) — the body also names the key's management URL, which must never reach users, alerts or logs.
- **One classifier at the edge** ([lib/credit-failure.js](lib/credit-failure.js)): `creditStatus(status, body)` returns 402 for a 403 whose body carries one of those two markers and returns every other status unchanged; the call sites that look at an OpenRouter error use it (image-check's three fetch helpers read ≤ 2 KB of body only for a 403, `runPaidScript` / Gemma / DeepSeek, the storyboard's `runOpenRouterModel`, Klein and the identity calls via `providerErrorMessage`, which throws a FIXED `<name> 402: (key limit) …` text). Everything downstream (circuit, counter, alert, `credit` flag, `SERVICE_UNAVAILABLE`) is the 402 path, with no separate key-limit flag. **Every other 403** (bad key, no access, unparseable or unrelated body) keeps the old two-strike rule (tests/integration/39-credit-failure.test.js K17).
- **Not covered**: script Stage 5 and the free storyboard models (`OPENROUTER_FREE_KEY`, removed from all environments) have no 402 / key-limit handling at all.
- **Circuit breaker** ([lib/circuit-breaker.js](lib/circuit-breaker.js)): a 402 on an `OPENROUTER_CIRCUITS` circuit pauses it a flat **5 min** — no strike counting, never until midnight (a top-up must bring the app back within minutes). Every other status, and 402 on non-OpenRouter providers (huggingface / cloudflare), keep the old rules (429 45 s, 503 20 s, 410/403/402-two-strike → midnight, default 15 s). `recordSuccess` of ANY OpenRouter circuit clears the pause and announces a recovery (Nemotron included since it became a paid check).
- **Alert** ([lib/credit-failure.js](lib/credit-failure.js)): `noteCreditFailure` (called by `recordFailure`, plus explicitly for the script cascade's later stages, the storyboard's later engines and the character-sheet generator) increments `stats:credit402:<UTC day>:<path>` (script, storyboard, poster-image, star-yourself-image, image-check, text-check, photo-check, character-sheet; 7 days) and sends ONE Telegram per 30 min for the whole account (`alert:credit-402`); `noteCreditRecovery` announces the end once (flag `credit:outage`) and re-arms the alert. Fixed text, no user data.
- **User answer**: `CODES.SERVICE_UNAVAILABLE` (not retryable, no price / provider words): script + storyboard 503, poster / panel 200 with the placeholder, upload-character 503. It replaces `SCRIPT_FAIL` / `STORYBOARD_FAIL` / `PROVIDERS_BUSY` / `CONTENT_CHECK_UNAVAILABLE` / `PHOTO_CHECK_UNAVAILABLE` / `CHARACTER_SHEET_FAILED` ONLY when the cause was a 402 (the `credit` flag on the check results; it never changes a verdict — checks stay fail-closed, no image is shown or marked `imgok` unchecked). Frame failures with this code are terminal (no auto-retry).
- Tests: tests/integration/39-credit-failure.test.js (402 and key-limit 403 on every path), tests/credit-failure.test.js (classifier table).
- **Preview shares PRODUCTION state.** The Preview and Production environments use the SAME Upstash Redis and the SAME Telegram bot/chat (one `UPSTASH_REDIS_REST_*` / `TELEGRAM_*` variable scoped to both). A Preview deployment that hits a 402 / key limit therefore writes the circuit pauses (`circuit:img:*`), `stats:credit402:*`, the `credit:outage` flag and the alert slot that Production reads: it can pause Production's paid script engine and image checks for 5 minutes and trigger a false "succeeding again" message. Do not test the credit path on Preview (the Upstash free tier allows only one database); the integration suite covers it.

### 4f. HTTP 429 on the paid safety checks (`fix/check-429-retry`)
The Gemini Flash-Lite checks (image fallback, second opinion, text classifier, minor screen) fail CLOSED, so one 429 used to withhold a perfectly safe image and open the circuit for 45 s (first seen 2026-10-27 22:27 on `check_imgsafety`: "Screening paused", the retry a minute later passed; the 429 is a rejection, so OpenRouter's activity log shows no generation for it).
- **One retry** ([lib/check-retry.js](lib/check-retry.js) `callWithRetry`, used by `runFallbackJson` and the image fallback in `checkImage`): only a 429, only once, only if >= 2.5 s of the call's OWN budget is left, **on a SIBLING model** (`IMAGE_CHECK_RETRY_MODEL`, unset = `google/gemini-2.5-flash`; set but EMPTY = the same model). Reason (probe 2026-10-28): a 429 here is a per-MODEL upstream limit ("google/gemini-2.5-flash-lite is temporarily rate-limited upstream" — the idle dev key got one too, while gemini-2.5-flash and gemini-3.1-flash-lite-preview answered every image); the sibling has the same provider (Google AI Studio) and the same published data policy (no training, 55-day retention), the same prompt / schema / strict parser (so `unsafe` from either model is final), ≈ $0.00011 per image check instead of $0.00004 and $0.00012 vs $0.00004 for the age screen (both inside their $0.00015 budget bounds); a FULL-SIZE script (≈ 2,100 tokens) costs $0.00065 on flash vs $0.00021 on flash-lite — above the text budget's $0.0004 per-call bound, but only a RETRIED call pays it, so on a 429 day the text cap (`DAILY_TEXT_CHECK_BUDGET`) is at most ~1.6x soft; the preview model costs 8x and may change. The retry request carries `reasoning:{effort:"none"}` (flash can think; probe: 0 reasoning tokens either way, identical verdicts). `IMAGE_CHECK_RETRY_MODEL` must be a `google/gemini-*` slug, anything else is ignored (warning) in favour of the default. Pause: `Retry-After` <= 1.5 s → exactly that; **no `Retry-After` → 300-700 ms jitter when the retry model differs, 1.5-2.0 s jitter only when it is the same model; `Retry-After` > 1.5 s or unreadable → NO retry** (never hit a server before it said it is ready). A failed retry is the first failure unchanged (unavailable, slot released, `CONTENT_CHECK_UNAVAILABLE`); `recordFailure` runs once, after the retry. 402 / key-limit 403 / 5xx / timeouts are never retried. Nemotron keeps its own older retry (same model).
- **Circuit**: a 429 on `check_imgsafety` / `check_gemini` pauses the circuit **3 s**, on `check_nemotron` / `check_text` / `check_minor` **10 s** (not 45 s); generation providers and every other status keep their durations. (A user's immediate retry used to be refused by the 10 s pause without any call being made — 2026-10-27 23:43.)
- **Visibility**: every 429 is logged as `⏳ HTTP 429 on <circuit>: provider=… code=… retry-after=… message="…" raw="…"` (sanitized: no URLs, e-mails, key ids, non-ASCII, no request or image) and counted in `stats:ratelimit429:<UTC day>:<circuit>` (a number, 7 days; counts every 429 RESPONSE, so a retried request can count twice; the sibling's own 429s are counted under `<circuit>_retry` — read both to see whether the two models are rate-limited at the same moment). Read it to decide whether the Google AI Studio **priority** endpoint (≈ 1.8× the standard price) is worth it for the second opinion.
- **Routing facts (OpenRouter's public endpoint list, 2026-10-27)**: our check requests send only `provider.data_collection:"deny"` (no `order` / `only` / `allow_fallbacks`), and `google/gemini-2.5-flash-lite` (also `gemini-2.5-flash`, `gemini-3.1-flash-lite-preview`) has ONLY Google AI Studio endpoints (standard, flex, priority) — Vertex exists as an OpenRouter provider but is not listed for these models, so there is nothing to fall back to without a bring-your-own Google Cloud key (an account setting; not done).
- Tests: tests/integration/40-check-429.test.js, tests/check-retry.test.js.

### 4g. Privacy routing: paid Nemotron + `deny` everywhere (`feat/nemotron-paid-deny`)
**Published data policies** (OpenRouter model pages, checked 2026-10-27; the public endpoint API does not expose them):

| Model | Endpoint | Trains | Retains prompts | Retention |
|---|---|---|---|---|
| `nvidia/nemotron-3.5-content-safety:free` (the OLD primary) | NVIDIA, the only endpoint | **yes** | **yes** | not stated |
| `nvidia/nemotron-3.5-content-safety` (paid, the NEW primary) | DeepInfra, the only endpoint | no | no | none |
| `google/gemini-2.5-flash-lite` (second opinion, text classifier, minor screen, image fallback) | Google AI Studio, the only endpoint | no | **yes** | **55 days** |
| `black-forest-labs/flux.2-klein-4b` | Black Forest Labs | no | yes | 30 days |
| `x-ai/grok-imagine-image-quality` | xAI | no | yes | 30 days |
| `google/gemini-2.5-flash-image` | Google Vertex | no | no | abuse-monitoring ("safety") retention only |

**`provider.data_collection:"deny"` filters TRAINING endpoints only — NOT retention** (Gemini AI Studio retains 55 days and still passes). The `:free` Nemotron slug answers `404 No endpoints found matching your data policy (Free model training)` as soon as `deny` is sent (probe 2026-10-27), so it can never be the privacy-compliant primary. Every selfie (raw bytes) and every generated image / Character Sheet goes through `checkImage`, i.e. through the Nemotron call.
- **Nemotron** ([lib/image-check.js](lib/image-check.js)): slug `nvidia/nemotron-3.5-content-safety`, `provider: DENY_PROVIDER`, same body and parser as before (probe: identical `User Safety: safe|unsafe` template; DeepInfra omits the `Safety Categories:` line on unsafe replies — the parser ignores it). Metered in the `checkImage` loop (NOT inside `callNemotron`, which the scan script also uses): reserve a slot of `DAILY_NEMOTRON_BUDGET` before each attempt, keep it on any verdict, give it back on a technical failure. Spent / 0 / Redis-unverifiable → no Nemotron call (status null: no circuit, no retry) and the Gemini fallback decides as for any primary failure; if ITS budget is spent or unverifiable too → unavailable (fail-closed). An unreadable reply still goes to the fallback, whose verdict alone decides. 80% warning + once-a-day "reached" alert like the other budgets.
- **Klein, Grok, Gemini-image** also send `deny` (`DENY_PROVIDER`). A deny 404 is a TECHNICAL failure like any other: the cascade falls through (Klein → next provider / placeholder; Grok → Gemini identity → faceless, no face credit; the sheet generator → `CHARACTER_SHEET_FAILED`), never a content refusal (`isContentRefusal` treats "No endpoints found…" as technical whatever else the text says) and never an unchecked image.
- **Visibility** ([lib/policy-routing.js](lib/policy-routing.js)): every data-policy 404 is counted in `stats:policy404:<UTC day>:<circuit>` (7 days) and announced by ONE fixed-text Telegram per hour — the fallback silently changes cost and which provider sees the data.
- **Account toggle "Allow free endpoints that train on request data"** (owner's setting): safe to switch OFF only after this is live and verified (no `:free` calls from the production key in OpenRouter activity for a full day, `usage:check:nemotron:global` counting, no `policy404` counters / alerts). Re-enable it to roll back.
- Parity run (dev key, 2026-10-27; synthetic images, text-only "unsafe" samples — no explicit imagery, nothing from R2 or quarantine): format parity verified, sensitivity parity inferred (same model weights, different host) with unreadable → Gemini fallback as the safety net. Tests: tests/integration/41-nemotron-paid-deny.test.js, tests/policy-routing.test.js.

### 4h. Star Yourself outcome counters + unreadable-photo messages (`feat/star-yourself-outcomes`)
- **Counters** ([lib/character-stats.js](lib/character-stats.js)): `stats:character:<UTC day>:<name>`, INCR, **60-day** expiry, numbers only (no id, no image data). **Server** (`pages/api/upload-character.js` wraps its handler): every POST adds ONE `started` and exactly ONE outcome derived from the FINAL response by `outcomeFor(status, code, success)` — `succeeded` · `unsafe` (SAFETY_REJECTED / CONTENT_REFUSED) · `minor_rejected` · `unavailable` (CONTENT_CHECK_ / PHOTO_CHECK_UNAVAILABLE, SERVICE_UNAVAILABLE) · `sheet_failed` · `unsupported_format` · `blocked` (any other coded refusal: consent, tier, 18+, quota, budget, rate limit) · `error` (SERVER_ERROR / uncoded 5xx) — so `started` = the sum of the outcomes. Not counted: a wrong method, and requests carrying the admin API KEY header (admin-tier user ACCOUNTS are counted). **Browser** failures never reach upload-character; `POST /api/character-event` ([pages/api/character-event.js](pages/api/character-event.js)) accepts ONLY `{event:'decode_failed'|'heic_detected'}` (anything else 400, nothing counted; 20 per 10 min per person, limiter key = one-way HMAC, 1 KB body, 204), advisory by nature (anyone can post the two words). `heic_detected` = a HEIC-looking file whose decode FAILED (Safari decodes HEIC, so the file is still tried); `decode_failed` = any other undecodable file; they are mutually exclusive. The admin dashboard shows the last 7 days (`characterOutcomes` in `/api/admin/stats`, card in pages/admin.js). Tests: tests/integration/42-character-outcomes.test.js, tests/character-file.test.js.
- **Messages** ([constants/character-file-copy.js](constants/character-file-copy.js), [utils/image-file.js](utils/image-file.js) `classifyPickedFile`): HEIC/HEIF by MIME type OR extension (last extension only); when the decode fails the user is told what to do (export as JPG/PNG, open in Safari, or choose another photo; the Android-app variant has no Safari clause); any other decode failure says to try a JPG or PNG. The file picker still accepts `image/*`.
- **Logs never carry an account id, e-mail or Stripe id** (`🎭 Character ready` has no identifier; the Stripe webhook lines keep fixed text + the event type); tests/character-file.test.js scans the character routes, identity, character-store, sheet-quota and the webhook for such interpolations.

### 4i. Legal copy = production with privacy mode ON (`docs/legal-copy-providers`)
- **Privacy §7** ([constants/ai-provider-copy.js](constants/ai-provider-copy.js)) describes who sees what, as bullets (`LegalPage` renders `whitespace-pre-line`): text via OpenRouter → Google AI Studio (fallback hosts "such as" DeepInfra, Nebius, Novita, Parasail, StreamLake); image descriptions → Cloudflare Workers AI, then Black Forest Labs; Star Yourself photo and the Character Sheet (re-sent with EVERY poster/panel) → xAI or Google (Vertex); EVERY generated image, the selfie and the sheet → Nemotron on DeepInfra + Gemini on Google AI Studio (retry model: another Gemini); the minor screen → Gemini. The text classifier checks what we GENERATE (script / comic text), never the user's own entry (only the local keyword list sees that). `deny` is explained as "providers that state they do not train", NOT "do not keep"; the retention numbers are the providers' PUBLISHED ones from `PROVIDER_RETENTION` ([config/limits.js](config/limits.js), checked 2026-10-27: Google AI Studio 55, xAI 30, Black Forest Labs 30 days; not enforced by us, so apart from `RETENTION`). Cohere, the direct Google free tier and "free routes" are NOT in the text (not used in production); the `NEXT_PUBLIC_GEMINI_API_TIER` switch is gone.
- **Privacy §2 / Terms §5 / Terms §7 / About** name the companies and carry the "they keep it for the period they state; our deletion does not delete their copies" caveat; the provider day counts live only in §7 (the §2/§5 test allows only the 90/100-day periods there). Dates are the day ("28 October 2026"): update `summary` in `constants/modalData.js` (privacy + terms, he + en) whenever the text changes.
- **Guard** ([lib/privacy-mode.js](lib/privacy-mode.js)): if privacy mode is OFF (no OpenRouter key, or `DAILY_SCRIPT_BUDGET` is 0) on the PRODUCTION deployment (`VERCEL_ENV=production`; a Preview build never alerts), the owner gets ONE Telegram alert per 6 h and a log line per instance — because the policy would be wrong (the direct Google key and Cohere wake up). Fix the setting or update the policy FIRST. Tests: tests/integration/43-privacy-mode.test.js, tests/privacy-ai-copy.test.js.

### 4b. Android app (Capacitor) — Google Play payments policy
Inside the native shell **nothing may show a price, a subscription, Stripe or an "upgrade" prompt**. `hooks/useNative.js`
(true after mount; SSR/first render false) hides Manage Subscription, the LaunchTicket Pro card, the Go-Pro chip, locked-panel
"Pro only" text and the Star-Yourself upgrade text; `openAuthModal('upgrade')` is a no-op; `modalDataFor(true)` (constants/modalData.js)
drops the billing/payments/upgrade sections and strips pricing sentences; `getMsg()` swaps three messages for neutral ones
(detected via the Capacitor global, no import). Pro entitlements still work (tier comes from the server). `tests/native-copy.test.js`
scans all of it. No server-side userAgent check yet (would need an app update: `android.appendUserAgent`).
**Minimum age is 18 for the WHOLE service** (`chore/minimum-age-18`). Reason, in neutral wording: the AI services we use require adult users, and generated stories may include mature themes (action, horror, romance).
It is a SELF-DECLARATION, never "age verification": Terms §7 + the Star Yourself Terms section say so, [components/AuthModal.jsx](components/AuthModal.jsx) shows "By continuing you confirm you are 18 or older and agree to the Terms and
Privacy Policy" (he + en, with links, covers Google and the e-mail link, records nothing), and the home footer carries "LifeScript is intended for adults aged 18 and over." for guests. "Star Yourself" keeps its own one-time per-account
18+ confirmation + upload checkboxes (above). Never write 13+ / "13 or older" / teens / "all ages" / "family" in user-facing text or the store listing (tests/native-copy.test.js scans for it); never market to minors; never call any of this age verification.
Other Play-compliance rules: `/api/og` takes a referral **code** only (names come from Redis and pass the blocklist); "Star Yourself"
is 18+ (`adult:true` required like `consent:true`; self-declaration, never "age verification"); deletion requests record the session
user id and are verified before anything is deleted (still processed manually).

**Expired stored images** (`utils/expired-image.js`, `constants/expired-copy.js`): posters / panels are deleted by the R2 lifecycle rules, so a reopened History entry can point at a deleted file. ONLY after an `<img>` error the same-origin `/api/proxy-image` is asked once; **only a 404 = expired** (offline / timeout / 5xx / 429 / 403 / 410 / 200 never say "expired"). Expired poster = neutral tile + message, no share/download; expired panel = neutral tile + message + "new comic" (`onNewComic`); the reel is disabled (`reelUnavailable` in ScriptOutput) and the raw reel decode error is replaced by the message; while the check is pending the tile is blank (no flash). History list thumbnails keep their own genre-icon fallback. The message has no numbers.

### 5. Bilingual + RTL → skill `bilingual`
Every user-facing string must exist in **both** `he` and `en`. Components branch on a
`lang` prop (`lang === 'he' ? … : …`); data files use paired keys (`label: {he, en}`,
`titleHe`/`titleEn`). Hebrew needs `dir="rtl"` + `font-heebo` and mirrored directional
classes. API errors return `CODES.*` symbols (localized client-side), not raw English.
Generated-content language is auto-detected (`detectLanguage` / `HEBREW_RANGE`) and the
script LLM is hard-locked to the input language.

### 6. Native (Capacitor) vs. web export/share
`capacitor.config.json`'s `server.url` points the Android app's WebView at the **live
production site** — there is no bundled build, so the native app is literally Android's
System WebView rendering the same JS everyone else gets. That WebView's Web Share API
support is unreliable: confirmed on-device (emulator, `Capacitor.isNativePlatform()`) that
`navigator.share`/`navigator.canShare` are both `undefined` there — not partially broken,
genuinely absent. The `<a download>` blob fallback in `usePosterGeneration.js` also silently
no-ops in a bare WebView (no native download handler for `blob:` URLs the way a real browser
has), which is why poster/comic/reel sharing went completely silent on Android while working
fine on iOS Safari.

Fix, in [utils/export-image.js](utils/export-image.js): `shareFiles`/`shareData` branch on
[`isCapacitorNative()`](utils/platform.js) — native fires a real Android share Intent via
`@capacitor/share` (`Share.share({ files })`, wanting `file://` URIs), writing each File to
the Capacitor `Cache` directory as base64 via `@capacitor/filesystem` first
(`shareFilesNative`/`fileToBase64`). The existing `sharePending` re-entrancy latch wraps both
branches identically. The web path (iOS Safari, desktop, PWA) is byte-for-byte unchanged.
One native-specific wrinkle: `@capacitor/share`'s Android plugin has no DOM error names — a
user-dismissed chooser rejects with the literal string `"Share canceled"`, which `shareHandled()`
now also recognizes (alongside the web's `AbortError`) so a cancel isn't mistaken for a real
failure and doesn't trigger the broken download fallback.

This relies on the `FileProvider` already declared in
[android/app/src/main/AndroidManifest.xml](android/app/src/main/AndroidManifest.xml)
(`${applicationId}.fileprovider`, authority required by `@capacitor/share`'s Android code) and
[android/app/src/main/res/xml/file_paths.xml](android/app/src/main/res/xml/file_paths.xml)'s
`<cache-path path=".">`, which covers `Directory.Cache` (`context.cacheDir`) — both were
already present from the original native-wrapper setup, so no manifest changes were needed.

**Pattern for any future native-only behavior:** branch on `isCapacitorNative()` from
`utils/platform.js` (single source of truth — don't re-derive `Capacitor.isNativePlatform()`
per file), keep the web/PWA path completely untouched, and if a Capacitor plugin's native
rejection needs the same "this is a handled cancel, not a failure" treatment as a web
`AbortError`, extend the shared check (`shareHandled()` here) rather than special-casing it
at each call site.

### 7. Guided tour in chapters + "next step" pills (UI only)
Chapters live in [constants/tour.js](constants/tour.js) (`CHAPTERS`: 1 Story, 2 Script, 3 Poster, 4 Comic; each 2-6 steps, he+en, steps point at `data-tour="…"` anchors, several = fallbacks).
Runner: [components/GuidedTour.jsx](components/GuidedTour.jsx) (lazy, `ssr:false`; one chapter at a time), state machine + milestone triggers in [hooks/useGuidedTour.js](hooks/useGuidedTour.js),
pure logic in [utils/tour-logic.js](utils/tour-logic.js), flags in [utils/tour-state.js](utils/tour-state.js) (`ls_tour_done_v1` = chapter 1 resolved, `ls_tour_ch_v1` = `{done:[ids], off}`).
Chapter 1 auto-starts only on a device with no history/prior-use keys, no script on screen, nothing blocking (dialogs, lightboxes, generations, cookie banner); the "How it works" card in ScriptForm stays
hidden while it is pending/running. Chapters 2-4 start from ScriptOutput milestones (`onMilestone`: typewriter start, poster finished, comic finished — only for screens generated in this session) and only for
a user who FINISHED chapter 1; any Skip/Esc/Android Back sets `off` for good. A step waits for its anchor (`wait`), is dropped silently if it never appears or vanishes while shown (the typewriter's Skip);
`interactive` steps keep the spotlighted control clickable. The Navbar "Guide" button opens [components/GuideMenu.jsx](components/GuideMenu.jsx) (chapter list; unavailable chapters say what to do first).
No body scroll lock (index.js owns that), no network, no analytics, ReportButton untouched (anchors are wrappers at the call sites). Copy must avoid pricing/plan/upgrade/offer words (native-app policy; tests/tour.test.js).
`NextStepButton` pills show only while their scroll target is off-screen.
Spotlight sync (iOS-proven rules, see utils/tour-logic.js `createStability` / `layoutFor` / `needsScroll`): tour scrolls are INSTANT (never smooth), the spotlight + bubble show only after the anchor's rect held still for a few frames, then a
requestAnimationFrame loop tracks it every frame (body is the page scroller, scroll events are unreliable on iOS); positions use the visual-viewport offset; focus moves to Next once the bubble is visible. Guide menu availability is by STAGE reached
(`chapter.stage`: script / poster / comic, tracked from ScriptOutput milestones incl. `*-shown` for History reopen), not by whether an anchor is on screen; every row is tappable and a not-yet row shows `chapter.note`.

### 8. iOS scroll rule (document scroller, one inner scroller)
History: iPhone Safari shook while scrolling over the script window (`fix/ios-script-scroll`, `feat/script-box-variants`, `feat/script-box-default`). Final, verified on a real iPhone (the preview's "variant B"): **the DOCUMENT is the page scroller and the script window
is the ONLY inner scroll container.** Rules ([utils/scroll-mode.js](utils/scroll-mode.js), [pages/_document.js](pages/_document.js), [components/ScrollDebug.jsx](components/ScrollDebug.jsx)):
- **Never nest more than one inner vertical scroller** on a screen (viewport > body > box was a THIRD level and rubber-banded; iOS gives a swipe that starts inside an inner scroller to that scroller at its edge, not to the page). Never use `overscroll-behavior: contain` to "fix" a nested
  scroller (it traps the gesture inside on iOS 16+).
- **The page scroller is the document, not the `body`.** The splash CSS in `_document.js` (`html, body {height:100%; overflow:hidden}`, first paint only) is undone by the loader script after load: html `overflow:visible; height:auto`, body `height:auto; overflow:hidden auto` — the body's overflow then
  propagates to the viewport, so every `body.style.overflow = 'hidden'` modal lock (index.js, HistoryPanel, MovieReelModal, CharacterModal, the ScriptOutput share hub) keeps working and restores `'hidden auto'`. `window.scrollY` now moves (before: it stayed 0 and the body scrolled). Use `scrollIntoView` /
  element APIs for programmatic positions (they work with any scroller); the tour and the next-step pill do.
- **The script window** (touch AND desktop): fixed height — `min(60svh, 520px)` on touch (svh = the small viewport: it does not change while Safari's toolbar collapses, unlike dvh; never vh), 500/650 px on desktop; auto-follow of the typewriter only while the user is not touching (ref writes only: no state, no rAF on scroll;
  pause on touchstart/pointerdown/wheel, position-based resume within 40 px of the bottom); the page is never scrolled programmatically with the touch window (index.js skips its own scroll to the script; nothing calls `window.scrollTo`).
- **"Go to script" button** ([components/GoToScriptButton.jsx](components/GoToScriptButton.jsx), rules in [utils/go-to-script.js](utils/go-to-script.js)): the page is never scrolled automatically on touch, so a fixed pill (portalled to body, 44 px, no layout) appears when the typewriter starts and scrolls the window below the navbar on TAP; it hides once the window was >= 60% visible, during poster/comic generation and while a body scroll lock (any modal) is on. Scrolling goes through [utils/scroll-to-anchor.js](utils/scroll-to-anchor.js) (navbar + safe area offset, reduced motion) — shared with NextStepButton and with the desktop auto-scroll in index.js, which waits for the layout to settle (aimed at the collapsing loading panels it used to end ~230 px too far).
- **"Create script" flow** ([utils/script-flow.js](utils/script-flow.js), pure + unit-tested; pages/index.js binds it): the button is locked (disabled + aria-disabled, same size) from the tap until the typewriter has FINISHED (skip = finished; error / quota / abort / History open / ScriptOutput unmount unlock; a script shown without typing never locks). The lock is a plain field read synchronously by `request()`, so a double tap sends one request. The previous ScriptOutput's stale "typing ended" is ignored (`awaiting-output` phase, 8 s watchdog). The page's `isTyping` is NOT used for this (the form's textarea resets it on every keystroke). With a script on screen a tap opens [components/ConfirmReplaceDialog.jsx](components/ConfirmReplaceDialog.jsx) first (copy: constants/replace-script-copy.js; Escape / backdrop / Android Back = cancel, nothing sent). What a new script really clears (handleGenerateScript): script, poster, comic, reel leave the screen; History keeps the old entry with its saved script/edits, a poster that reached storage, generated comic frames; a reel is never saved; the journal text stays in the form.
- **Nothing that changes layout may be toggled by scroll position** (IntersectionObserver, scroll handlers) without reserving its space: iOS Safari has no scroll anchoring. `NextStepButton` keeps a fixed 44 px box; the status badge sits in a reserved footer row below the window.
- **Escape hatch: `?variant=off`** (stored in localStorage `ls_variant_flags` as `{off:1}`, sticky across loads; `?variant=on` undoes it) restores the LEGACY model for debugging: the old body page scroller (html AND body `overflow:auto` with the splash's `height:100%`) and, on touch, the script flowing in the page. **`?debug=1`** — DEVELOPER-ONLY and NOT available in Production: the overlay is bundled and honoured only when the owner builds with `NEXT_PUBLIC_SCROLL_DEBUG=true` (a Preview deployment); in Production the variable is unset, so `?debug` and a stored `{debug:1}` are ignored (and cleaned) and no overlay chunk exists (a visitor must never be able to switch it on)
  (stored as `{debug:1}`, `?debug=0` clears) shows the overlay: which element scrolls, scroll events/s, the script box's scrollTop/scrollHeight/clientHeight, window.scrollY vs body.scrollTop, visualViewport, page-height changes/s, `location.search`, the stored flags, `pointer:coarse` / `hover:none`, and whether the box is mounted and why not.
  Flags are read through `readEffectiveFlags()` (utils/variant-flags.js), never raw `location.search`; `_document.js` mirrors the rule for the scroll model (a test runs its snippet against `resolveFlags`). iOS home-screen web apps have their OWN localStorage. Older stored preview sets are ignored.
- **Tailwind only scans `pages/`, `components/`, `app/` and `utils/`.** A class that exists only in another folder (hooks/, constants/, lib/) is silently missing from the CSS (this once hid `md:h-[650px]`); put class lists in components or utils.
- **Script text must never be clipped** (measured with [scripts/measure-script-box.mjs](scripts/measure-script-box.mjs); geometry in [utils/glyph-fit.js](utils/glyph-fit.js)): the text div carries its OWN `dir` (the script's language, not the UI's), `text-start`, `overflow-wrap:anywhere`, inline `line-height:1.8`,
  `scrollbar-gutter:stable` on the window, a frame radius no larger than the padding (`rounded-[2rem]` with p-10). Whitespace hanging past the edge under `white-space:pre-wrap` is not a glyph: measure per non-space character.
- **Global blast radius of the page scroller** (all verified in Playwright, WebKit + Chromium, iPhone profile — see the PR): every route shares `_document.js` (/, /privacy, /terms, /data-deletion, /admin, auth pages); modal / lightbox / History / reel / character / share scroll locks; the guided tour's spotlight tracking and instant scrolls; the splash-to-content handoff; the sticky navbar and legal headers.
  Not verifiable headless: Android hardware Back, a real iOS keyboard, safe areas / status bar, pull-to-refresh and rubber-banding.

## Conventions & gotchas
- Provider errors are thrown as `"<Name> <httpStatus>: <body slice>"` so
  `extractStatusCode` can parse them for the circuit breaker. Preserve this shape.
- Quota/identity checks **fail-open** on Redis outages (never block paying users);
  increments are best-effort and happen **after** success.
- Never trust client-supplied tier/userId — resolve via `getSessionAndTier`.
- Stored images are cached ONE DAY (`IMAGE_CACHE_CONTROL`, not immutable — a quarantined image must leave caches soon); Redis stores only pointers.
- **Pro waitlist** ([pages/api/waitlist.js](pages/api/waitlist.js), [lib/waitlist.js](lib/waitlist.js), [constants/waitlist-copy.js](constants/waitlist-copy.js)): `waitlist:<normalized email>` = JSON `{v:1,email,createdAt ISO,locale,source,userId,consentVersion}`
  (legacy value = a bare unix-ms number; readers accept both). Written with `SET NX` (first record wins; a duplicate answers exactly like a new signup — no "already on the list"), honeypot field `HONEYPOT_FIELD`
  (an unusual name on purpose: never "website"/"url"/… which browsers autofill), per-IP rate limit (fail-open), Redis failure = retryable 503 (never a fake success). The full address is never logged; Telegram shows the masked form.
  Admin list + CSV: `GET /api/admin/waitlist` ([pages/api/admin/waitlist.js](pages/api/admin/waitlist.js), gate [lib/admin-auth.js](lib/admin-auth.js): 401 no session, 403 non-admin, admin key only as the `x-admin-key` HEADER; every answer
  `no-store`; the JSON list has no userId, the CSV ([lib/csv.js](lib/csv.js): BOM, CRLF, formula-injection prefix) has the whole filtered list incl. userId; "Waitlist" card in pages/admin.js, not in the 30 s auto-refresh). Never log a row.
  Bump `WAITLIST_CONSENT_VERSION` when the purpose sentence changes. Migration of old values: `scripts/migrate-waitlist-records.mjs` (dry run by default, JSON backup 0600 first, `--rollback FILE`).
- **Google Analytics** ([utils/ga.js](utils/ga.js)): gtag.js loads ONLY on the website and ONLY after "Accept analytics" (CookieConsent, or on mount for a returning visitor who accepted); never inside the Capacitor app,
  where the cookie banner is not shown either. The `window.gtag` stub in pages/_document.js keeps the Consent Mode defaults and DROPS every command except `consent` until `window.__lsGa` is set, so
  pre-consent events are never queued/replayed. Vercel Analytics (`<Analytics />`, cookieless, aggregate approximate location / device / OS / browser) runs on web + app. Privacy §6 says exactly this; tests/ga-consent.test.js.
- `.env.example` documents every required env var.
- If magic links fail with 535 BadCredentials, create a new Gmail App Password and update
  `EMAIL_SERVER_PASSWORD` in Vercel (Production and Preview), then redeploy. Changing the
  Google account password revokes App Passwords. Failed sends alert Telegram
  ([lib/auth-alerts.js](lib/auth-alerts.js), max one per error code per 30 min).
- **Reel crash diagnostics: removed** (`chore/remove-reel-diagnostics`). The temporary `/api/reel-diagnostic` route, `utils/reel-diagnostics.js` and every breadcrumb are gone; `pages/_app.js`
  clears the leftover `lifescript_reel_trail_temp` key once. What it found STAYS: the low-end reel tier in `components/MovieReelModal.jsx` (`resolveReelTier`, `LOW_TIER`: 576x1024 capture,
  24 fps, VP8 first, one panel bitmap at a time) is the production fix for old/low-memory Android devices, not a diagnostic.

## Project stage & growth
LIFESCRIPT is **deployed and live**; the current bottleneck is **distribution +
traction**, not features. Marketing, user acquisition, and investor outreach are handled
by the `growth` skill (`.claude/skills/growth/`). Recommended sequence: viral share loop →
concentrated launch (Product Hunt + communities) → fundraise once there's traction evidence.

## The `.claude/skills/` skills (auto-load by context)
`providers` · `flux-prompt` · `identity` · `quota` · `bilingual` · `growth`. They activate
automatically when you touch the matching area; read the relevant one before changing that
subsystem.

## Security review
For any change touching auth, R2/Redis keys, rate limits, secrets, webhooks, admin routes,
content-safety logic, or data deletion: delegate to the `security-auditor` subagent
(`.claude/agents/security-auditor.md`) for a focused review before merging.
