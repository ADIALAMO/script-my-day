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
} from '../../lib/circuit-breaker.js';

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
  console.log('🤗 Trying: Hugging Face FLUX.1-schnell');

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
  console.log('☁️ Trying: Cloudflare Workers AI Flux-1-schnell');

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/@cf/black-forest-labs/flux-1-schnell`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ prompt, seed, steps: 4 }),
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
  console.log('🔀 Trying: OpenRouter Flux 2 Klein');

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
  console.log('🌸 Trying: Pollinations Flux');
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=flux&nologo=true&seed=${seed}`;
  const imageUrl = await fetchImageAsBase64(url);
  return { imageUrl, provider: 'Pollinations-Flux' };
}

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

// Poster limit is now tier-aware — see lib/quota.js TIER_LIMITS.

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  try {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  // Diagnostic: log which cascade providers are actually configured.
  // Missing entries explain why images fall through to placeholders.
  console.log('🔍 Provider env check:', {
    CLOUDFLARE_ACCOUNT_ID:  !!process.env.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN:   !!process.env.CLOUDFLARE_API_TOKEN,
    OPENROUTER_API_KEY:     !!process.env.OPENROUTER_API_KEY,
    HF_TOKEN:               !!process.env.HF_TOKEN,
  });

  const { prompt, visualPrompt, requestType, panelIndex } = req.body;
  const rawPrompt = prompt || visualPrompt || '';
  const seed      = Math.floor(Math.random() * 999999);

  const isAdmin = isAdminRequest(req);
  const isComic = requestType === 'comic' || requestType === 'storyboard';

  // Comic quota is owned by generate-storyboard.js — individual panel calls skip poster quota.
  let usageKey   = null;
  let posterLimit = 0;

  if (!isAdmin && !isComic) {
    const { tier, identifier } = await getSessionAndTier(req, res);
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
      console.log(`📊 Poster quota [${tier}]: ${usageKey} → ${used}/${posterLimit}`);
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

  const trackUsage = async () => {
    if (!isAdmin && !isComic && usageKey && posterLimit !== Infinity) {
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(usageKey);
        pipeline.expireat(usageKey, nextMidnightUTC());
        const [newVal] = await pipeline.exec();
        console.log(`✅ Poster quota: ${newVal}/${posterLimit} used`);
      } catch (e) {
        console.warn(`⚠️ Poster quota increment skipped (Redis unavailable): ${e.message}`);
      }
    }
  };

  const agentPrompt =
    typeof rawPrompt === 'string' && rawPrompt.length > 0
      ? rawPrompt.replace(/\[image:\s*/i, '').replace(/\]$/, '').trim()
      : 'Cinematic movie poster, dramatic lighting';

  const fidelityInstruction =
    'distinct male and female characters, heterosexual couple, (same sex couple: -1.5), ' +
    '(homoerotic: -1.5), (gay: -1.5), (text: -2.0), (title: -2.0), (letters: -2.0), ' +
    '(watermark: -2.0), (typography: -2.0), (signature: -2.0), (writing: -2.0), (logo: -2.0)';
  const anatomyGuard =
    ', (deformed iris, deformed pupils, semi-realistic, cgi, 3d, render, sketch, cartoon, ' +
    'drawing, anime, mutated hands and fingers:1.4), (deformed, distorted, disfigured:1.3), ' +
    'poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, ' +
    'disconnected limbs, mutation, mutated, ugly, disgusting, amputation';

  const finalPrompt = isComic
    ? `${agentPrompt}. Cinematic comic panel, dramatic bold composition, vivid color, ` +
      `clean lines, (Strictly NO text, NO titles). ${fidelityInstruction}${anatomyGuard}`
    : `A high-end cinematic RAW 35mm film still of: ${agentPrompt}. Shot on IMAX, ` +
      `perfect facial symmetry, realistic skin textures, sharp focus, 8k, masterpiece. ` +
      `(Strictly NO text, NO distortion, NO blurry faces, NO extra fingers, NO titles). ` +
      `${fidelityInstruction}${anatomyGuard}`;

  const cascade = isComic ? COMIC_CASCADE : POSTER_CASCADE;
  const trackLabel = isComic ? 'TRACK B (Comic)' : 'TRACK A (Poster)';
  const panelLabel = isComic && typeof panelIndex !== 'undefined' ? ` [panel ${panelIndex}]` : '';

  // Filter the cascade to providers that are not currently circuit-open.
  // Falls back to the full cascade when Redis is unavailable (getOpenProviders returns empty Set).
  const openProviders  = await getOpenProviders(redis);
  const activeCascade  = cascade.filter((fn) => !openProviders.has(PROVIDER_KEY[fn.name]));
  const liveCascade    = activeCascade.length ? activeCascade : cascade;

  if (openProviders.size > 0) {
    console.log(`⚡ Circuit skip: [${[...openProviders].join(', ')}]`);
  }
  console.log(
    `🎬 Image Generation: ${trackLabel}${panelLabel} → ` +
      liveCascade.map((fn) => fn.name).join(' → ')
  );

  for (const provider of liveCascade) {
    try {
      const result = await provider(finalPrompt, seed);
      await recordSuccess(redis, PROVIDER_KEY[provider.name]);
      console.log(`✅ SUCCESS via ${result.provider}`);
      await trackUsage();
      return res.status(200).json({ success: true, ...result });
    } catch (e) {
      const code = extractStatusCode(e.message);
      await recordFailure(redis, PROVIDER_KEY[provider.name], code);
      console.warn(`⚠️ ${provider.name} failed (next): ${e.message}`);
    }
  }

  // All cascade providers failed (typically: content moderation on the final provider).
  // Return a placeholder image with HTTP 200 so the frontend always gets a renderable
  // imageUrl rather than a JSON error that causes broken image icons.
  console.error(`❌ Cascade exhausted for ${trackLabel} — returning placeholder`);
  return res.status(200).json({
    success: true,
    code: CODES.PROVIDERS_BUSY,
    imageUrl: makePlaceholderImage(),
    provider: 'placeholder',
    isPlaceholder: true,
    details: `All providers exhausted (${trackLabel}).`,
  });
  } catch (error) {
    console.error('🔴 SERVER CRASH ——————————————————————————');
    console.error('Name   :', error.name);
    console.error('Message:', error.message);
    console.error('Stack  :', error.stack);
    console.error('————————————————————————————————————————————');
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: error.message || 'Internal server error.',
      errorType: error.name,
    });
  }
}
