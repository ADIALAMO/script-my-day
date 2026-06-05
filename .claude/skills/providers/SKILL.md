---
name: providers
description: >-
  Expert context for LIFESCRIPT's multi-provider AI cascade and circuit breaker.
  Use when editing or debugging script generation (lib/story-service.js,
  lib/agent.js), image generation (pages/api/generate-poster.js), the circuit
  breaker (lib/circuit-breaker.js), provider health (pages/api/provider-health.js),
  or any generate-* route; when adding/removing/swapping an AI provider; or when
  diagnosing "provider offline", 429/402/503 failures, timeouts, or cascade
  exhaustion. Triggers on provider names: Gemini, Gemma, DeepSeek, Cohere,
  OpenRouter, HuggingFace, Cloudflare, Pollinations, Flux, Grok.
---

# LIFESCRIPT — AI Provider Cascade & Circuit Breaker

This app's reliability and cost story IS the multi-provider fallback. Treat it as
the most fragile, highest-leverage subsystem. Change it carefully and never
regress the ordering rationale below.

## Two independent cascades

### 1. Script (text) cascade — [lib/story-service.js](lib/story-service.js)
`generateScript(userText, genre)` builds messages via
[buildScriptPrompt](lib/agent.js) then tries stages in order, returning the first
success `{ success, output, model }`:

| Stage | Provider | Models (in order) | Env key | Notes |
|---|---|---|---|---|
| 1 | Google Gemini | gemini-2.5-flash, -flash-lite, -flash-latest, gemini-3-flash-preview, -3.1-flash-lite-preview, -3.1-pro-preview | `GOOGLE_GEMINI_API_KEY` | **Parallel race** via `Promise.any`; 12s/model; winner aborts the rest; includes a Hebrew/English language-match guard |
| 2 | OpenRouter Gemma 3 | gemma-3-27b/12b/4b-it | `OPENROUTER_API_KEY` | system→user remap with `[INSTRUCTION]:` prefix; single attempt/model; 10s |
| 3 | Cohere | command-r-plus-08-2024 | `COHERE_API_KEY` | uses `preamble` + `chat_history`; 8s |
| 4 | DeepSeek | deepseek/deepseek-chat | `OPENROUTER_API_KEY` | 8s |
| 5 | OpenRouter **free** (last resort) | gemma-3-4b-it:free, llama-3.1-8b:free, deepseek-r1:free | `OPENROUTER_FREE_KEY` | 12s |

Total time budget ≈ 60s — respect it when changing per-stage timeouts.

### 2. Image cascade — [pages/api/generate-poster.js](pages/api/generate-poster.js)
Faceless providers, tried in order until one returns an image. **POSTER and COMIC
use the same order** (`POSTER_CASCADE` / `COMIC_CASCADE`):

| P | Runner fn | Service / model | Env | Why this slot |
|---|---|---|---|---|
| 1 | `runCloudflareAI` | CF Workers AI `@cf/black-forest-labs/flux-1-schnell`, `steps:6` | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` | ~170 free img/day (10K neurons), no CC |
| 2 | `runOpenRouterKlein` | `black-forest-labs/flux.2-klein-4b` | `OPENROUTER_API_KEY` | paid, solid fallback |
| 3 | `runHuggingFace` | `FLUX.1-schnell`, steps 4, guidance 3.5, `x-wait-for-model`, `x-use-cache:false` | `HF_TOKEN` | free, cold-start aware |
| 4 | `runPollinationsFlux` | Pollinations `model=flux` | none (anonymous) | **throttled 1 req/15s** — final safety net only |

If all fail, the handler returns a **placeholder SVG** with HTTP 200 (never a JSON
error) so the frontend never shows a broken image. Don't "fix" this into a 500.

Identity providers (`runGrokIdentity`, `runGeminiIdentity`) are **prepended** when
the identity gate passes — see the `identity` skill. They run first; on failure
the loop degrades into the faceless cascade above.

## Circuit breaker — [lib/circuit-breaker.js](lib/circuit-breaker.js)
- State in Redis under `circuit:img:<provider>` (separate from `usage:` quota ns).
- `getOpenProviders(redis)` → Set of OPEN providers; `generate-poster` filters them
  out of the cascade. **Fail-open**: on Redis error it returns empty Set and runs
  the full cascade. If filtering empties the cascade, it falls back to the full one.
- `recordFailure` is keyed by **HTTP status** → open duration:
  - `429` → 45s · `503` → 20s · default 15s · **`402`/`403` → null = open until next
    UTC midnight** (daily credit exhaustion).
  - **Status `null` (no 4xx/5xx in the error) is a NO-OP** — config errors like
    "HF_TOKEN not configured" must NOT trip the circuit. Keep provider errors in the
    `"<Provider> <status>: <msg>"` shape so `extractStatusCode` can parse them.
- `PROVIDER_KEY` maps `fn.name` → circuit key segment. **If you rename a runner
  function or add one, you MUST update `PROVIDER_KEY` and the `PROVIDERS` array**, or
  its circuit state silently never reads/writes.

## Hard-won lessons (don't relitigate)
- **Prodia = dead end** (paywall). Do not re-add it.
- **Pollinations is throttled** to ~1 req/15s anonymous — keep it last, never in a
  hot/burst path.
- FLUX prompting has its own rules — see the `flux-prompt` skill before touching any
  image prompt string. Do **not** add negative prompts / anatomy guards here.

## Checklist: adding or swapping a provider
1. Write the runner: throw errors as `"<Name> <httpStatus>: <body slice>"`; return
   `{ imageUrl, provider }` (image) or `{ success, output, model }` (text).
2. Insert it at the cost/reliability-appropriate slot (free→paid→free-net).
3. Image provider: add `fn.name` to `PROVIDER_KEY` **and** `PROVIDERS` in
   circuit-breaker.js.
4. Add the env var to `.env.example` with a one-line comment.
5. Update `pages/api/provider-health.js` expectations if it enumerates providers.
6. Verify timeouts keep the stage within the overall budget (~60s text / per-call
   image timeouts).

## When debugging "providers busy / offline"
Check, in order: (a) env keys present? (b) circuit state via `/api/provider-health`
(a provider may be OPEN until midnight after a 402) (c) the specific HTTP status in
logs (`⚠️ <runner> failed: ...`) (d) whether a config-error (status null) is silently
dropping a provider without tripping the circuit.
