---
name: identity
description: >-
  Expert context for LIFESCRIPT's "Star Yourself" identity (character-consistency)
  pipeline. Use when working on character upload/Character Sheet
  (pages/api/upload-character.js, pages/api/character.js), the identity providers
  and quota gate (lib/identity.js), R2 storage (lib/blob-store.js), the identity
  cascade or face injection in pages/api/generate-poster.js, the CharacterModal/
  useCharacter hook, or anything touching faces, Grok/Gemini image-from-reference,
  selective framing, or identity quota. Triggers on: identity, character sheet,
  star yourself, "כיכב את עצמך", face, selfie, Grok, reference image.
---

# LIFESCRIPT — "Star Yourself" Identity Pipeline

The identity feature is the app's signature differentiator AND the only place that
spends **real per-image money**, so correctness here is both product- and
cost-critical. Core logic lives in [lib/identity.js](lib/identity.js).

## Cost reality (drives every design choice)
- Grok image (`x-ai/grok-imagine-image-quality`): **~$0.06** flat — signature inked
  look, the app's default quality.
- Gemini image (`google/gemini-2.5-flash-image`): **~$0.039** — softer, benchmarked
  at identity parity; the value/cheaper tier.
- Both go through OpenRouter and return the image at
  `choices[0].message.images[0].image_url.url` (Grok=JPEG, Gemini=PNG data URI).
- A credit must be spent **only on a real face success** — never on a degraded
  (faceless) fallback. This is enforced via `faceApplied: true`.

## Two-tier identity cascade ([generate-poster.js](pages/api/generate-poster.js))
Ordered by cost-control intent ("Option C"):
- **QUALITY** (Pro+/admin): `IDENTITY_CASCADE_QUALITY = [runGrokIdentity,
  runGeminiIdentity]` — Grok first (signature look) → Gemini fallback.
- **VALUE** (free lifetime taste, `gate.isLifetime`): `IDENTITY_CASCADE_VALUE =
  [runGeminiIdentity, runGrokIdentity]` — Gemini first to **cap the cost** of the
  one free poster → Grok only if Gemini fails.
- Identity providers are **prepended** to the faceless base cascade. If both
  identity tiers fail, generation degrades to the faceless cascade and **no credit
  is consumed**.

## The quota gate — `resolveIdentityGate(...)` returns one of:
- `{ mode: 'identity', usageKey, limit, isLifetime }` → run identity; consume on success.
- `{ mode: 'standard' }` → no/invalid face → normal generation (**not an error** —
  graceful degradation).
- `{ mode: 'reject', status, code }` → blocked (not paid, or quota hit).

Gate order (memorize — subtle):
1. **Admin** with a valid face → identity, unlimited, no key.
2. **No/invalid face** → `standard` (degrade, don't error).
3. **`limit === 0`** (anonymous) → `reject 403 NEEDS_PRO` — identity is paywalled.
4. **Free + comic flow** → `standard`. Free's one lifetime credit is **poster-track
   only**; it must NOT be burned inside a comic, so it degrades to faceless instead
   of erroring mid-comic.
5. **Quota check happens BEFORE the OpenRouter call** so we never spend $ on an
   over-limit user → `reject 429 QUOTA_IDENTITY` when used ≥ limit.

## Monthly vs lifetime keys (the critical distinction)
- Paid tiers: **monthly** key `usage:identity:<identifier>:<YYYY-MM>`, reset via
  `expireat(nextMonthStartUTC())`.
- Free tier: **lifetime** key `usage:identity:lifetime:<identifier>` with **NO
  expiry** — the one-time "taste" must never come back. `consumeIdentityCredit`
  takes `{ isLifetime }` and **skips the expireat** for lifetime keys. Never add a
  TTL to the lifetime key.
- `limitFor(tier, 'identity')`: anonymous 0 · free 1 (lifetime) · pro 30 (monthly) ·
  admin Infinity. (See the `quota` skill + [lib/quota.js](lib/quota.js).)

## Face validation & storage
- `validFaceUrl(u)`: must be `https://` or `data:image/`, and < 2,000,000 chars.
- Reference is passed to providers as `opts.characterImageUrl`.
- **Moderation is fail-closed**: `moderateImage` (nvidia nemotron content-safety,
  free) returns `false` on any error/non-OK — we never store or use an unmoderated
  face. Keep it fail-closed.
- Storage: **Cloudflare R2** via [lib/blob-store.js](lib/blob-store.js), prefix
  `characters/`, alongside `panels/`/`posters/`. Reuses the SAME R2 creds as panels.
  Redis holds only the URL pointer, never the bytes (`putImage` → public URL;
  `decodeDataUri` for base64 → bytes). Character assets are immutable → cached
  `max-age=31536000, immutable`.

## Common pitfalls
- Don't consume a credit unless `result.faceApplied === true`.
- Don't let a free user's lifetime credit leak into the comic flow.
- Don't add an expiry to the lifetime key, and don't reset it on tier change.
- Don't move the quota check to *after* the paid OpenRouter call.
- Keep the `"<model> <status>: <msg>"` error shape so the circuit breaker /
  `extractStatusCode` works (see `providers` skill) — Grok/Gemini identity runners
  participate in the same circuit (`grok_identity`, `gemini_identity`).
