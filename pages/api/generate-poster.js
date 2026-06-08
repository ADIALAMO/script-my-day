import redis from '../../lib/redis.js';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { limitFor } from '../../lib/quota.js';
import {
  PROVIDER_KEY,
  extractStatusCode,
  getOpenProviders,
  recordFailure,
  recordSuccess,
  paidImageBudgetReached,
  recordPaidImage,
} from '../../lib/circuit-breaker.js';
import {
  grokImageFromReference,
  geminiImageFromReference,
  resolveIdentityGate,
  consumeIdentityCredit,
} from '../../lib/identity.js';
import { maybeRedeemReferral } from '../../lib/referral.js';

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
async function runHuggingFace(prompt, seed) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error('HF_TOKEN not configured');

  const res = await fetch(
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
        parameters: {
          seed,
          width: 1024,
          height: 1024,
          num_inference_steps: 4,
          guidance_scale: 3.5,
        },
      }),
      signal: AbortSignal.timeout(55000),
    }
  );

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
async function runCloudflareAI(prompt, seed) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not configured');

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
      // within the 10K free budget). Prompt is untouched, so this cannot regress prompt quality.
      body: JSON.stringify({ prompt, seed, steps: 6 }),
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
const IDENTITY_CASCADE_QUALITY = [runGrokIdentity, runGeminiIdentity];
const IDENTITY_CASCADE_VALUE   = [runGeminiIdentity, runGrokIdentity];

// ─── Cascade definitions ─────────────────────────────────────────────────────
//
// TRACK A — Standalone Poster
//   P1 Cloudflare Workers → ~170 img/day free (10K neurons), no CC, base64 JSON
//   P2 OpenRouter Klein   → paid key required, solid quality fallback
//   P3 HuggingFace        → free HF token, cold-start aware, cache-bypassed
//   P4 Pollinations       → anonymous, 1 req/15s throttled — final safety net
//
// TRACK B — Comic/Storyboard Panel
//   P1 Cloudflare Workers → high daily budget handles panel burst well
//   P2 OpenRouter Klein   → paid fallback, prompt-flexible
//   P3 HuggingFace        → x-wait-for-model absorbs cold-start stalls
//   P4 Pollinations       → anonymous sequential fallback

const POSTER_CASCADE = [
  runCloudflareAI,
  runOpenRouterKlein,
  runHuggingFace,
  runPollinationsFlux,
];

const COMIC_CASCADE = [
  runCloudflareAI,
  runOpenRouterKlein,
  runHuggingFace,
  runPollinationsFlux,
];

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const { prompt, visualPrompt, requestType, panelIndex, characterImageUrl } = req.body;
  const rawPrompt = prompt || visualPrompt || '';
  const seed      = Math.floor(Math.random() * 999999);

  const isAdmin = isAdminRequest(req);
  const isComic = requestType === 'comic' || requestType === 'storyboard';

  // Comic quota accounting is owned by generate-storyboard.js — panel image calls do
  // not increment the poster counter.  However, each panel request must still be gated
  // against the tier's unlock limit so that direct API calls cannot bypass the paywall.
  let usageKey       = null;
  let posterLimit    = 0;
  let refereeUserId  = null; // set for an authed standalone-poster request → referral activation

  if (!isAdmin) {
    if (isComic) {
      // ── Comic panel gate ───────────────────────────────────────────────────
      // generate-storyboard.js is the FIRST layer: it only returns unlocked panels
      // so the client never receives locked panel data.  This is the SECOND, independent
      // layer that rejects any direct API call for a panel index beyond the tier limit.
      const { tier } = await getSessionAndTier(req, res);
      const unlockedPanels = limitFor(tier, 'unlockedPanels');

      // panelIndex arrives as a JSON number from the client; guard against missing /
      // non-numeric values (which we treat as a rejected request, fail-safe).
      const idx = Number.isFinite(panelIndex) ? panelIndex : parseInt(panelIndex, 10);

      if (!Number.isFinite(idx) || idx >= unlockedPanels) {
        console.warn(`⚠️ Panel request rejected — index=${idx} exceeds tier limit (${unlockedPanels})`);
        return res.status(403).json({
          success: false,
          code: CODES.NEEDS_ACCOUNT,
          message: 'Upgrade to Pro to generate images for all storyboard panels.',
        });
      }

    } else {
      // ── Standalone movie poster quota ──────────────────────────────────────
      const { tier, identifier, userId } = await getSessionAndTier(req, res);
      refereeUserId = userId; // authed → eligible to activate a pending referral on success
      posterLimit = limitFor(tier, 'poster');
      const today = new Date().toISOString().split('T')[0];
      usageKey    = `usage:poster:${identifier}:${today}`;

      if (posterLimit === 0) {
        return res.status(403).json({
          success: false,
          code: CODES.NEEDS_ACCOUNT,
          message: 'Sign in to unlock poster generation.',
        });
      }

      try {
        const currentUsage = await redis.get(usageKey);
        const used = parseInt(currentUsage, 10) || 0;
        if (posterLimit !== Infinity && used >= posterLimit) {
          return res.status(429).json({
            success: false,
            code: CODES.QUOTA_POSTER,
            message: 'Daily poster quota reached. Come back tomorrow.',
          });
        }
      } catch (e) {
        console.warn(`⚠️ Poster quota check skipped (Redis unavailable): ${e.message}`);
      }
    }
  }

  const trackUsage = async () => {
    if (isComic) return; // comic panels are counted by generate-storyboard.js — never here
    const today = new Date().toISOString().split('T')[0];

    // Per-user daily quota — only finite-quota non-admin tiers consume a credit.
    if (!isAdmin && usageKey && posterLimit !== Infinity) {
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(usageKey);
        pipeline.expireat(usageKey, nextMidnightUTC());
        await pipeline.exec();
      } catch (e) {
        console.warn(`⚠️ Poster quota increment skipped (Redis unavailable): ${e.message}`);
      }
    }

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

  // Two distinct rendering targets:
  //  • COMIC — stays bare clean prose; the storyboard already supplies the style framing in
  //    agentPrompt. Anatomy/fidelity guards proved to summon defects on FLUX, so none are added.
  //  • POSTER — photorealistic film still. Here the rich cinematic descriptors genuinely help FLUX
  //    produce a polished result, so we restore the original cinematic structure (positive prose
  //    only — no SD-weight syntax and no negation lists, which FLUX cannot parse).
  const finalPrompt = isComic
    ? agentPrompt
    : `A high-end cinematic RAW 35mm film still of: ${agentPrompt}. ` +
      `Shot on IMAX, dramatic cinematic lighting, realistic skin textures, ` +
      `sharp focus, 8k, masterpiece.`;

  // ── Identity Track gate ─────────────────────────────────────────────────────
  // Decides whether this request may inject the user's character reference.
  // 'reject' → paid gate / monthly quota; 'identity' → prepend the Grok provider;
  // 'standard' → no/invalid face, normal generation (degradation, not an error).
  const gate = await resolveIdentityGate(req, res, { isAdmin, characterImageUrl, isComic });
  if (gate.mode === 'reject') {
    return res.status(gate.status).json({ success: false, code: gate.code });
  }
  const useIdentity = gate.mode === 'identity';

  const baseCascade = isComic ? COMIC_CASCADE : POSTER_CASCADE;
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
  const activeCascade  = cascade.filter((fn) => {
    if (openProviders.has(PROVIDER_KEY[fn.name])) return false;
    if (paidImageCapped && fn.name === 'runOpenRouterKlein') return false;
    return true;
  });
  const liveCascade    = activeCascade.length ? activeCascade : cascade;

  for (const provider of liveCascade) {
    try {
      const result = await provider(finalPrompt, seed, { characterImageUrl });
      await recordSuccess(redis, PROVIDER_KEY[provider.name]);
      // Count every successful PAID faceless call toward the daily image budget so the
      // kill-switch above can trip once DAILY_IMAGE_BUDGET is reached. Klein is the only
      // paid provider in the faceless cascade (identity spend is metered separately).
      if (provider.name === 'runOpenRouterKlein') await recordPaidImage(redis);
      await trackUsage();
      // Consume an identity credit ONLY when the winning provider actually applied
      // the face — a degraded (faceless) result must not cost the user a credit.
      if (useIdentity && result.faceApplied) {
        await consumeIdentityCredit(gate.usageKey, gate.limit, { isLifetime: gate.isLifetime });
      }
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
      return res.status(200).json({ success: true, ...result, referralGranted });
    } catch (e) {
      const code = extractStatusCode(e.message);
      await recordFailure(redis, PROVIDER_KEY[provider.name], code);
      console.warn(`⚠️ ${provider.name} failed: ${e.message}`);
    }
  }

  // All cascade providers failed. Return a placeholder so the frontend always
  // gets a renderable imageUrl rather than a broken image icon.
  console.error(`❌ Image cascade exhausted (${trackLabel}) — returning placeholder`);
  return res.status(200).json({
    success: true,
    code: CODES.PROVIDERS_BUSY,
    imageUrl: makePlaceholderImage(),
    provider: 'placeholder',
    isPlaceholder: true,
    details: `All providers exhausted (${trackLabel}).`,
  });
  } catch (error) {
    console.error('generate-poster unhandled error:', error.message, error.stack);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: error.message || 'Internal server error.',
      errorType: error.name,
    });
  }
}
