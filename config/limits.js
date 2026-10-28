/**
 * ONE place for the tunable limits added/owned by the hardening work.
 *
 * Pure module (no imports, no I/O) so it is safe in the Node API routes, the edge runtime
 * (pages/api/og.js) and the browser bundle. Numbers can be overridden with environment
 * variables (same pattern as REFERRAL_REWARD_CAP / DAILY_*_BUDGET): a missing, non-numeric
 * or negative value silently falls back to the default below.
 *
 * NOTE: server-side env vars are NOT visible in the browser bundle. Anything the client needs
 * (e.g. the regeneration limit) is sent by the API in its response instead of being imported.
 */

/** Non-negative integer from env, or the default. */
export function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ─── Character sheet uploads ("Star Yourself") ───────────────────────────────────────
// Every upload runs a PAID image generation (Gemini ~$0.039 / Grok ~$0.06). Counted per user
// per UTC MONTH (key usage:sheet:<id>:<YYYY-MM>, resets on the 1st), and ALSO against the global
// daily identity budget (DAILY_IDENTITY_BUDGET), which is unchanged.
export const SHEET_LIMITS = {
  anonymous: 0,
  free:      envInt('SHEET_UPLOADS_FREE_PER_MONTH', 3),
  pro:       envInt('SHEET_UPLOADS_PRO_PER_MONTH', 30),
  admin:     Infinity,
};

// ─── Comics ───────────────────────────────────────────────────────────────────────────
export const COMIC = {
  // Free: N comics per UTC month. The user's FIRST comic ever unlocks every panel (the "wow");
  // later comics unlock fewer, the rest stay locked (server strips the prompt, see
  // generate-storyboard.js). Pro keeps its previous behavior: comics per DAY, all panels.
  freePerMonth:         envInt('FREE_COMICS_PER_MONTH', 3),
  freeFirstComicPanels: envInt('FREE_FIRST_COMIC_PANELS', 7),
  freeLaterComicPanels: envInt('FREE_LATER_COMIC_PANELS', 3),
  proPerDay:            envInt('PRO_COMICS_PER_DAY', 2),
  // Pro ALSO has a monthly cap (UTC month, on top of the daily one). Default 6. Measured in the max-usage Pro
  // simulation (tests/integration/12-cost.test.js, Klein $0.014 / Grok $0.06 UNVERIFIED): each extra comic adds
  // ≈ $0.127 (up to 9 panel images) → 6 comics bring the whole max-use Pro month to ≈ $4.44, i.e. ≤ half of $9.
  // (10 comics = $4.95, the old uncapped 60/month would be several times the price.)
  proPerMonth:          envInt('PRO_COMICS_PER_MONTH', 6),
  // Replacements ("Replace" button) allowed per comic, enforced SERVER-side. The browser gets
  // the value from the storyboard response and only mirrors it in the UI.
  regenLimit:           envInt('COMIC_REGEN_LIMIT', 2),
  // How long a comic stays "open" for panel generation/replacement after its storyboard.
  sessionTtlSec:        24 * 60 * 60,
};

// Backstop on panel images per user per UTC day, across all comics: comics/day × (panels + regens)
// with headroom. Stops repeated replays of old comic sessions from producing unlimited images.
export const PANELS_PER_DAY = {
  free:  envInt('FREE_PANELS_PER_DAY', 30),
  pro:   envInt('PRO_PANELS_PER_DAY', 30),
};

// Which window each tier's comic quota uses ('day' | 'month').
export const COMIC_PERIOD = { anonymous: 'day', free: 'month', pro: 'day', admin: 'day' };

// ─── Tier table (single source of truth; lib/quota.js re-exports it + limitFor) ──────
//
// maxPanels:      how many panels the LLM generates (always 7 — free users get the full plan).
// unlockedPanels: panels with AI images for the tier. For FREE this is the LATER-comics value;
//                 the first comic gets COMIC.freeFirstComicPanels (resolved per comic by
//                 lib/comic-quota.js). Locked panels never generate images.
// script (Pro):   daily cap ON TOP of the sliding-window rate limit (was unlimited).
// identity:       monthly (Pro); Free = LIFETIME (no expiry). comic: see COMIC_PERIOD.
// ANONYMOUS poster is a LIFETIME allowance (1) per IP, kept GUEST_RETENTION.ipDays after the last use — see lib/poster-quota.js.
export const TIER_LIMITS = {
  anonymous: { script: 2,        poster: 1,        comic: 0,                 maxPanels: 0, unlockedPanels: 0,                          identity: 0        },
  free:      { script: 5,        poster: 2,        comic: COMIC.freePerMonth, maxPanels: 7, unlockedPanels: COMIC.freeLaterComicPanels, identity: 1        },
  pro:       { script: envInt('PRO_SCRIPTS_PER_DAY', 20), poster: 3,        comic: COMIC.proPerDay,   maxPanels: 7, unlockedPanels: 7,                          identity: 30       },
  admin:     { script: Infinity, poster: Infinity, comic: Infinity,          maxPanels: 7, unlockedPanels: Infinity,                   identity: Infinity },
};

// ─── Upload gate for generated images stored in R2 (pages/api/upload-panel.js) ───────
// Per-identifier rolling 30-day caps that bound R2 growth. Above realistic usage: Free =
// 3 comics/month × (7 + 2×3 panels + replacements) ≈ 30; posters 2/day.
export const UPLOAD_LIMITS = {
  anonymous: { panels: 20,  posters: 5   },
  free:      { panels: 80,  posters: 45  },
  pro:       { panels: 250, posters: 120 },
};

// ─── Magic-link sign-in e-mails (NextAuth email provider) ────────────────────────────
// Sliding windows of 1 hour. Per ADDRESS (normalised, "+tag" stripped) and per client IP.
// Applied BEFORE NextAuth runs, so an over-limit request never reaches the SMTP server.
export const AUTH_EMAIL_LIMITS = {
  perEmailPerHour: envInt('AUTH_EMAIL_PER_ADDRESS_PER_HOUR', 5),
  perIpPerHour:    envInt('AUTH_EMAIL_PER_IP_PER_HOUR', 10),
};

// ─── Public image endpoints ───────────────────────────────────────────────────────────
// /api/proxy-image (R2 → same-origin for canvas/reel) and /api/og (invite card). Per client IP
// per minute; the responses are CDN-cacheable so only cache MISSES really reach the function.
// Browser / CDN lifetime of every stored image (R2 objects, the image proxy). NOT immutable: an image that is reported and quarantined must stop being
// served within a day, instead of living on in caches for a year. The hidden check (410, no-store) runs on every cache miss.
// Largest decoded selfie accepted by /api/upload-character (the client downscales to ~1024px, a real photo is well below this; the route body limit is 8 MB of base64).
export const SELFIE_MAX_BYTES = envInt('SELFIE_MAX_BYTES', 6 * 1024 * 1024);
export const IMAGE_CACHE_SECONDS = envInt('IMAGE_CACHE_SECONDS', 24 * 60 * 60);
export const IMAGE_CACHE_CONTROL = `public, max-age=${IMAGE_CACHE_SECONDS}`;
export const PROXY_IMAGE = {
  perIpPerMinute: envInt('PROXY_IMAGE_PER_IP_PER_MINUTE', 120),
  maxBytes:       envInt('PROXY_IMAGE_MAX_BYTES', 3 * 1024 * 1024), // = MAX_IMAGE_BYTES of upload-panel
};
export const OG_IMAGE = {
  perIpPerMinute: envInt('OG_PER_IP_PER_MINUTE', 30),
  maxAssetBytes:  envInt('OG_MAX_ASSET_BYTES', 1024 * 1024), // fonts / logo fetched for the card
};

// ─── Script generation: how Gemini is called (cost control) ───────────────────────────
// Stage 1 of lib/story-service.js used to START ALL models of a tier at the same time and keep the first valid
// answer (a RACE): every script paid for 2 Gemini calls (quality tier) — the loser is only cancelled client-side
// (AbortController) and a provider may still bill the tokens it had already generated.
//   mode 'hedge' (default): start the first model; start the next one only if the previous has not answered after
//                           `*HedgeMs`, or immediately when the previous one FAILED. The winner aborts the rest.
//   mode 'race'           : the old behaviour (all models start together).
// TIMING (the route's maxDuration is 60 s — pages/api/generate-script.js + vercel.json; a function killed at the
// limit never gives the reserved quota slot back, so the whole cascade must finish with margin):
//   • benchmarked quality-tier latency is ~21–26 s, so a hedge delay below ~27 s would fire on most scripts (≈ the old
//     2-calls-per-script cost) — and a delay of 25 s used to leave the rescue model only 15 s, too little to finish.
//   • default: hedge at 27 s (outliers only; 28 s before the Stage-1 reserve below), the rescue gets until `qualityBudgetMs` (42 s with the default reserve → ~15 s), and is not
//     started at all with less than `minStartBudgetMs` (15 s) left. The delay is clamped so that it ALWAYS fits:
//     hedge delay ≤ qualityBudgetMs − minStartBudgetMs.
//   • `totalBudgetMs` (50 s = 60 s − 10 s margin) bounds the entire cascade: no stage starts without time to finish,
//     and per-call timeouts are cut to what is left, so the route returns SCRIPT_FAIL (slot released) instead of dying.
//   • `stage1ReserveMs` (8 s) is kept back for Stages 2–5: Gemini (Stage 1) may not run past totalBudgetMs − reserve,
//     so a Gemini HANG (not a 429) can no longer eat the whole budget and leave the fallbacks no turn. The reserve is
//     the largest one that keeps the hedge working: quality budget 50 − 8 = 42 s → hedge delay min(28, 42 − 15) = 27 s
//     (still above the benchmarked 21–26 s, so it fires for outliers only). A reserve of 9 s would pull the hedge to
//     26 s, 10 s to 25 s, 14 s to 21 s — i.e. into the normal latency band (≈ the old 2-calls-per-script cost).
//     It is also capped at a quarter of the total, so a tiny test budget stays valid.
const _totalBudgetMs    = envInt('SCRIPT_TOTAL_BUDGET_MS', 50000);
const _stage1ReserveMs  = Math.min(envInt('SCRIPT_STAGE1_RESERVE_MS', 8000), Math.floor(_totalBudgetMs / 4));
const _qualityBudgetMs  = Math.min(envInt('SCRIPT_GEMINI_QUALITY_BUDGET_MS', 46000), _totalBudgetMs - _stage1ReserveMs);
const _minStartBudgetMs = envInt('SCRIPT_GEMINI_MIN_START_MS', 15000);
export const SCRIPT_GEMINI = {
  mode:             process.env.SCRIPT_GEMINI_MODE === 'race' ? 'race' : 'hedge',
  qualityHedgeMs:   Math.max(0, Math.min(envInt('SCRIPT_GEMINI_HEDGE_MS', 28000), _qualityBudgetMs - _minStartBudgetMs)),
  fastHedgeMs:      envInt('SCRIPT_GEMINI_FAST_HEDGE_MS', 4000),
  qualityBudgetMs:  _qualityBudgetMs,   // a hedged model may never run past this point of the quality tier
  minStartBudgetMs: _minStartBudgetMs,  // …and is not started at all with less than this left (it could not finish)
  totalBudgetMs:    _totalBudgetMs,     // whole generateScript() cascade; keep ≥10 s under maxDuration
  stage1ReserveMs:  _stage1ReserveMs,   // time Stage 1 (Gemini) leaves for Stages 2–5 (see above)
};

// ─── Script generation: Stages 2–5 (OpenRouter / Cohere) ──────────────────────────────
// Per-call ceilings, always further cut to the time left in totalBudgetMs. They used to be 10/10/8/8 s, which threw away
// valid-but-slow answers (the fastest measured real call is 16.5 s). Order of the stages is NOT changed.
//   • `lastResortReserveMs`: Stages 2–4 leave this much for Stage 5 (the cheap free model) when it is configured, so the
//     larger caps above cannot starve it when everything before it hangs.
export const SCRIPT_CASCADE = {
  gemma27bMs:          envInt('SCRIPT_GEMMA_27B_TIMEOUT_MS', 20000),
  gemma12bMs:          envInt('SCRIPT_GEMMA_12B_TIMEOUT_MS', 12000),
  cohereMs:            envInt('SCRIPT_COHERE_TIMEOUT_MS', 10000),
  deepseekMs:          envInt('SCRIPT_DEEPSEEK_TIMEOUT_MS', 12000),
  freeMs:              envInt('SCRIPT_FREE_TIMEOUT_MS', 12000),
  lastResortReserveMs: envInt('SCRIPT_LAST_RESORT_RESERVE_MS', 6000),
};

// ─── Script generation: per-model circuit breaker (lib/script-circuit.js) ─────────────
// A model that answered HTTP 429 is skipped by following requests instead of being asked (and waited for) again.
//   • rpmOpenMs:      first 429 → skip for 60 s (per-minute limits reset within a minute).
//   • escalatedOpenMs: a 429 on the first call AFTER that pause (no success in between) → skip for 15 min.
//   • dayOpenMs:      only when the 429 body names a per-DAY quota (see classify429): skipped until the quota resets
//     (capped at 24 h). Unverified assumption, see lib/script-circuit.js.
//   • redisBudgetMs:  every Redis read/write is capped; on timeout/error it falls back to per-instance memory.
export const SCRIPT_CIRCUIT = {
  enabled:         process.env.SCRIPT_CIRCUIT_ENABLED !== 'false',
  rpmOpenMs:       envInt('SCRIPT_CIRCUIT_RPM_MS', 60 * 1000),
  escalatedOpenMs: envInt('SCRIPT_CIRCUIT_ESCALATED_MS', 15 * 60 * 1000),
  strikeTtlSec:    envInt('SCRIPT_CIRCUIT_STRIKE_TTL_SEC', 30 * 60),
  redisBudgetMs:   envInt('SCRIPT_CIRCUIT_REDIS_MS', 500),
};

// ─── Guest IP retention ───────────────────────────────────────────────────────────────
// Guests are identified by IP (IPv6: /64). The one counter that outlives a day — the lifetime guest poster
// (usage:poster:lifetime:<ip>) — used to have NO expiry, i.e. an IP was stored forever. It now expires after
// GUEST_IP_RETENTION_DAYS (default 90) and the clock is REFRESHED on every use (including refused attempts), so a
// guest who keeps coming back keeps the same (spent) allowance; only a guest silent for the whole period gets a new one.
export const GUEST_RETENTION = {
  ipDays: envInt('GUEST_IP_RETENTION_DAYS', 90),
};

// ─── Retention periods that the CODE enforces (the privacy text is built from these) ───
//   characterPointerDays: Redis `character:<id>` (links to the character sheet) — set at upload, NOT refreshed on use.
//   deletionLogDays:      Redis `deletion-request:*` audit record of a data-deletion request (45 days: longer than the 30-day processing SLA, so there is always proof the deadline was met).
//   characterObjectDays / posterObjectDays / panelObjectDays: the numbers the PRIVACY TEXT promises for the FILES in R2. NOT enforced by code: they mirror the
//                         Cloudflare R2 lifecycle rules the owner set in the dashboard — `characters/` 90 days, `posters/` 60 days, `panels/` 30 days (rules
//                         count from object creation and run asynchronously). Characters are promised "within about 100 days" to cover that lag (and the
//                         seconds between the sheet being stored and its pointer being written); posters / panels "about 60 / 30 days". If a dashboard
//                         rule changes, change the matching number here — the text and its test follow. The raw selfie is deleted by code right after every upload attempt.
export const RETENTION = {
  characterPointerDays: envInt('CHARACTER_POINTER_DAYS', 90),
  characterObjectDays:  envInt('CHARACTER_OBJECT_DAYS', 100),   // R2 rule 90 + lag margin
  posterObjectDays:     envInt('POSTER_OBJECT_DAYS', 60),       // R2 rule `posters/` 60 days
  panelObjectDays:      envInt('PANEL_OBJECT_DAYS', 30),        // R2 rule `panels/` 30 days
  deletionLogDays:      envInt('DELETION_LOG_DAYS', 45),   // must stay PAST the 30-day processing SLA promised on /data-deletion + Privacy §9, so the record outlives the deadline (tests/data-deletion-copy.test.js)
  referralCookieDays:   envInt('REFERRAL_COOKIE_DAYS', 30),   // ls_ref cookie set by /i/<code>
};

// ─── Retention PUBLISHED by the AI providers (NOT enforced by us, so kept apart from RETENTION) ───
// What OpenRouter shows as each endpoint's data policy (openrouter.ai model pages) — CHECKED 2026-10-27: Google AI Studio keeps prompts up to 55 days (gemini-2.5-flash /
// flash-lite), xAI 30 days (grok-imagine), Black Forest Labs 30 days (flux.2-klein). DeepInfra publishes none; Google's cloud service for Gemini images publishes only
// abuse-monitoring retention (no number). The privacy text (§7) quotes these as "according to what the providers publish" and builds the numbers from here, so the
// "N days" test (tests/privacy-copy.test.js) knows them. Re-check them when a provider or model changes.
export const PROVIDER_RETENTION = {
  googleAiStudioDays:  55,
  xaiDays:             30,
  blackForestLabsDays: 30,
};

// ─── Global daily budget for GUEST (anonymous) script generation ─────────────────────
// Every guest script is a paid-or-free-tier Gemini call; the per-IP limit (2/day) does not bound the
// AGGREGATE (many IPs). This caps all guests together per UTC day. Signed-in users are never counted
// or blocked by it. Set GUEST_SCRIPTS_PER_DAY=0 to disable the cap. Free-tier Gemini quota is per
// PROJECT and shared with signed-in users — the default of 300 was chosen from the shared free-tier request quota.
export const GUEST_SCRIPT_BUDGET = {
  perDay: envInt('GUEST_SCRIPTS_PER_DAY', 300),
};

// ─── Monthly script cap (on top of the daily one) ─────────────────────────────────────
// Pro: 20/day AND 150/month (UTC). Free has no monthly cap (5/day ≈ 155/month already).
export const SCRIPT_MONTHLY_LIMITS = {
  pro: envInt('PRO_SCRIPTS_PER_MONTH', 150),
};

// ─── Script generation: PAID first engine with privacy routes ─────────────────────────
// Gemini 2.5 Flash through OpenRouter, provider.data_collection = "deny" (lib/story-service.js, Stage 0). Budget: DAILY_SCRIPT_BUDGET (USD/day, default 10, 0 = OFF =
// the old cascade with the free Google key first), counted per call at SCRIPT_PAID_COST_USD (lib/budget.js). Price basis (OpenRouter endpoints API, 2026-10-20):
// $0.30 / 1M in, $2.50 / 1M out. Live probe (scripts/probe-script-routes.mjs): English entry 3.1k in / 1.4k out = $0.0044, Hebrew 3.7k in / 2.4k out = $0.0071 → 0.008 per call.
export const SCRIPT_PAID = {
  model:      process.env.SCRIPT_PAID_MODEL?.trim() || 'google/gemini-2.5-flash',
  maxTokens:  envInt('SCRIPT_PAID_MAX_TOKENS', 4000),
  timeoutMs:  envInt('SCRIPT_PAID_TIMEOUT_MS', 36000),        // a Hebrew script took 22 s in the probe
  fallbackReserveMs: envInt('SCRIPT_PAID_FALLBACK_RESERVE_MS', 12000),   // time kept for the deny-only fallbacks if the paid call hangs
};
