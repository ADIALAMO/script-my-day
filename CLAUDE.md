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
  image, Character Sheet) is classified BEFORE it is shown or stored. Primary = Nemotron free (strict, pinned
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
  bytes via `report:hidden:h:<sha256>`). Unset quarantine bucket = nothing deleted, alert says "still public". Restore /
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
- Type by BYTES: JPEG/PNG/WebP only (`sniffImage`), content type + key extension from the bytes; SVG/GIF/anything else → `IMAGE_UNSUPPORTED` before any reservation or call.
- The SAME `checkImage` as generated images (Nemotron + Gemini second opinion) on the exact stored bytes, **fail-closed** (`SAFETY_REJECTED` / `CONTENT_CHECK_UNAVAILABLE`, reservations given back), then the
  best-effort minor screen. It shares the existing `DAILY_IMAGE_SAFETY_BUDGET` / `check_imgsafety` (one extra ≈ $0.00012 call per upload, rate-limited 4 / 5 min; no separate budget so far — watch `usage:check:imgsafety:global:<day>`).
- The raw selfie (public R2, the provider fetches it by URL) is **deleted after EVERY attempt** and is **never the reference**. If the sheet fails the request fails (503 `CHARACTER_SHEET_FAILED` / 422 refused /
  503 unavailable) — provider error refunds quota + budget slot; an unsafe/unavailable/unstorable sheet refunds the user's sheet quota and keeps the global slot. A delete that keeps failing
  → `report:hidden:<raw>` + Telegram alert; the daily sweep moves it to quarantine ([lib/character-store.js](lib/character-store.js)).
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
upload (after the quota reservations, before anything is stored): rejects ONLY on a clear "minor" (`MINOR_REJECTED`), every other outcome allows. It is
NOT age verification — never describe it so (tests/text-safety.test.js scans the repo).
**Five independent paid budgets and circuits** (four checks + the storyboard first engine; nothing is shared, so one running dry or failing can never switch off another):

| check | budget env (default) | counter key | circuit |
|---|---|---|---|
| image fallback | `DAILY_CHECK_BUDGET` ($0.50) | `usage:check:paid:global:<day>` | `check_gemini` |
| text classifier | `DAILY_TEXT_CHECK_BUDGET` ($0.30) | `usage:check:text:global:<day>` | `check_text` |
| minor screen | `DAILY_MINOR_CHECK_BUDGET` ($0.20) | `usage:check:minor:global:<day>` | `check_minor` |
| image second opinion | `DAILY_IMAGE_SAFETY_BUDGET` ($0.50) | `usage:check:imgsafety:global:<day>` | `check_imgsafety` |
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

### 4b. Android app (Capacitor) — Google Play payments policy
Inside the native shell **nothing may show a price, a subscription, Stripe or an "upgrade" prompt**. `hooks/useNative.js`
(true after mount; SSR/first render false) hides Manage Subscription, the LaunchTicket Pro card, the Go-Pro chip, locked-panel
"Pro only" text and the Star-Yourself upgrade text; `openAuthModal('upgrade')` is a no-op; `modalDataFor(true)` (constants/modalData.js)
drops the billing/payments/upgrade sections and strips pricing sentences; `getMsg()` swaps three messages for neutral ones
(detected via the Capacitor global, no import). Pro entitlements still work (tier comes from the server). `tests/native-copy.test.js`
scans all of it. No server-side userAgent check yet (would need an app update: `android.appendUserAgent`).
Other Play-compliance rules: `/api/og` takes a referral **code** only (names come from Redis and pass the blocklist); "Star Yourself"
is 18+ (`adult:true` required like `consent:true`; self-declaration, never "age verification"); deletion requests record the session
user id and are verified before anything is deleted (still processed manually).

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
- **Nothing that changes layout may be toggled by scroll position** (IntersectionObserver, scroll handlers) without reserving its space: iOS Safari has no scroll anchoring. `NextStepButton` keeps a fixed 44 px box; the status badge sits in a reserved footer row below the window.
- **Escape hatch: `?variant=off`** (stored in localStorage `ls_variant_flags` as `{off:1}`, sticky across loads; `?variant=on` undoes it) restores the LEGACY model for debugging: the old body page scroller (html AND body `overflow:auto` with the splash's `height:100%`) and, on touch, the script flowing in the page. **`?debug=1`**
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
- `.env.example` documents every required env var.
- If magic links fail with 535 BadCredentials, create a new Gmail App Password and update
  `EMAIL_SERVER_PASSWORD` in Vercel (Production and Preview), then redeploy. Changing the
  Google account password revokes App Passwords. Failed sends alert Telegram
  ([lib/auth-alerts.js](lib/auth-alerts.js), max one per error code per 30 min).
- **Temporary diagnostics:** `/api/reel-diagnostic` is rate-limited (30/h per IP, 100/h global; see
  `lib/rate-limit.js`, `lib/alert-throttle.js`) but is still unauthenticated and must be removed
  after the Google Play production access request (~Oct 20-21). Find everything with
  `grep "TEMP DIAGNOSTIC (reel-crash)"`.

## Project stage & growth
LIFESCRIPT is **deployed and live**; the current bottleneck is **distribution +
traction**, not features. Marketing, user acquisition, and investor outreach are handled
by the `growth` skill (`.claude/skills/growth/`). Recommended sequence: viral share loop →
concentrated launch (Product Hunt + communities) → fundraise once there's traction evidence.

## The `.claude/skills/` skills (auto-load by context)
`providers` · `flux-prompt` · `identity` · `quota` · `bilingual` · `growth`. They activate
automatically when you touch the matching area; read the relevant one before changing that
subsystem.
