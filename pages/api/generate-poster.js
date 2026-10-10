import redis from '../../lib/redis.js';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, isAdminRequest, isValidComicSeed } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { limitFor } from '../../lib/quota.js';
import { guardComicPanel } from '../../lib/comic-guard.js';
import { reservePosterQuota, releasePosterQuota } from '../../lib/poster-quota.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import {
  PROVIDERS,
  extractStatusCode,
  getOpenProviders,
  recordFailure,
  recordSuccess,
  paidImageBudgetReached,
  recordPaidImage,
} from '../../lib/circuit-breaker.js';

const PROVIDERS_SET = new Set(PROVIDERS);
import {
  grokImageFromReference,
  geminiImageFromReference,
  resolveIdentityGate,
} from '../../lib/identity.js';
import { maybeRedeemReferral } from '../../lib/referral.js';
import {
  COMIC_NEGATIVE_PROMPT,
  compileComicPrompt,
  makeComicSeedRoot,
  makePanelSeed,
} from '../../lib/comic-prompt-compiler.js';

// Body size cap: the largest legitimate payload is a ~2 MB base64 characterImageUrl
// (validFaceUrl allows up to 2 000 000 chars). Capping at 2 mb prevents the default
// 4 mb Next.js limit from being abused to waste serverless CPU on junk bodies.
export const config = {
  api: { bodyParser: { sizeLimit: '2mb' } },
};

// ─── Shared utility ───────────────────────────────────────────────────────────

async function fetchImageAsBase64(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Image fetch failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/png;base64,${buf.toString('base64')}`;
}

// Returns an inline SVG data URI used when all cascade providers have failed.
// This guarantees the frontend always receives a renderable imageUrl rather than
// a JSON error, preventing broken image icons on cascade exhaustion.
function makePlaceholderImage(label = 'Scene unavailable') {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">` +
    `<rect width="1024" height="1024" fill="#111118"/>` +
    `<rect x="362" y="362" width="300" height="300" rx="10" fill="none" stroke="#2a2a3a" stroke-width="3"/>` +
    `<line x1="362" y1="362" x2="662" y2="662" stroke="#2a2a3a" stroke-width="3"/>` +
    `<line x1="662" y1="362" x2="362" y2="662" stroke="#2a2a3a" stroke-width="3"/>` +
    `<text x="512" y="720" text-anchor="middle" font-family="system-ui,sans-serif" ` +
    `font-size="26" fill="#555">${label}</text>` +
    `<text x="512" y="760" text-anchor="middle" font-family="system-ui,sans-serif" ` +
    `font-size="18" fill="#3a3a4a">All providers exhausted</text>` +
    `</svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

// ─── Provider implementations ─────────────────────────────────────────────────

// HuggingFace FLUX.1-schnell — free HF token, no credit card.
// x-use-cache: false    → every prompt gets a unique generation (critical for storyboards
//                         where repeated panel calls would otherwise return the same image)
// x-wait-for-model: true → blocks on cold-start instead of immediately returning 503
// num_inference_steps: 4 → FLUX Schnell is distilled for 1–4 steps; explicit beats default
// guidance_scale: 3.5    → FLUX Schnell's documented optimum (SD defaults cause oversaturation)
async function runHuggingFace(prompt, seed, opts = {}) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error('HF_TOKEN not configured');

  const parameters = {
    seed,
    width: 1024,
    height: 1024,
    num_inference_steps: 4,
    guidance_scale: 3.5,
  };
  if (opts.negativePrompt) parameters.negative_prompt = opts.negativePrompt;

  const post = (params) => fetch(
    'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'x-use-cache': 'false',
        'x-wait-for-model': 'true',
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: params,
      }),
      signal: AbortSignal.timeout(55000),
    }
  );

  let res = await post(parameters);
  // Some FLUX endpoints ignore/accept negative_prompt, others reject unknown params.
  // If that happens, retry once without losing the whole provider.
  if (!res.ok && opts.negativePrompt && (res.status === 400 || res.status === 422)) {
    const safeParameters = { ...parameters };
    delete safeParameters.negative_prompt;
    console.warn('⚠️ HuggingFace rejected negative_prompt — retrying without it');
    res = await post(safeParameters);
  }

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HF ${res.status}: ${err.substring(0, 150)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return {
    imageUrl: `data:image/png;base64,${buf.toString('base64')}`,
    provider: 'HuggingFace',
  };
}

// Cloudflare Workers AI — free 10,000 neurons/day (resets midnight UTC), no CC required.
// flux-1-schnell costs ~58 neurons per 1024px image ≈ 170+ free images/day.
// Setup: free cloudflare.com account → My Profile → API Tokens → Workers AI template.
// Env vars: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN
// Response: JSON with `image` field containing base64 JPEG — no binary parsing needed.
async function runCloudflareAI(prompt, seed, opts = {}) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not configured');

  // Confirmed empirically against the real API (Oct 2026, three direct curl calls,
  // free tier — no cost): this model's enforced schema accepts ONLY prompt and
  // steps. Both `seed` and `negative_prompt` reject with "Additional or
  // unevaluated properties '/seed' at '/' not allowed" (code 5006) — the
  // previous version sent `seed` unconditionally, so EVERY call here 400'd,
  // before and after the old retry-without-negative_prompt fallback (which
  // never stripped seed either, so the retry 400'd too). `seed` and
  // opts.negativePrompt are still accepted as parameters for call-site
  // uniformity with the other cascade providers (HF, OpenRouter Klein,
  // Pollinations all genuinely use seed) but are intentionally unused here —
  // Cloudflare has never been able to honor either, so dropping them loses
  // nothing that was actually working.
  const body = { prompt, steps: 6 };

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // steps:6 (up from schnell's default 4, CF max is 8) — gives the model more refinement
      // passes for fine details like hands/anatomy. Costs ~85 neurons/img vs ~58 (still ~115/day
      // within the 10K free budget).
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(35000),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Cloudflare AI ${res.status}: ${err.substring(0, 150)}`);
  }

  const data = await res.json();
  const b64 = data.result?.image ?? data.image;
  if (!b64) throw new Error('Cloudflare AI returned no image field');
  return { imageUrl: `data:image/jpeg;base64,${b64}`, provider: 'Cloudflare-Flux' };
}

async function runOpenRouterKlein(prompt, seed) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error('OPENROUTER_API_KEY not configured');

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://lifescript.app',
      'X-Title': 'LifeScript Studio',
    },
    body: JSON.stringify({
      model: 'black-forest-labs/flux.2-klein-4b',
      messages: [{ role: 'user', content: prompt }],
      seed,
    }),
    signal: AbortSignal.timeout(25000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${err.substring(0, 150)}`);
  }

  const data = await res.json();
  const raw =
    data.images?.[0] ||
    data.choices?.[0]?.message?.images?.[0]?.image_url?.url ||
    data.choices?.[0]?.message?.content;
  if (!raw) throw new Error('No image data in OpenRouter response');

  const imageUrl = await fetchImageAsBase64(raw);
  return { imageUrl, provider: 'OpenRouter-Klein' };
}

async function runPollinationsFlux(prompt, seed) {
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;
  const imageUrl = await fetchImageAsBase64(url);
  return { imageUrl, provider: 'Pollinations-Flux' };
}

// Identity Track — Grok Imagine Image Quality via OpenRouter, conditioned on the
// user's stored character reference (opts.characterImageUrl). Verified response is a
// base64 JPEG data URI → passed through as-is. `faceApplied: true` signals the handler
// to consume an identity credit; if this throws, the cascade degrades to a faceless
// provider and NO credit is spent. `seed` is kept for signature parity (unused — the
// verified Grok call does not take a seed).
async function runGrokIdentity(prompt, seed, opts) {
  const faceUrl = opts?.characterImageUrl;
  if (!faceUrl) throw new Error('runGrokIdentity requires a characterImageUrl');
  const imageUrl = await grokImageFromReference(prompt, faceUrl);
  return { imageUrl, provider: 'Grok-Identity', faceApplied: true };
}

// Identity Track P2 — cheaper/faster fallback (Gemini 2.5 Flash Image). Same faceApplied
// contract, so a credit is still consumed when it wins. Softer style than Grok but
// benchmarked at identity parity — a graceful quality step-down, not a faceless drop.
async function runGeminiIdentity(prompt, seed, opts) {
  const faceUrl = opts?.characterImageUrl;
  if (!faceUrl) throw new Error('runGeminiIdentity requires a characterImageUrl');
  const imageUrl = await geminiImageFromReference(prompt, faceUrl);
  return { imageUrl, provider: 'Gemini-Identity', faceApplied: true };
}

// Two-tier identity cascades, ordered by tier (Option C cost control):
//   QUALITY (Pro+/admin): Grok first ($0.06, the app's signature inked look) → Gemini fallback.
//   VALUE   (Free taste): Gemini first ($0.039, identity-parity) to cap the cost of the
//                         one-time free poster → Grok only if Gemini fails.
// On exhaustion either cascade degrades further to the free faceless cascade.
// Each cascade entry is { fn, key } rather than a bare function reference.
// Function.prototype.name is NOT reliable here: Next's production build
// minifies these declarations (confirmed by inspecting the compiled output —
// runHuggingFace became `function q`, runOpenRouterKlein became `function s`,
// etc.), so every provider.name-based lookup (PROVIDER_KEY[provider.name],
// provider.name === 'runOpenRouterKlein') silently resolved to undefined/false
// in production. The circuit breaker never actually opened a circuit (writes
// went to the dead key circuit:img:undefined, never read by anything), and
// recordPaidImage() never fired even on a real paid OpenRouter success. `key`
// is a plain string literal, immune to minification, and must exactly match
// one of lib/circuit-breaker.js's PROVIDERS entries — asserted below.
const IDENTITY_CASCADE_QUALITY = [
  { fn: runGrokIdentity,   key: 'grok_identity' },
  { fn: runGeminiIdentity, key: 'gemini_identity' },
];
const IDENTITY_CASCADE_VALUE = [
  { fn: runGeminiIdentity, key: 'gemini_identity' },
  { fn: runGrokIdentity,   key: 'grok_identity' },
];

// ─── Cascade definitions ─────────────────────────────────────────────────────
//
// Poster and Comic share ONE ordering — free engines first, the paid engine third — so
// everyday generation stays on the free providers and OpenRouter Klein is only reached as a
// paid fallback when BOTH free engines fail. This minimizes spend (Klein is rarely hit).
// Cloudflare leads over HuggingFace for SPEED: CF returns in ~2-3s, whereas HF's
// x-wait-for-model:true blocks on cold-start and can take 15-20s on the first call.
//   P1 Cloudflare       → FLUX.1-schnell @ steps:6, free ~170 img/day (10K neurons), fast
//   P2 HuggingFace      → FLUX.1-schnell, free HF token, x-wait-for-model absorbs cold-start.
//                         OMITTED unless HF_PROVIDER_ENABLED='true' — hf-inference's
//                         FLUX.1-schnell route returns a permanent HTTP 410 as of ~July
//                         2026 (confirmed via HF's own forum, model pulled, won't self-
//                         heal). The 410→midnight circuit (circuit-breaker.js) already
//                         capped this to one wasted hop/day, but skipping it outright
//                         avoids even that single guaranteed-failing call. Flip the flag
//                         back on only after swapping runHuggingFace to a model confirmed
//                         to actually work on the free hf-inference tier.
//   P3 OpenRouter Klein → FLUX.2-klein (paid). Auto-dropped once DAILY_IMAGE_BUDGET is hit
//                         (see filter below) so a viral day can never produce a billing surprise.
//   P4 Pollinations     → anonymous, 1 req/15s throttled — final safety net.

const HF_ENABLED = process.env.HF_PROVIDER_ENABLED === 'true';
const HF_ENTRY = { fn: runHuggingFace, key: 'huggingface' };

const POSTER_CASCADE = [
  { fn: runCloudflareAI,    key: 'cloudflare' },
  ...(HF_ENABLED ? [HF_ENTRY] : []),
  { fn: runOpenRouterKlein, key: 'openrouter' },
  { fn: runPollinationsFlux, key: 'pollinations' },
];

const COMIC_CASCADE = [
  { fn: runCloudflareAI,    key: 'cloudflare' },
  ...(HF_ENABLED ? [HF_ENTRY] : []),
  { fn: runOpenRouterKlein, key: 'openrouter' },
  { fn: runPollinationsFlux, key: 'pollinations' },
];

// Comic-consistency modes (see generate-storyboard.js, which decides this ONCE
// per comic and writes comic:mode:<comicSeed>, read below). 'klein' puts
// OpenRouter Klein first so every panel shares its seed-honored look; 'free'
// excludes Klein ENTIRELY for the whole comic (not just per-call budget
// filtering) so a mid-comic style switch never happens. Pollinations stays
// last in both — it has no client-side throttling of its own, and its "1 req/
// 15s" limit is enforced by Pollinations' own server, not us: 7 panels firing
// in parallel would mean at most ~1 lands inside that window, so it can't
// serve as a primary fallback for a multi-panel comic despite honoring seed.
const COMIC_CASCADE_KLEIN_FIRST = [
  { fn: runOpenRouterKlein, key: 'openrouter' },
  { fn: runCloudflareAI,    key: 'cloudflare' },
  ...(HF_ENABLED ? [HF_ENTRY] : []),
  { fn: runPollinationsFlux, key: 'pollinations' },
];
const COMIC_CASCADE_FREE_ONLY = [
  { fn: runCloudflareAI,    key: 'cloudflare' },
  ...(HF_ENABLED ? [HF_ENTRY] : []),
  { fn: runPollinationsFlux, key: 'pollinations' },
];

// Guard against ever reintroducing the circuit:img:undefined bug via a typo —
// every cascade entry's key must exist in circuit-breaker.js's own PROVIDERS
// list, checked once at module load (cheap, runs on cold start only).
for (const cascade of [POSTER_CASCADE, COMIC_CASCADE, COMIC_CASCADE_KLEIN_FIRST, COMIC_CASCADE_FREE_ONLY, IDENTITY_CASCADE_QUALITY, IDENTITY_CASCADE_VALUE]) {
  for (const { key } of cascade) {
    if (!PROVIDERS_SET.has(key)) {
      throw new Error(`generate-poster.js: cascade key "${key}" is not in circuit-breaker.js's PROVIDERS`);
    }
  }
}

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  let panelGuard = null;       // comic panel reservation (lib/comic-guard.js) — released if no image is produced
  let posterQuotaKey = null;   // standalone poster reservation (lib/poster-quota.js) — released if no image is produced
  let gateRelease = null;      // identity credit + global identity budget reservation (resolveIdentityGate) — released if the face was not applied
  /** give back every reservation that was taken for a request that did NOT produce a real image */
  const releaseReservations = async () => {
    await panelGuard?.release();
    await releasePosterQuota(posterQuotaKey); posterQuotaKey = null;
    await gateRelease?.(); gateRelease = null;
  };
  try {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  // ── Rate limiting (sliding window, before quota gate) ─────────────────────
  // generate-poster is called for both standalone posters and per-panel comic
  // images (up to 7 per comic), so the limit is set higher than other endpoints.
  // This still blocks automated burst attacks while never throttling real users.
  if (await enforceRateLimit(req, res, 'generate-poster')) return;

  const {
    prompt,
    visualPrompt,
    requestType,
    panelIndex,
    characterImageUrl,
    comicSeed,
    seed: requestedSeed,
  } = req.body;
  const rawPrompt = prompt || visualPrompt || '';

  const isAdmin = isAdminRequest(req);
  const isComic = requestType === 'comic' || requestType === 'storyboard';

  // Comic quota accounting is owned by generate-storyboard.js — panel image calls do
  // not increment the poster counter.  However, each panel request must still be gated
  // against the tier's unlock limit so that direct API calls cannot bypass the paywall.
  let refereeUserId  = null; // set for an authed standalone-poster request → referral activation

  if (!isAdmin) {
    if (isComic) {
      // ── Comic panel gate ───────────────────────────────────────────────────
      // generate-storyboard.js opens the comic SESSION (owner + how many panels THIS comic
      // unlocks) and owns the comic quota. This is the independent SECOND layer: lib/comic-guard.js
      // checks ownership, the unlocked count, the per-user daily panel cap, and the per-comic
      // replacement budget — all server-side — so a direct API call can neither reach a locked
      // panel nor regenerate the same panel beyond the allowed replacements.
      const { tier, identifier } = await getSessionAndTier(req, res);
      const guard = await guardComicPanel({ tier, identifier, comicSeed, panelIndex });
      if (!guard.ok) {
        console.warn(`⚠️ Panel request rejected — ${guard.code} (index=${panelIndex})`);
        return res.status(guard.status).json({ success: false, code: guard.code });
      }
      panelGuard = guard;

    } else {
      // ── Standalone movie poster quota ──────────────────────────────────────
      const { tier, identifier, userId } = await getSessionAndTier(req, res);
      refereeUserId = userId; // authed → eligible to activate a pending referral on success
      // The poster quota is RESERVED atomically (INCR then compare; rolled back on refusal and whenever no
      // image is produced) — see lib/poster-quota.js. Anonymous = a single LIFETIME taste poster per IP.
      // Redis trouble fails open, as before.
      try {
        const q = await reservePosterQuota(tier, identifier);
        if (!q.ok) {
          return res.status(q.status).json({
            success: false,
            code: q.code,
            message: q.status === 403 ? 'Sign in to unlock poster generation.' : 'Poster quota reached.',
          });
        }
        posterQuotaKey = q.key;
      } catch (e) {
        console.warn(`⚠️ Poster quota reservation skipped (Redis unavailable): ${e.message}`);
      }
    }
  }

  const trackUsage = async () => {
    if (isComic) return; // comic panels are counted by generate-storyboard.js — never here
    const today = new Date().toISOString().split('T')[0];

    // ── Global activity counters (all tiers) — powers /api/admin/stats ─────────
    try {
      const dayKey = `stats:poster:global:${today}`;
      const pipeline = redis.pipeline();
      pipeline.incr(dayKey);
      pipeline.expireat(dayKey, nextMidnightUTC());
      pipeline.incr('stats:poster:total');
      await pipeline.exec();
    } catch (e) {
      console.warn(`⚠️ Poster stats counter skipped (Redis unavailable): ${e.message}`);
    }
  };

  const agentPrompt =
    typeof rawPrompt === 'string' && rawPrompt.length > 0
      ? rawPrompt.replace(/\[image:\s*/i, '').replace(/\]$/, '').trim()
      : 'Cinematic movie poster, dramatic lighting';

  const numericPanelIndex = Number.isFinite(panelIndex) ? panelIndex : parseInt(panelIndex, 10);
  const normalizeSeed = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.abs(Math.floor(n)) % 1000000 : null;
  };
  const stableComicSeed = comicSeed ?? makeComicSeedRoot(agentPrompt);
  const seed = isComic
    ? (normalizeSeed(requestedSeed) ?? makePanelSeed(stableComicSeed, numericPanelIndex))
    : (normalizeSeed(requestedSeed) ?? Math.floor(Math.random() * 999999));

  // Two distinct rendering targets:
  //  • COMIC — compiled server-side into a compact, anatomy-safe panel prompt right before
  //    the provider call. This protects every comic image path, including retries/regens.
  //  • POSTER — photorealistic film still. Here the rich cinematic descriptors genuinely help FLUX
  //    produce a polished result, so we restore the original cinematic structure (positive prose
  //    only — no SD-weight syntax and no negation lists, which FLUX cannot parse).
  const finalPrompt = isComic
    ? compileComicPrompt(agentPrompt)
    : `A high-end cinematic RAW 35mm film still of: ${agentPrompt}. ` +
      `Shot on IMAX, dramatic cinematic lighting, realistic skin textures, ` +
      `sharp focus, 8k, masterpiece.`;
  const negativePrompt = isComic ? COMIC_NEGATIVE_PROMPT : undefined;

  // ── Identity Track gate ─────────────────────────────────────────────────────
  // Decides whether this request may inject the user's character reference.
  // 'reject' → paid gate / monthly quota; 'identity' → prepend the Grok provider;
  // 'standard' → no/invalid face, normal generation (degradation, not an error).
  const gate = await resolveIdentityGate(req, res, { isAdmin, characterImageUrl, isComic });
  gateRelease = gate.release || null;
  if (gate.mode === 'reject') {
    await releaseReservations();
    return res.status(gate.status).json({ success: false, code: gate.code });
  }
  const useIdentity = gate.mode === 'identity';

  // Read this comic's provider mode, decided once by generate-storyboard.js.
  // Missing (expired past its 24h TTL, or never written — e.g. an older
  // client build) or a Redis error both fall back to today's existing
  // COMIC_CASCADE unchanged — this lookup must never fail a panel.
  let comicBaseCascade = COMIC_CASCADE;
  if (isComic && isValidComicSeed(comicSeed)) {
    try {
      const mode = await redis.get(`comic:mode:${comicSeed}`);
      if (mode === 'klein') comicBaseCascade = COMIC_CASCADE_KLEIN_FIRST;
      else if (mode === 'free') comicBaseCascade = COMIC_CASCADE_FREE_ONLY;
    } catch (e) {
      console.warn(`⚠️ Comic mode lookup skipped (Redis unavailable): ${e.message}`);
    }
  }

  const baseCascade = isComic ? comicBaseCascade : POSTER_CASCADE;
  // Free taste (gate.isLifetime) runs the VALUE cascade (Gemini first) to cap cost;
  // Pro+/admin run QUALITY (Grok first). Identity providers run FIRST — if both fail the
  // loop continues into the faceless cascade so the user still gets an image sans face.
  const identityCascade = gate.isLifetime ? IDENTITY_CASCADE_VALUE : IDENTITY_CASCADE_QUALITY;
  const cascade = useIdentity ? [...identityCascade, ...baseCascade] : baseCascade;
  const trackLabel = isComic ? 'TRACK B (Comic)' : 'TRACK A (Poster)';

  // Filter the cascade to providers that are not currently circuit-open.
  // Falls back to the full cascade when Redis is unavailable (getOpenProviders returns empty Set).
  // Additionally drop the ONLY paid faceless provider (OpenRouter Klein) once the global daily
  // image budget is hit — overflow then falls straight through to the free providers so a viral
  // day can never produce an OpenRouter billing surprise. Identity providers are governed
  // separately by DAILY_IDENTITY_BUDGET (lib/identity.js).
  const paidImageCapped = await paidImageBudgetReached(redis);
  const openProviders  = await getOpenProviders(redis);
  const activeCascade  = cascade.filter((entry) => {
    if (openProviders.has(entry.key)) return false;
    if (paidImageCapped && entry.key === 'openrouter') return false;
    return true;
  });
  // Fail-open fallback: if every provider got filtered out for being open-
  // circuited, try the whole cascade anyway rather than attempt nothing — but
  // a cost-capped OpenRouter must stay excluded even here. Without this, the
  // one scenario where every OTHER provider is simultaneously open-circuited
  // is exactly the scenario that silently re-included the ONE provider
  // DAILY_IMAGE_BUDGET was specifically set up to stop spending on. Cloudflare
  // and Pollinations are never filtered by the budget cap, so this can never
  // end up empty.
  const budgetSafeCascade = paidImageCapped ? cascade.filter((e) => e.key !== 'openrouter') : cascade;
  const liveCascade = activeCascade.length ? activeCascade : budgetSafeCascade;

  for (const provider of liveCascade) {
    try {
      const result = await provider.fn(finalPrompt, seed, { characterImageUrl, negativePrompt });
      await recordSuccess(redis, provider.key);
      // Count every successful PAID faceless call toward the daily image budget so the
      // kill-switch above can trip once DAILY_IMAGE_BUDGET is reached. Klein is the only
      // paid provider in the faceless cascade (identity spend is metered separately).
      if (provider.key === 'openrouter') await recordPaidImage(redis);
      await trackUsage();
      // The identity credit and the global identity budget slot were RESERVED atomically in the gate. Keep them
      // only when the winning provider actually applied the face — a degraded (faceless) result must not cost
      // the user a credit (nor the shared budget), so give them back.
      if (useIdentity && !result.faceApplied) { await gateRelease?.(); }
      gateRelease = null; posterQuotaKey = null; panelGuard = null;   // a real image was produced: the reservations stand
      // Referral activation: this user's FIRST successful poster redeems any pending invite
      // (rewards the REFERRER). No-ops instantly (no Redis traffic) when no ls_ref cookie is
      // present, and is idempotent + fail-safe — see lib/referral.js. The returned flag lets
      // the client fire the GA4 `referral_activated` funnel event.
      let referralGranted = false;
      if (refereeUserId) {
        referralGranted = await maybeRedeemReferral(req, res, refereeUserId);
        if (referralGranted) console.log(`🎁 Referral reward granted (referee=${refereeUserId})`);
      }
      console.log(`🎨 Poster generated successfully by: ${result.provider}`);
      return res.status(200).json({
        success: true,
        ...result,
        referralGranted,
        // The user had a face but their own identity quota was exhausted — this poster
        // generated faceless instead of failing outright (see resolveIdentityGate). Lets
        // the client show a non-blocking "why no face" notice instead of a silent swap.
        ...(gate.identityDegraded ? { identityDegraded: true, code: gate.code } : {}),
      });
    } catch (e) {
      // Cloudflare's own prompt-content filter (error code 8007, "Input prompt
      // contains NSFW content") rejects a specific PROMPT, not the provider
      // itself — it's not a signal that Cloudflare is unhealthy. Tripping the
      // circuit over it would needlessly push OTHER, unrelated concurrent
      // requests (e.g. every other panel in the same comic) onto paid Klein
      // for the circuit's whole open duration, over a single prompt's wording.
      // Recognized by the literal body content, not HTTP status — Cloudflare
      // returns this as a plain 400, identical to a real schema/request error.
      const isContentFilterReject = provider.key === 'cloudflare' && /\b8007\b|NSFW/i.test(e.message);
      if (isContentFilterReject) {
        console.warn(`⚠️ cloudflare content-filter reject, falling through: ${e.message}`);
      } else {
        const code = extractStatusCode(e.message);
        await recordFailure(redis, provider.key, code);
        console.warn(`⚠️ ${provider.key} failed: ${e.message}`);
      }
    }
  }

  // All cascade providers failed. Return a placeholder so the frontend always
  // gets a renderable imageUrl rather than a broken image icon.
  console.error(`❌ Image cascade exhausted (${trackLabel}) — returning placeholder`);
  await releaseReservations(); // no image was produced → the attempt must not burn a replacement, a poster slot or an identity credit
  return res.status(200).json({
    success: true,
    // The spend cap removed the paid fallback and no free provider could serve this request →
    // say so honestly instead of the generic "providers busy".
    code: paidImageCapped ? CODES.IMAGE_BUDGET_REACHED : CODES.PROVIDERS_BUSY,
    imageUrl: makePlaceholderImage(),
    provider: 'placeholder',
    isPlaceholder: true,
    details: `All providers exhausted (${trackLabel}).`,
  });
  } catch (error) {
    await releaseReservations();
    console.error('generate-poster unhandled error:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Internal server error.',
    });
  }
}
