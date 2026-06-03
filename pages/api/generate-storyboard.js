import { sanitize } from '../../utils/input-processor';
import redis from '../../lib/redis.js';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, isAdminRequest, extractDevTier } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { limitFor } from '../../lib/quota.js';

export const maxDuration = 60;

// Comic limit is now tier-aware — see lib/quota.js TIER_LIMITS.

function extractPanels(rawText) {
  const text = rawText.trim();
  try { const p = JSON.parse(text); if (Array.isArray(p) && p.length) return p; } catch {}
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { const p = JSON.parse(stripped); if (Array.isArray(p) && p.length) return p; } catch {}
  const first = rawText.indexOf('[');
  const last = rawText.lastIndexOf(']');
  if (first !== -1 && last !== -1 && last > first) {
    try { const p = JSON.parse(rawText.slice(first, last + 1)); if (Array.isArray(p) && p.length) return p; } catch {}
  }
  console.warn('⚠️ extractPanels: all JSON parse strategies failed — model returned unparseable output');
  return null;
}

const STYLE_TRACKS = {
  anime: {
    prefix: 'Dynamic action anime style, flat cel-shading, vibrant dramatic lighting, bold ink outlines —',
    suffix: '— vivid saturated colors, speed lines, expressive faces, no photorealism'
  },
  marvel: {
    prefix: '90s X-Men animated series, classic comic book shading, sharp ink line art, retro animation —',
    suffix: '— strong black ink outlines, halftone dots, dramatic heroic poses, no photorealism'
  },
  noir: {
    prefix: 'Gritty black and white comic noir, Sin City aesthetic, stark chiaroscuro shadows —',
    suffix: '— high contrast black and white only, deep ink shadows, graphic novel style, no color, no photorealism'
  }
};

// Opt 2: Static instruction separated from dynamic payload to enable Gemini context caching.
// Opt 1: No prefix/suffix in the visual field — LLM outputs only the core description.
function buildStaticInstruction(lang, maxPanels = 7) {
  const langNote = lang === 'he'
    ? 'The screenplay is in Hebrew. Write "scene" and "dialogue" fields in Hebrew. The "visual" field MUST always be written in English.'
    : 'Write all fields in English.';

  const panelRange = maxPanels <= 2 ? `exactly ${maxPanels}` : '5-7';

  return `You are a comic book storyboard artist.

${langNote}

Break down the screenplay into ${panelRange} sequential panels covering the full story arc.

Return ONLY a valid JSON array. No markdown, no backticks, no explanation — just the JSON.

Format:
[{"panel":1,"scene":"INT. LOCATION - DAY","visual":"...","dialogue":"Key line here"}]

Field rules:
- "panel": integer (1 to 7)
- "scene": location and time context, match script language
- "visual": ALWAYS ENGLISH. STRICT LIMIT: 15-25 words. Describe ONLY the key subject, action, and camera angle in comic shorthand. No style context. No photography jargon. Examples: "Hero leaping across rooftop gap, city far below, dynamic low angle" or "Two-shot confrontation in rain-soaked alley, villain raising weapon, extreme close-up eyes".
- "dialogue": single most important line or caption, match script language

Story arc required: opening → development → conflict peak → climax → resolution.`;
}

// Opt 2: systemInstruction carries the cached static block; contents carries only the dynamic screenplay.
// Opt 3: maxOutputTokens calibrated to 750 (realistic ceiling for 7 panels ≈ 630 tokens + 20% headroom).
async function runGeminiModel(model, staticInstruction, script, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: staticInstruction }] },
        contents: [{ role: 'user', parts: [{ text: `SCREENPLAY:\n${script}` }] }],
        generationConfig: { temperature: 0.25, maxOutputTokens: 750 }
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!resp.ok) return null;
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return null;
    const panels = extractPanels(text);
    if (panels) return panels;
    return null;
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name !== 'AbortError') console.warn(`⚠️ Storyboard ${model}: ${e.message}`);
    return null;
  }
}

// Opt 4: Hedged fallback — primary fires immediately; backup fires in parallel after 6s if primary
// has not yet resolved. Promise.any() takes the first winner. P95 latency drops from ~20s to ~8-10s.
async function tryGemini(staticInstruction, script, apiKey) {
  let hedgeTimerId;
  const primary = runGeminiModel('gemini-2.5-flash', staticInstruction, script, apiKey, 20000);
  const hedge = new Promise((resolve) => {
    hedgeTimerId = setTimeout(
      () => runGeminiModel('gemini-2.5-flash-lite', staticInstruction, script, apiKey, 14000).then(resolve),
      6000
    );
  });
  const winner = await Promise.any([
    primary.then(r => r ?? Promise.reject()),
    hedge.then(r => r ?? Promise.reject())
  ]).catch(() => null);
  clearTimeout(hedgeTimerId);
  if (winner) return winner;
  return runGeminiModel('gemini-flash-latest', staticInstruction, script, apiKey, 20000);
}

// Opt 2 (OpenRouter): system role carries static instruction for providers that support prefix caching.
// Opt 3: max_tokens calibrated to 750.
async function tryOpenRouter(staticInstruction, script, apiKey) {
  const models = ['google/gemma-3-27b-it', 'google/gemma-3-12b-it', 'deepseek/deepseek-chat'];
  for (const model of models) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
          'HTTP-Referer': 'https://lifescript.app',
          'X-Title': 'LifeScript Studio'
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: staticInstruction },
            { role: 'user', content: `SCREENPLAY:\n${script}` }
          ],
          temperature: 0.25,
          max_tokens: 750
        }),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (!resp.ok) continue;
      const data = await resp.json();
      const text = data?.choices?.[0]?.message?.content;
      if (!text) continue;
      const panels = extractPanels(text);
      if (panels) return panels;
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name !== 'AbortError') console.warn(`⚠️ Storyboard ${model}: ${e.message}`);
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const { script, lang, genre, comicStyle } = req.body;

    const isAdmin = isAdminRequest(req);
    // Dev-tier preview: admin can pass x-dev-tier: free|pro to simulate a
    // specific tier's unlockedPanels without touching real quota counters.
    const devTier = isAdmin ? extractDevTier(req) : null;

    // Storyboard is the single quota gate for the entire comic flow.
    // generate-poster.js skips comic quota checks — panel calls are unrestricted once the
    // storyboard step is approved and counted here.
    let usageKey      = null;
    let comicLimit    = 0;
    let maxPanels     = 7;   // always generate the full story arc for all tiers
    let unlockedPanels = null; // null → admin default (all panels visible)

    if (!isAdmin) {
      const { tier, identifier } = await getSessionAndTier(req, res);
      comicLimit     = limitFor(tier, 'comic');
      maxPanels      = limitFor(tier, 'maxPanels');
      unlockedPanels = limitFor(tier, 'unlockedPanels');
      const today = new Date().toISOString().split('T')[0];
      usageKey    = `usage:comic:${identifier}:${today}`;

      if (comicLimit === 0) {
        return res.status(403).json({
          success: false,
          code: CODES.NEEDS_ACCOUNT,
          message: 'Sign in to unlock comic generation.',
        });
      }

      try {
        const currentUsage = await redis.get(usageKey);
        const used = parseInt(currentUsage, 10) || 0;
        if (comicLimit !== Infinity && used >= comicLimit) {
          return res.status(429).json({
            success: false,
            code: CODES.QUOTA_COMIC,
            message: 'Daily comic quota reached. Come back tomorrow.',
          });
        }
      } catch (e) {
        console.warn(`⚠️ Comic quota check skipped (Redis unavailable): ${e.message}`);
      }
    }

    // Opt 3: input ceiling tightened to 3000 — eliminates the redundant .slice(0, 3000) that was
    // silently discarding the last 500 chars of a 3500-char sanitized input.
    const cleanScript = sanitize(script || '', 3000);

    if (!cleanScript || cleanScript.length < 20) {
      return res.status(400).json({ success: false, code: CODES.INPUT_TOO_SHORT, message: 'Script text too short.' });
    }

    const staticInstruction = buildStaticInstruction(lang || 'en', maxPanels);
    // Opt 1: track is resolved here so prefix/suffix are injected server-side after parsing,
    // not included in the LLM prompt — saves ~140-175 output tokens per generation.
    const track = STYLE_TRACKS[comicStyle || 'anime'];
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY?.trim();
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();

    let enrichedPanels = null;
    let storyboardEngine = null;

    if (geminiKey) {
      const panels = await tryGemini(staticInstruction, cleanScript, geminiKey);
      if (panels) {
        enrichedPanels = panels.map(p => ({ ...p, visual: `${track.prefix} ${p.visual} ${track.suffix}` }));
        storyboardEngine = 'Gemini';
      }
    }

    if (!enrichedPanels && openrouterKey) {
      const panels = await tryOpenRouter(staticInstruction, cleanScript, openrouterKey);
      if (panels) {
        enrichedPanels = panels.map(p => ({ ...p, visual: `${track.prefix} ${p.visual} ${track.suffix}` }));
        storyboardEngine = 'OpenRouter';
      }
    }

    if (!enrichedPanels) {
      return res.status(500).json({ success: false, code: CODES.STORYBOARD_FAIL, message: 'All storyboard engines offline.' });
    }

    // Increment comic quota only after a successful storyboard generation.
    // This is the single consumption point for the entire comic flow (panel image calls are unrestricted).
    if (!isAdmin && usageKey && comicLimit !== Infinity) {
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(usageKey);
        pipeline.expireat(usageKey, nextMidnightUTC());
        await pipeline.exec();
      } catch (err) {
        console.warn(`⚠️ Comic quota increment skipped (Redis unavailable): ${err.message}`);
      }
    }

    // Resolve the effective unlock count.
    // devTier lets an admin preview the free/pro experience without affecting real quotas.
    const effectiveUnlocked = devTier
      ? limitFor(devTier, 'unlockedPanels')
      : unlockedPanels; // null = admin (all panels)

    // Hard-cap to the LLM target ceiling (prevents rare overshoots above 7).
    const panelCeiling = (maxPanels > 0 && maxPanels < enrichedPanels.length)
      ? maxPanels
      : enrichedPanels.length;

    // Number of panels this tier may have AI images generated for.
    const unlockedCount = effectiveUnlocked !== null
      ? Math.min(effectiveUnlocked, panelCeiling)
      : panelCeiling;

    // Return ALL panels up to the LLM ceiling so the frontend can render the full
    // story arc grid (including the upgrade teaser cards). Locked panels have their
    // `visual` prompt stripped and carry `isLocked: true` — the image-generation
    // instruction never reaches the client. generate-poster.js independently rejects
    // any image request for a locked index as a second enforcement layer.
    const cappedPanels = enrichedPanels.slice(0, panelCeiling).map((p, idx) => {
      if (idx >= unlockedCount) {
        const { visual, ...safe } = p;
        return { ...safe, isLocked: true };
      }
      return p;
    });

    console.log(`🦸‍♂️ Comic Panel generated successfully via: ${storyboardEngine}`);
    return res.status(200).json({ success: true, panels: cappedPanels, unlockedPanels: unlockedCount });
  } catch (err) {
    console.error('generate-storyboard unhandled error:', err.message, err.stack);
    return res.status(500).json({ success: false, code: CODES.SERVER_ERROR, message: 'Internal server error.' });
  }
}
