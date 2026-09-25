# LIFESCRIPT — Health Audit: Bugs Found & Fixed
**Date:** 2026-09-25 · **Reviewer:** external technical consultant (static code review)

This is a short write-up of two concrete, non-obvious bugs found during a broader static
code review and fixed the same day. Both were verified against the actual code (file/line
references below) and confirmed fixed with a clean `next build`.

---

## 1. Truncated AI response → silently broken poster prompt

**File:** [components/ScriptOutput.jsx](../../components/ScriptOutput.jsx) — the effect that
splits a generated script into the displayed text and the `[image: ...]` poster prompt.

The original code:

```js
const marker    = '[image:';
const markerIdx = processed.toLowerCase().indexOf(marker);
if (markerIdx !== -1) {
  setCleanScript(processed.substring(0, markerIdx).trim());
  const endIdx = processed.indexOf(']', markerIdx);
  setVisualPrompt(processed.substring(markerIdx + marker.length, endIdx).trim());
}
```

If the AI response is cut off before the closing `]` on the `[image: ...]` line (observed
under provider load — `lib/story-service.js` has its own truncation guard for exactly this),
`endIdx` ends up `-1`. `String.prototype.substring` treats a negative index as `0` and swaps
`start`/`end` when `start > end`, so `substring(markerIdx+7, -1)` silently resolves to
`substring(0, markerIdx+7)` — meaning the **entire script**, not just the intended one-line
image description, became `visualPrompt` and was sent straight to the poster-generation API.
The user would see a normal script, tap "generate poster," and get back visual garbage with
no error or explanation.

**Fix:** the branch now only extracts the prompt when `endIdx !== -1`; a truncated tag falls
through to the same default prompt already used when the marker is missing entirely.

---

## 2. Character Sheet generation cost wasn't covered by the global spend kill-switch

**Files:** [pages/api/upload-character.js](../../pages/api/upload-character.js),
[lib/identity.js](../../lib/identity.js)

`lib/identity.js` implements `identityBudgetReached()` as a global daily spend kill-switch —
once the configured daily USD ceiling on "Star Yourself" spend is hit, every identity request
is meant to degrade to the free faceless cascade so a viral/abusive burst can never produce a
billing surprise. In practice that check was only wired into `resolveIdentityGate()` (used by
`generate-poster.js`). The actual paid Grok/Gemini call in `upload-character.js` — generating
the canonical "Character Sheet" portrait from a user's selfie — never checked it, so that cost
path could keep spending even on a day when the global budget was already exhausted.

**Fix:** `upload-character.js` now checks `identityBudgetReached()` before generating the
Character Sheet. When the budget is exhausted, it falls back to using the raw selfie as the
reference image instead — the same degraded-but-functional fallback already used elsewhere in
this flow for a generation failure — rather than hard-failing the upload.
