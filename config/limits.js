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
  // ≈ $0.127 (up to 9 panel images) → 6 comics bring the whole abusive-Pro month to ≈ $4.44, i.e. ≤ half of $9.
  // (10 comics = $4.95, the old uncapped 60/month would be several times the price.) Details: test-run-report.md.
  proPerMonth:          envInt('PRO_COMICS_PER_MONTH', 6),
  // Replacements ("Replace" button) allowed per comic, enforced SERVER-side. The browser gets
  // the value from the storyboard response and only mirrors it in the UI.
  regenLimit:           envInt('COMIC_REGEN_LIMIT', 2),
  // How long a comic stays "open" for panel generation/replacement after its storyboard.
  sessionTtlSec:        24 * 60 * 60,
};

// Backstop on panel images per user per UTC day, across all comics: comics/day × (panels + regens)
// with headroom. Stops replaying many old comic sessions to farm images.
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
// ANONYMOUS poster is a LIFETIME allowance (1, no expiry) — see generate-poster.js.
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
//   • default: hedge at 28 s (outliers only), the rescue gets until `qualityBudgetMs` (46 s → ~18 s), and is not
//     started at all with less than `minStartBudgetMs` (15 s) left. The delay is clamped so that it ALWAYS fits:
//     hedge delay ≤ qualityBudgetMs − minStartBudgetMs.
//   • `totalBudgetMs` (52 s = 60 s − 8 s margin) bounds the entire cascade: no stage starts without time to finish,
//     and per-call timeouts are cut to what is left, so the route returns SCRIPT_FAIL (slot released) instead of dying.
const _qualityBudgetMs  = envInt('SCRIPT_GEMINI_QUALITY_BUDGET_MS', 46000);
const _minStartBudgetMs = envInt('SCRIPT_GEMINI_MIN_START_MS', 15000);
export const SCRIPT_GEMINI = {
  mode:             process.env.SCRIPT_GEMINI_MODE === 'race' ? 'race' : 'hedge',
  qualityHedgeMs:   Math.max(0, Math.min(envInt('SCRIPT_GEMINI_HEDGE_MS', 28000), _qualityBudgetMs - _minStartBudgetMs)),
  fastHedgeMs:      envInt('SCRIPT_GEMINI_FAST_HEDGE_MS', 4000),
  qualityBudgetMs:  _qualityBudgetMs,   // a hedged model may never run past this point of the quality tier
  minStartBudgetMs: _minStartBudgetMs,  // …and is not started at all with less than this left (it could not finish)
  totalBudgetMs:    envInt('SCRIPT_TOTAL_BUDGET_MS', 52000), // whole generateScript() cascade; keep ≥8 s under maxDuration
};

// ─── Global daily budget for GUEST (anonymous) script generation ─────────────────────
// Every guest script is a paid-or-free-tier Gemini call; the per-IP limit (2/day) does not bound the
// AGGREGATE (many IPs). This caps all guests together per UTC day. Signed-in users are never counted
// or blocked by it. Set GUEST_SCRIPTS_PER_DAY=0 to disable the cap. Free-tier Gemini quota is per
// PROJECT and shared with signed-in users — see model-inventory.md for how this default was chosen.
export const GUEST_SCRIPT_BUDGET = {
  perDay: envInt('GUEST_SCRIPTS_PER_DAY', 300),
};

// ─── Monthly script cap (on top of the daily one) ─────────────────────────────────────
// Pro: 20/day AND 150/month (UTC). Free has no monthly cap (5/day ≈ 155/month already).
export const SCRIPT_MONTHLY_LIMITS = {
  pro: envInt('PRO_SCRIPTS_PER_MONTH', 150),
};
