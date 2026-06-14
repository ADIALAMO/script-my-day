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

// FLUX.1 performs best on clean natural-language prose, not SD-era keyword stacks. Each track is
// just a style framing (prefix) and a palette/finish (suffix) — no anatomy guards, no negation
// lists. The model renders most naturally when the scene description is the dominant signal.
// Selective Framing cost control: cap the number of panels that carry the user's
// identity (each costs ~$0.06 via the Identity Track). If Gemini marks more than
// MAX_HERO panels, keep only the three narrative anchors — opening, climax (middle),
// resolution — and demote the rest to the free faceless cascade. A no-op when the
// model marked <= MAX_HERO, and harmless for non-identity comics (hero is ignored
// downstream when no character reference is present).
const MAX_HERO = 3;
function applyHeroCap(panels, maxHero = MAX_HERO) {
  const flagged = panels.map((p, i) => (p.hero === true ? i : -1)).filter(i => i >= 0);
  if (flagged.length <= maxHero) return panels;
  const keep = new Set([
    flagged[0],
    flagged[Math.floor(flagged.length / 2)],
    flagged[flagged.length - 1],
  ]);
  return panels.map((p, i) => ({ ...p, hero: keep.has(i) }));
}

// Free OpenRouter last-resort net for the storyboard step (mirrors lib/story-service.js
// Stage 5). Verified 2026-06-10; three providers so one provider's rate-limit can't
// empty it. Only reached when Gemini AND the paid OpenRouter stage both fail — keeps a
// comic flowing instead of returning "All storyboard engines offline".
const FREE_STORYBOARD_MODELS = [
  'google/gemma-4-31b-it:free',
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen3-next-80b-a3b-instruct:free',
];

// NOTE: suffixes deliberately carry NO motion/pose words (no "speed lines", "dynamic
// cinematic angles", "dramatic heroic poses"). Those terms push FLUX toward foreshortened,
// mid-motion bodies — the single biggest amplifier of hand/limb distortion in comic panels
// (verified before/after on Klein). They stay style+palette only; the framing energy comes
// from the per-panel "visual" instead, where it can be kept anatomy-safe.
const STYLE_TRACKS = {
  anime: {
    prefix: 'Anime comic illustration, flat cel-shading, vibrant dramatic lighting, bold clean ink outlines —',
    suffix: '— vivid saturated colors, clean bold linework, expressive faces'
  },
  marvel: {
    prefix: '90s X-Men animated series, classic comic book shading, sharp ink line art, retro animation —',
    suffix: '— strong black ink outlines, halftone dots, bold graphic composition'
  },
  noir: {
    prefix: 'Gritty black and white comic noir, Sin City aesthetic, stark chiaroscuro shadows —',
    suffix: '— high contrast black and white, deep ink shadows, graphic novel style'
  },
  // Soft "painted" track — semi-realistic anime with RENDERED shading instead of flat ink.
  // Verified to render hands/anatomy markedly cleaner than the flat tracks on the SAME engine
  // and seed: soft shading + mild realism move the panel toward FLUX's stronger (poster-like)
  // regime, and the absence of crisp ink outlines HIDES residual finger errors instead of
  // drawing a sharp line around them. Same no-motion-words rule as the other tracks.
  painted: {
    prefix: 'Semi-realistic anime style, soft rendered shading with natural shadows, atmospheric cinematic lighting, modern digital painting —',
    suffix: '— warm painterly colors, soft detailed rendering'
  }
};

// Opt 2: Static instruction separated from dynamic payload to enable Gemini context caching.
// Opt 1: No prefix/suffix in the visual field — LLM outputs only the core description.
// heroDescriptor is non-null ONLY when the Identity Track is active for this request
// (a user character reference will be injected downstream). When present, Gemini must
// disambiguate WHO the focal hero is in every panel so Grok applies the face to the
// protagonist — never to a secondary character (e.g. a woman) in the same scene.
// When null, no hero block is injected: stories without a character keep their own
// protagonists (any gender), unchanged.
function buildStaticInstruction(lang, maxPanels = 7, heroDescriptor = null) {
  const langNote = lang === 'he'
    ? 'The screenplay is in Hebrew. Write "scene" and "dialogue" fields in Hebrew. The "visual" field MUST always be written in English.'
    : 'Write all fields in English.';

  const panelRange = maxPanels <= 2 ? `exactly ${maxPanels}` : '5-7';

  const heroBlock = heroDescriptor ? `
HERO IDENTITY — READ FIRST (a reference photo of the ${heroDescriptor} will be applied to this comic):
- The protagonist of this story is ${heroDescriptor}. This is the ONLY character whose likeness comes from the uploaded photo.
- In EVERY panel where the protagonist appears, the "visual" MUST name them FIRST and explicitly as "the ${heroDescriptor}" — e.g. "The ${heroDescriptor} stands in the dark hall, medium shot".
- Describe any OTHER people as clearly SEPARATE, distinct secondary characters, mentioned AFTER the protagonist, and never in a way that could be mistaken for them. Example: "The ${heroDescriptor} looks at a woman across the room, while she smiles back at him, medium two-shot".
- If the protagonist is NOT present in a panel, describe the scene normally and do NOT force them in.
- SELECTIVE FRAMING (image budget): set "hero": true ONLY for panels where the ${heroDescriptor} is the visible focal subject. Set "hero": false for panels centered on objects, locations, or secondary characters. Mark AT MOST 3 panels as hero — prioritize the opening, the climax, and the resolution.
` : '';

  return `You are a comic book storyboard artist.

${langNote}

Break down the screenplay into ${panelRange} sequential panels covering the full story arc.

Return ONLY a valid JSON array. No markdown, no backticks, no explanation — just the JSON.

Format:
[{"panel":1,"scene":"INT. LOCATION - DAY","visual":"...","dialogue":"Key line here","hero":true}]
${heroBlock}
Field rules:
- "panel": integer (1 to 7)
- "scene": location and time context, match script language
- "visual": ALWAYS ENGLISH, 20-35 words of clean natural-language prose. Describe, in this order: the ONE main subject, their calm simple expression or relaxed pose, the setting, the shot/angle, and the lighting. No keyword lists, no photography jargon.
  CINEMATIC FRAMING — vary the camera so the comic feels alive, but stay in the image model's comfort zone:
  • DEFAULT to medium shots and bold close-ups: frame people from roughly the waist up so the face reads clearly and hands stay simple and small in frame. This single rule prevents most distortions.
  • Use wide or full-body shots ONLY to establish a location or an object with NO person in it, or with a single small distant figure — never for two people interacting up close.
  • Still pick dramatic, intentional angles — low hero angle, over-the-shoulder, a slight Dutch tilt — but keep the subject large, centred, and close to camera.
  CLEAN-RENDER RULES — these keep the image model from hallucinating; apply every panel:
  • HANDS ARE THE #1 CAUSE OF DISTORTION. Whenever a beat shows a person USING an object (typing, holding a phone, pouring or drinking, writing, gripping or manipulating anything), do NOT show the hands operating it. Reframe the beat as EITHER a close-up of the OBJECT alone (a glowing laptop screen, a steaming coffee cup on the counter, a graph on a wall screen) OR a close-up of the person's FACE reacting, with the hands fully OUT of frame. This is mandatory — never describe a hand doing fine work.
  • ONE clear focal subject, large in frame. At most ONE other person, kept to a calm medium two-shot and clearly SEPARATED in space (across the table, beside, further back) — never three or more people, never overlapping or merged.
  • Convert confrontations and action into a single charged MOMENT rather than mid-motion: a hard stare, a turn of the head, a still standoff — not punching, pointing, throwing, grabbing, or running.
  • Keep the BACKGROUND simple and suggested. Never spell out detailed background crowds; render extra people as a soft blurred suggestion at most.
  • Outside the object/face reframe above, give the subject a relaxed pose with hands AT REST and barely visible — at the side, in a pocket, folded, behind the back, or below the frame edge. Never describe pointing, gesturing, or reaching.
  • Reserve close-ups for the face or a single object — never a close-up centred on hands.
  • One coherent light source, kept clear of the face and head so no prop, lamp, or glow fuses into it.
  • Leave a little headroom above the head and keep the whole subject inside the frame.
  Examples: "A weary detective leans in a doorway, hands in his coat pockets, a dim streetlight glowing behind him, medium shot, moody noir lighting" or "Tight close-up on her determined eyes, rain streaking down, dramatic rim light".
- "dialogue": single most important line or caption, match script language
- "hero": boolean — true only when the main character is the focal subject of the panel (used for image budgeting); when in doubt, false.

Story arc required: opening → development → conflict peak → climax → resolution.`;
}

// Opt 2: systemInstruction carries the cached static block; contents carries only the dynamic screenplay.
// Opt 3: JSON mode + thinking disabled is what makes Gemini reliable here. gemini-2.5-flash is a
// "thinking" model — at a tight token cap it spends the budget on reasoning and returns truncated,
// non-JSON output (finishReason MAX_TOKENS). That was the #1 cause of the storyboard falling all the
// way through to the slow free-tier fallback (~76s). responseMimeType forces a pure JSON array,
// thinkingConfig.thinkingBudget:0 stops the reasoning overrun, and 2000 tokens leaves headroom —
// together they yield a clean first-try parse in ~2-3s (verified).
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
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 2000,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        }
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
  // Final retry: a fresh gemini-2.5-flash-lite attempt. The old 'gemini-flash-latest'
  // alias now resolves to a "thinking" model that emits reasoning prose instead of
  // JSON and overruns the 750-token cap (finishReason MAX_TOKENS), so extractPanels
  // always returned null — it was dead weight (~4s wasted). flash-lite reliably
  // respects both the budget and the JSON-only format for this constrained task.
  return runGeminiModel('gemini-2.5-flash-lite', staticInstruction, script, apiKey, 14000);
}

// Opt 2 (OpenRouter): system role carries static instruction for providers that support prefix caching.
// Opt 3: max_tokens calibrated to 750.
async function tryOpenRouter(staticInstruction, script, apiKey, models = ['google/gemma-3-27b-it', 'google/gemma-3-12b-it', 'deepseek/deepseek-chat']) {
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
    const { script, lang, genre, comicStyle, heroDescriptor: rawHeroDescriptor } = req.body;

    // Hero descriptor is only honoured when the client signals an active Identity Track.
    // Sanitized + length-capped; never trusted as free text into the prompt.
    const heroDescriptor = rawHeroDescriptor
      ? sanitize(String(rawHeroDescriptor), 40) || null
      : null;

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

    const staticInstruction = buildStaticInstruction(lang || 'en', maxPanels, heroDescriptor);
    // Opt 1: track is resolved here so prefix/suffix are injected server-side after parsing,
    // not included in the LLM prompt — saves ~140-175 output tokens per generation.
    const track = STYLE_TRACKS[comicStyle || 'anime'];
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY?.trim();
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
    const openrouterFreeKey = process.env.OPENROUTER_FREE_KEY?.trim();

    let enrichedPanels = null;
    let storyboardEngine = null;

    // Style prefix/suffix are injected here (server-side) rather than in the prompt,
    // so every engine's bare "visual" gets the same FLUX framing.
    const enrich = (panels) => panels.map(p => ({ ...p, visual: `${track.prefix} ${p.visual} ${track.suffix}` }));

    if (geminiKey) {
      const panels = await tryGemini(staticInstruction, cleanScript, geminiKey);
      if (panels) { enrichedPanels = enrich(panels); storyboardEngine = 'Gemini'; }
    }

    if (!enrichedPanels && openrouterKey) {
      const panels = await tryOpenRouter(staticInstruction, cleanScript, openrouterKey);
      if (panels) { enrichedPanels = enrich(panels); storyboardEngine = 'OpenRouter'; }
    }

    // Free last-resort net — only when both paid engines above came up empty.
    if (!enrichedPanels && openrouterFreeKey) {
      const panels = await tryOpenRouter(staticInstruction, cleanScript, openrouterFreeKey, FREE_STORYBOARD_MODELS);
      if (panels) { enrichedPanels = enrich(panels); storyboardEngine = 'OpenRouter (free)'; }
    }

    if (!enrichedPanels) {
      return res.status(500).json({ success: false, code: CODES.STORYBOARD_FAIL, message: 'All storyboard engines offline.' });
    }

    // Selective Framing: enforce the hard hero cap server-side so a model overshoot
    // (or a tampered client) can never push more than MAX_HERO paid identity panels.
    enrichedPanels = applyHeroCap(enrichedPanels);

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

    // ── Global activity counters (all tiers) — powers /api/admin/stats ─────────
    // Outside the quota guard so Pro/admin comics are counted too. One storyboard
    // = one comic (the single consumption point for the whole comic flow).
    try {
      const today = new Date().toISOString().split('T')[0];
      const dayKey = `stats:comic:global:${today}`;
      const pipeline = redis.pipeline();
      pipeline.incr(dayKey);
      pipeline.expireat(dayKey, nextMidnightUTC());
      pipeline.incr('stats:comic:total');
      await pipeline.exec();
    } catch (err) {
      console.warn(`⚠️ Comic stats counter skipped (Redis unavailable): ${err.message}`);
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
