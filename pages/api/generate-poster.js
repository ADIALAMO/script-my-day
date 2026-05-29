import redis from '../../lib/redis.js';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, extractIdentifier, isAdminRequest } from '../../lib/api-utils.js';
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

// Gemini Image Generation — Google AI Studio key, no credit card required.
// Free tier: 10 RPM / ~500 RPD. Returns base64 inline — no CDN fetch, no polling.
// Get a free key at aistudio.google.com → set GEMINI_API_KEY env var.
//
// Model default: gemini-2.5-flash-image (stable, v1beta).
// Override via GEMINI_IMAGE_MODEL — use gemini-3.1-flash-image for the newer "Nano Banana" line.
// DO NOT use gemini-2.0-flash-exp-image-generation — that experimental model was retired.
//
// Auth: x-goog-api-key header (correct for generateContent image endpoints).
// responseModalities is intentionally omitted — dedicated image models infer it.
//
// Retry logic removed: the circuit breaker in lib/circuit-breaker.js now owns the
// cooldown window. A 429 opens the circuit for 45s so subsequent panel requests skip
// Gemini instantly rather than each burning 15s of internal retries.
async function runGemini(prompt, _seed) {
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not configured');

  const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.5-flash-image';
  console.log(`✨ Trying: Gemini Image (${model})`);

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: 'POST',
      headers: {
        'x-goog-api-key': key,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
      signal: AbortSignal.timeout(30000),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini ${res.status}: ${err.substring(0, 150)}`);
  }

  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p) => p.inlineData || p.inline_data);
  if (!imgPart) throw new Error('Gemini returned no image in response parts');

  const blob = imgPart.inlineData ?? imgPart.inline_data;
  const mime = blob.mimeType ?? blob.mime_type ?? 'image/png';
  return { imageUrl: `data:${mime};base64,${blob.data}`, provider: 'Gemini-Flash' };
}

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
//   P1 Gemini Flash       → 10 RPM / 500 RPD free, inline base64, no CC required
//   P2 HuggingFace        → free HF token, cold-start aware, cache-bypassed
//   P3 Cloudflare Workers → ~170 img/day free (10K neurons), no CC, base64 JSON
//   P4 OpenRouter Klein   → paid key required, solid quality fallback
//   P5 Pollinations       → anonymous, 1 req/15s throttled — final safety net
//
// TRACK B — Comic/Storyboard Panel
//   P1 Gemini Flash       → stagger pre-applied per panelIndex; 429s self-resolve
//   P2 HuggingFace        → x-wait-for-model absorbs cold-start stalls between panels
//   P3 Cloudflare Workers → high daily budget handles panel burst overflow
//   P4 Pollinations       → anonymous sequential fallback
//   P5 OpenRouter Klein   → last resort (content policy risk on some panel prompts)

const POSTER_CASCADE = [
  runGemini,
  runHuggingFace,
  runCloudflareAI,
  runOpenRouterKlein,
  runPollinationsFlux,
];

const COMIC_CASCADE = [
  runGemini,
  runHuggingFace,
  runCloudflareAI,
  runPollinationsFlux,
  runOpenRouterKlein,
];

// ─── Quota constants ─────────────────────────────────────────────────────────

const POSTER_DAILY_LIMIT = 2;

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  const { prompt, visualPrompt, deviceId: bodyDeviceId, requestType, panelIndex } = req.body;
  const rawPrompt = prompt || visualPrompt || '';
  const seed      = Math.floor(Math.random() * 999999);

  const isAdmin = isAdminRequest(req);
  const isComic = requestType === 'comic' || requestType === 'storyboard';

  // Comic quota is owned by generate-storyboard.js — individual panel calls are unrestricted.
  const identifier = extractIdentifier(req, bodyDeviceId);

  const today = new Date().toISOString().split('T')[0];
  const usageKey = `usage:poster:${identifier}:${today}`;

  if (!isAdmin && !isComic) {
    try {
      const currentUsage = await redis.get(usageKey);
      const used = parseInt(currentUsage, 10) || 0;
      console.log(`📊 Poster quota: ${usageKey} → ${used}/${POSTER_DAILY_LIMIT}`);
      if (used >= POSTER_DAILY_LIMIT) {
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
    if (!isAdmin && !isComic) {
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(usageKey);
        pipeline.expireat(usageKey, nextMidnightUTC());
        const [newVal] = await pipeline.exec();
        console.log(`✅ Poster quota: ${newVal}/${POSTER_DAILY_LIMIT} used`);
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

  // Stagger parallel comic panel requests so they don't all hit Gemini simultaneously.
  // Panel 0 fires immediately; each subsequent panel waits 400ms × its index.
  // At 7 panels: last panel waits 2.4s — well within the 6s Gemini burst-reset window.
  // The stagger also ensures panels 1+ start after panel 0 may have already written
  // circuit-open state to Redis, so they skip downed providers from the first request.
  // Poster requests (no panelIndex) are unaffected.
  const idx = typeof panelIndex === 'number' ? panelIndex : parseInt(panelIndex, 10) || 0;
  if (idx > 0) {
    await new Promise((r) => setTimeout(r, idx * 400));
  }

  // Filter the cascade to providers that are not currently circuit-open.
  // Falls back to the full cascade when Redis is unavailable (getOpenProviders returns empty Set).
  const openProviders  = await getOpenProviders(redis);
  const activeCascade  = cascade.filter((fn) => !openProviders.has(PROVIDER_KEY[fn.name]));
  const liveCascade    = activeCascade.length ? activeCascade : cascade;

  if (openProviders.size > 0) {
    console.log(`⚡ Circuit skip: [${[...openProviders].join(', ')}]`);
  }
  console.log(
    `🎬 Image Generation: ${trackLabel}${idx > 0 ? ` [panel ${idx}]` : ''} → ` +
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
}
