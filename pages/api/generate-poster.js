
import redis from '../../lib/redis.js';

// ─── Provider implementations ────────────────────────────────────────────────

async function fetchImageAsBase64(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Image fetch failed: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return `data:image/png;base64,${buf.toString('base64')}`;
}

async function runHuggingFace(prompt, seed) {
  const token = process.env.HF_TOKEN;
  if (!token) throw new Error('HF_TOKEN not configured');
  console.log('🤗 Trying: Hugging Face FLUX.1-schnell');
  const res = await fetch(
    'https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: prompt, parameters: { seed } }),
      signal: AbortSignal.timeout(40000),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`HF ${res.status}: ${err.substring(0, 150)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { imageUrl: `data:image/png;base64,${buf.toString('base64')}`, provider: 'HuggingFace' };
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

async function runPollinationsTurbo(prompt, seed) {
  console.log('🚀 Trying: Pollinations Turbo');
  const url = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?width=1024&height=1024&model=turbo&nologo=true&seed=${seed}`;
  const imageUrl = await fetchImageAsBase64(url);
  return { imageUrl, provider: 'Pollinations-Turbo' };
}

// ─── Cascade definitions ─────────────────────────────────────────────────────

// TRACK A — Standalone Poster: speed + quality first, Pollinations as safety net
const POSTER_CASCADE = [
  runHuggingFace,
  runOpenRouterKlein,
  runPollinationsTurbo,
  runPollinationsFlux,
];

// TRACK B — Comic/Storyboard Panel: Pollinations first (fast, concurrent-friendly),
// cloud providers as fallback (HF/OR can throttle under parallel storyboard load)
const COMIC_CASCADE = [
  runPollinationsFlux,
  runPollinationsTurbo,
  runHuggingFace,
  runOpenRouterKlein,
];

// ─── Handler ─────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const sanitize = (str) => (typeof str === 'string' ? str.trim() : '');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { prompt, visualPrompt, deviceId: bodyDeviceId, isAdmin: isAdminBody, requestType } = req.body;
  const rawPrompt = prompt || visualPrompt || '';
  const seed = Math.floor(Math.random() * 999999);

  const clientAdminKey = sanitize(req.headers['x-admin-key'] || isAdminBody || '');
  const serverAdminSecret = sanitize(process.env.ADMIN_SECRET_KEY || process.env.ADMIN_SECRET || '');
  const isAdmin = serverAdminSecret !== '' && clientAdminKey === serverAdminSecret;

  const identifier =
    req.headers['x-device-id'] ||
    bodyDeviceId ||
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const usageKey = `usage:poster:${identifier}:${new Date().toISOString().split('T')[0]}`;

  try {
    const currentUsage = await Promise.race([
      redis.get(usageKey),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 500)),
    ]);
    console.log(`📊 Poster Stats: key=${usageKey}, uses=${currentUsage || 0}`);
  } catch {
    console.log('⚠️ Redis logging skipped');
  }

  const trackUsage = async () => {
    if (usageKey && !isAdmin) {
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(usageKey);
        pipeline.expire(usageKey, 86400);
        await pipeline.exec();
      } catch (e) {
        console.error('Redis update error:', e);
      }
    }
  };

  const agentPrompt =
    typeof rawPrompt === 'string' && rawPrompt.length > 0
      ? rawPrompt.replace(/\[image:\s*/i, '').replace(/\]$/, '').trim()
      : 'Cinematic movie poster, dramatic lighting';

  const fidelityInstruction =
    'distinct male and female characters, heterosexual couple, (same sex couple: -1.5), (homoerotic: -1.5), (gay: -1.5), (text: -2.0), (title: -2.0), (letters: -2.0), (watermark: -2.0), (typography: -2.0), (signature: -2.0), (writing: -2.0), (logo: -2.0)';
  const anatomyGuard =
    ', (deformed iris, deformed pupils, semi-realistic, cgi, 3d, render, sketch, cartoon, drawing, anime, mutated hands and fingers:1.4), (deformed, distorted, disfigured:1.3), poorly drawn, bad anatomy, wrong anatomy, extra limb, missing limb, floating limbs, disconnected limbs, mutation, mutated, ugly, disgusting, amputation';

  const isComic = requestType === 'comic' || requestType === 'storyboard';

  const finalPrompt = isComic
    ? `${agentPrompt}. Cinematic comic panel, dramatic bold composition, vivid color, clean lines, (Strictly NO text, NO titles). ${fidelityInstruction}${anatomyGuard}`
    : `A high-end cinematic RAW 35mm film still of: ${agentPrompt}. Shot on IMAX, perfect facial symmetry, realistic skin textures, sharp focus, 8k, masterpiece. (Strictly NO text, NO distortion, NO blurry faces, NO extra fingers, NO titles). ${fidelityInstruction}${anatomyGuard}`;

  const cascade = isComic ? COMIC_CASCADE : POSTER_CASCADE;
  const trackLabel = isComic ? 'TRACK B (Comic)' : 'TRACK A (Poster)';

  console.log(`🎬 Image Generation: ${trackLabel} → ${cascade.map((fn) => fn.name).join(' → ')}`);

  for (const provider of cascade) {
    try {
      const result = await provider(finalPrompt, seed);
      console.log(`✅ SUCCESS via ${result.provider}`);
      await trackUsage();
      return res.status(200).json({ success: true, ...result });
    } catch (e) {
      console.warn(`⚠️ ${provider.name} failed (moving to next): ${e.message}`);
    }
  }

  return res.status(500).json({
    error: 'Failed to generate image',
    details: `All providers exhausted (${trackLabel}).`,
  });
}
