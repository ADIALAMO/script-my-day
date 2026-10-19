import { sanitize } from '../../utils/input-processor';
import redis from '../../lib/redis.js';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, isAdminRequest, extractDevTier, isValidComicSeed } from '../../lib/api-utils.js';
import { paidImageBudgetReached, getOpenProviders, recordFailure, recordSuccess } from '../../lib/circuit-breaker.js';
import { reserveCheckBudget, releaseCheckBudget, checkMaxCalls, checkBudgetUsd } from '../../lib/budget.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { limitFor } from '../../lib/quota.js';
import { reserveComicQuota, releaseComicQuota, unlockedPanelsForNewComic } from '../../lib/comic-quota.js';
import { openComicSession } from '../../lib/comic-guard.js';
import { COMIC } from '../../config/limits.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { checkContent } from '../../lib/content-blocklist.js';
import { CONTENT_SAFETY_RULE, GEMINI_SAFETY_SETTINGS, geminiBlockReason, REGENERATION_SAFETY_LINE } from '../../lib/content-safety.js';
import { checkTextOutput, storyboardText } from '../../lib/text-check.js';
import { parseStoryboard, GEMINI_RESPONSE_SCHEMA, OPENROUTER_RESPONSE_FORMAT } from '../../lib/storyboard-parse.js';
import { ENGINE_DEADLINE_MS, HEDGE_DELAY_MS, ROUTE_HARD_MS, attemptTimeout, raceWithHedge, runUntilDeadline } from '../../lib/storyboard-engines.js';

export const maxDuration = 60;

// The route is killed at 60 s (a killed function never releases the reserved comic quota): the output check and the ONE regeneration stay inside
// this budget, and a regeneration only starts when enough of it is left.
const ROUTE_BUDGET_MS = 57000;
const REGEN_MIN_LEFT_MS = 30000;
const REGEN_DEADLINE_MS = 48000; // the second (safety) engine run ends by then, leaving room for the re-check and the answer

// Comic limit is now tier-aware — see lib/quota.js TIER_LIMITS.

// Parsing (direct / fenced / {panels:[...]} wrapper / prose-wrapped / salvaged-from-truncation) lives in lib/storyboard-parse.js.
// One log line per model attempt: model, finish reason, token counts, panels, how it parsed, elapsed — never the prompt, the output text or a key.
function logAttempt(engine, model, info) {
  console.log(`📊 storyboard ${engine} ${model}: ${JSON.stringify(info)}`);
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
// Stage 5). Only reached when Gemini AND the paid OpenRouter stage both fail — keeps a
// comic flowing instead of returning "All storyboard engines offline". The llama-3.3-70b and
// qwen3-next ":free" slugs that used to be listed here were removed: OpenRouter has no free variant
// of either (HTTP 404 "unavailable for free"; absent from its public models list as of 2026-10-11).
const FREE_STORYBOARD_MODELS = [
  'google/gemma-4-31b-it:free',
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
  // The key stays `marvel` (clients send it); the user-facing name is "Retro Comic" and the prompt names no franchise.
  marvel: {
    prefix: 'Retro 1990s animated superhero style, classic comic book shading, sharp ink line art, retro animation —',
    suffix: '— strong black ink outlines, halftone dots, bold graphic composition'
  },
  noir: {
    prefix: 'Gritty black and white comic noir, high-contrast graphic-novel look, deep chiaroscuro shadows —',
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

${CONTENT_SAFETY_RULE}

Story arc required: opening → development → conflict peak → climax → resolution.`;
}

// DIRECT Google Gemini (the owner's free-tier key, no billing): the LAST fallback only, never the primary engine.
// Opt 2: systemInstruction carries the cached static block; contents carries only the dynamic screenplay.
// Opt 3: JSON mode + responseSchema + thinking disabled is what makes Gemini reliable here. gemini-2.5-flash is a "thinking" model —
// at a tight token cap it spends the budget on reasoning and returns truncated, non-JSON output (finishReason MAX_TOKENS). responseMimeType
// forces JSON, responseSchema fixes the shape (5-7 panels with the five fields), thinkingConfig.thinkingBudget:0 stops the reasoning overrun,
// and 2000 tokens leaves headroom — together a clean first-try parse in ~2-3s.
async function runGeminiModel(model, staticInstruction, script, apiKey, timeoutMs) {
  const t0 = Date.now();
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
          responseSchema: GEMINI_RESPONSE_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
        },
        safetySettings: GEMINI_SAFETY_SETTINGS,
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!resp.ok) { logAttempt('gemini', model, { status: resp.status, ms: Date.now() - t0 }); return null; }
    const data = await resp.json();
    const blocked = geminiBlockReason(data);
    if (blocked) { console.warn(`🛑 Storyboard ${model}: Gemini safety block (${blocked})`); return null; }
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    const parsed = text ? parseStoryboard(text) : null;
    logAttempt('gemini', model, {
      finish: data?.candidates?.[0]?.finishReason ?? null,
      promptTokens: data?.usageMetadata?.promptTokenCount ?? null,
      outputTokens: data?.usageMetadata?.candidatesTokenCount ?? null,
      panels: parsed?.panels.length ?? 0, parsed: parsed?.how ?? 'failed', ms: Date.now() - t0,
    });
    return parsed ? parsed.panels : null;
  } catch (e) {
    clearTimeout(timeoutId);
    logAttempt('gemini', model, { error: e.name === 'AbortError' ? 'timeout' : 'fetch', ms: Date.now() - t0 });
    return null;
  }
}

// OpenRouter chat model. First asks for a strict json_schema ({panels:[...]} wrapper — a strict root must be an object) with
// provider.require_parameters:true, so a provider that cannot honour it is skipped at once instead of rambling for 15 s. If OpenRouter says
// no endpoint supports that (400/404/422) the SAME model is asked once more without the schema inside the same time budget.
// max_tokens 2000 (was 750: a 7-panel answer — more in Hebrew — was cut off mid-array, which no parse strategy could read).
async function runOpenRouterModel(model, staticInstruction, script, apiKey, timeoutMs, { schema = true, provider = null, meta = null, tag = {} } = {}) {
  const t0 = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
        max_tokens: 2000,
        ...(schema || provider ? { provider: { ...(provider || {}), ...(schema ? { require_parameters: true } : {}) } } : {}),
        ...(schema ? { response_format: OPENROUTER_RESPONSE_FORMAT } : {}),
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    if (!resp.ok) {
      logAttempt('openrouter', model, { ...tag, schema, status: resp.status, ms: Date.now() - t0 });
      const left = timeoutMs - (Date.now() - t0);
      if (schema && [400, 404, 422].includes(resp.status) && left >= 3000) {
        return runOpenRouterModel(model, staticInstruction, script, apiKey, left, { schema: false, provider, meta, tag });
      }
      if (meta) { meta.technical = true; meta.status = resp.status; }   // no completion was produced: nothing was billed
      return null;
    }
    const data = await resp.json();
    const text = data?.choices?.[0]?.message?.content;
    const parsed = typeof text === 'string' ? parseStoryboard(text) : null;
    if (meta) { meta.technical = false; meta.status = 200; }
    logAttempt('openrouter', model, {
      ...tag,
      schema,
      finish: data?.choices?.[0]?.finish_reason ?? null,
      promptTokens: data?.usage?.prompt_tokens ?? null,
      outputTokens: data?.usage?.completion_tokens ?? null,
      panels: parsed?.panels.length ?? 0, parsed: parsed?.how ?? 'failed', ms: Date.now() - t0,
    });
    return parsed ? parsed.panels : null;
  } catch (e) {
    clearTimeout(timeoutId);
    if (meta) { meta.technical = false; meta.status = e.name === 'AbortError' ? 408 : null; meta.timedOut = e.name === 'AbortError'; }   // a timeout may still have been billed: the slot stays spent
    logAttempt('openrouter', model, { ...tag, schema, error: e.name === 'AbortError' ? 'timeout' : 'fetch', ms: Date.now() - t0 });
    return null;
  }
}

// ── The PAID first engine: Gemini Flash-Lite THROUGH OpenRouter ───────────────────────────────────────────────────────────────
// Same pattern as the image second opinion (lib/image-check.js): the OpenRouter key, provider.data_collection = "deny", strict json_schema.
// It is metered like the other paid Gemini calls: its OWN daily budget (DAILY_STORYBOARD_BUDGET, key usage:storyboard:paid:global:<day>, default $1.00,
// 0 = off) and its OWN circuit (`storyboard_gemini`) — neither is shared with the output checks, so one running dry or failing never switches
// another off. Budget spent / circuit open / budget unverifiable (Redis down: fail-closed, no paid call without a verified count) -> the engine is
// SKIPPED (not an error): the hedge (gemma-3-27b) starts at once and the fallbacks follow. The direct Google key (free tier, no billing) is only the LAST fallback.
const PRIMARY_MODEL = process.env.STORYBOARD_PRIMARY_MODEL?.trim() || 'google/gemini-2.5-flash-lite';
const PRIMARY_PROVIDER = { data_collection: 'deny' };
const PRIMARY_CIRCUIT = 'storyboard_gemini';

async function runPrimaryPaid(instruction, script, apiKey, timeoutMs) {
  let open = new Set();
  try { open = await getOpenProviders(redis); } catch { /* fail-open on the circuit read only */ }
  if (open.has(PRIMARY_CIRCUIT)) { logAttempt('openrouter', PRIMARY_MODEL, { paid: true, skipped: 'circuit-open' }); return null; }
  let b;
  try { b = await reserveCheckBudget('storyboard'); } catch (e) {
    console.warn(`⚠️ storyboard paid budget unverifiable (${e.message}) — no paid call`);
    logAttempt('openrouter', PRIMARY_MODEL, { paid: true, skipped: 'budget-unverifiable' });
    return null;
  }
  if (!b.ok) { logAttempt('openrouter', PRIMARY_MODEL, { paid: true, skipped: 'budget', usedToday: b.used, maxToday: b.max }); return null; }
  const meta = {};
  const tag = { paid: true, usedToday: b.used, maxToday: b.max, capUsd: checkBudgetUsd('storyboard') };
  const panels = await runOpenRouterModel(PRIMARY_MODEL, instruction, script, apiKey, timeoutMs, { schema: true, provider: PRIMARY_PROVIDER, meta, tag });
  if (panels) { await recordSuccess(redis, PRIMARY_CIRCUIT); return panels; }
  if (meta.technical) {
    await releaseCheckBudget('storyboard');                       // no completion -> nothing billed -> the slot goes back
    await recordFailure(redis, PRIMARY_CIRCUIT, meta.status ?? null);
  } else if (meta.timedOut) {
    await recordFailure(redis, PRIMARY_CIRCUIT, 408);              // slow = a failure for the circuit; the slot stays spent (it may have been billed)
  }
  return null;                                                    // an unparseable answer was billed and is not the circuit's fault
}

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  // ── Rate limiting (sliding window, before quota gate) ─────────────────────
  if (await enforceRateLimit(req, res, 'generate-storyboard')) return;

  let comicReservationKey = null;
  try {
    const { script, lang, genre, comicStyle, heroDescriptor: rawHeroDescriptor, comicSeed: rawComicSeed } = req.body;
    // The comic session needs a valid seed. Older clients never sent one — mint it server-side
    // and hand it back so the browser uses the same value for its panel requests.
    const comicSeed = isValidComicSeed(rawComicSeed)
      ? rawComicSeed
      : `${Date.now()}${Math.floor(Math.random() * 1e9)}`;

    // Hero descriptor is only honoured when the client signals an active Identity Track.
    // Sanitized + length-capped; never trusted as free text into the prompt.
    const heroDescriptor = rawHeroDescriptor
      ? sanitize(String(rawHeroDescriptor), 40) || null
      : null;

    const isAdmin = isAdminRequest(req);
    // Dev-tier preview: admin can pass x-dev-tier: free|pro to simulate a
    // specific tier's unlockedPanels without touching real quota counters.
    const devTier = isAdmin ? extractDevTier(req) : null;

    // Storyboard is the single quota gate for the entire comic flow: it reserves the comic
    // (Free: per month, Pro: per day — config/limits.js) and opens the comic SESSION that the
    // panel route (lib/comic-guard.js) later checks. Panel image calls never touch this counter.
    let tier           = 'admin';
    let identifier     = 'admin';
    let comicLimit     = 0;
    let maxPanels      = 7;   // always generate the full story arc for all tiers
    let unlockedPanels = null; // null → admin default (all panels visible)

    if (!isAdmin) {
      const ctx = await getSessionAndTier(req, res);
      tier           = ctx.tier;
      identifier     = ctx.identifier;
      comicLimit     = limitFor(tier, 'comic');
      maxPanels      = limitFor(tier, 'maxPanels');
      unlockedPanels = limitFor(tier, 'unlockedPanels');

      if (comicLimit === 0) {
        return res.status(403).json({
          success: false,
          code: CODES.NEEDS_ACCOUNT,
          message: 'Sign in to unlock comic generation.',
        });
      }
    }

    // Opt 3: input ceiling tightened to 3000 — eliminates the redundant .slice(0, 3000) that was
    // silently discarding the last 500 chars of a 3500-char sanitized input.
    const cleanScript = sanitize(script || '', 3000);

    if (!cleanScript || cleanScript.length < 20) {
      return res.status(400).json({ success: false, code: CODES.INPUT_TOO_SHORT, message: 'Script text too short.' });
    }

    // Keyword blocklist (lib/content-blocklist.js) — before the comic quota is reserved, so a hit costs nothing.
    // Only the category is logged, never the text.
    const screened = checkContent(`${cleanScript}\n${heroDescriptor || ''}`);
    if (screened.blocked) {
      console.warn(`🛑 generate-storyboard: input blocked by content blocklist (category=${screened.category})`);
      return res.status(400).json({ success: false, code: CODES.CONTENT_BLOCKED });
    }

    // Reserve this comic atomically (INCR then compare) now that the input is valid; given back
    // below if no storyboard can be produced. Redis trouble fails open, like the other quotas.
    if (!isAdmin && comicLimit !== Infinity) {
      try {
        const r = await reserveComicQuota(tier, identifier);
        if (!r.ok) {
          return res.status(429).json({
            success: false,
            code: r.period === 'pro-month' ? CODES.QUOTA_COMIC_PRO_MONTH
                : r.period === 'month'     ? CODES.QUOTA_COMIC_MONTH
                :                            CODES.QUOTA_COMIC,
            limit: r.limit,
            resetsAt: r.resetsAt,
            message: 'Comic quota reached.',
          });
        }
        comicReservationKey = r;
      } catch (e) {
        console.warn(`⚠️ Comic quota reservation skipped (Redis unavailable): ${e.message}`);
      }
    }

    const staticInstruction = buildStaticInstruction(lang || 'en', maxPanels, heroDescriptor);
    // Opt 1: track is resolved here so prefix/suffix are injected server-side after parsing,
    // not included in the LLM prompt — saves ~140-175 output tokens per generation.
    const track = STYLE_TRACKS[comicStyle || 'anime'];
    const geminiKey = process.env.GOOGLE_GEMINI_API_KEY?.trim();
    const openrouterKey = process.env.OPENROUTER_API_KEY?.trim();
    const openrouterFreeKey = process.env.OPENROUTER_FREE_KEY?.trim();

    // Style prefix/suffix are injected here (server-side) rather than in the prompt,
    // so every engine's bare "visual" gets the same FLUX framing.
    const enrich = (panels) => panels.map(p => ({ ...p, visual: `${track.prefix} ${p.visual} ${track.suffix}` }));

    // The engine cascade as a function, because the output check below may run it a SECOND time (with a safety reminder appended).
    // Every attempt gets min(12 s, time left before `deadlineAt`) and nothing starts with < 3 s left, so a failing cascade costs seconds and the route
    // can answer (and release the comic quota) in time. Order:
    //   1. LEADER Gemini Flash-Lite via OpenRouter (data_collection deny, strict json_schema, own budget + circuit — see runPrimaryPaid); the HEDGE
    //      OpenRouter gemma-3-27b joins after 4 s, or AT ONCE when the leader fails or is skipped (budget spent / circuit open);
    //   2. then one after another: gemma-3-12b, deepseek, the free OpenRouter net, and LAST the direct Google key (free tier, no billing):
    //      gemini-2.5-flash, then flash-lite.
    const runEngines = async (instruction, deadlineAt) => {
      const timed = (engine, run) => async () => {
        const t = attemptTimeout(deadlineAt);
        if (!t) return null;
        const panels = await run(t);
        return panels ? { panels, engine } : null;
      };
      // PRIVACY ROUTES (same switch as the scripts: DAILY_SCRIPT_BUDGET > 0 and an OpenRouter key): the screenplay goes only to OpenRouter models with
      // provider.data_collection "deny" — the free OpenRouter net and the direct (free-tier) Google key are not asked at all.
      const privacy = !!openrouterKey && checkBudgetUsd('script') > 0;
      const denyOpts = privacy ? { provider: PRIMARY_PROVIDER } : {};
      const race = [];
      if (openrouterKey) {
        race.push({ run: timed('Gemini Flash-Lite (OpenRouter)', (t) => runPrimaryPaid(instruction, cleanScript, openrouterKey, t)), delayMs: 0 });
        race.push({ run: timed('OpenRouter', (t) => runOpenRouterModel('google/gemma-3-27b-it', instruction, cleanScript, openrouterKey, t, denyOpts)), delayMs: HEDGE_DELAY_MS });
      }
      let won = await raceWithHedge(race);
      if (!won) {
        const fallbacks = [];
        const step = (engine, run) => async (t) => { const panels = await run(t); return panels ? { panels, engine } : null; };
        if (openrouterKey) for (const m of ['google/gemma-3-12b-it', 'deepseek/deepseek-chat']) fallbacks.push(step('OpenRouter', (t) => runOpenRouterModel(m, instruction, cleanScript, openrouterKey, t, denyOpts)));
        if (openrouterFreeKey && !privacy) for (const m of FREE_STORYBOARD_MODELS) fallbacks.push(step('OpenRouter (free)', (t) => runOpenRouterModel(m, instruction, cleanScript, openrouterFreeKey, t)));
        if (geminiKey && !privacy) {
          fallbacks.push(step('Gemini (direct)', (t) => runGeminiModel('gemini-2.5-flash', instruction, cleanScript, geminiKey, t)));
          fallbacks.push(step('Gemini (direct)', (t) => runGeminiModel('gemini-2.5-flash-lite', instruction, cleanScript, geminiKey, t)));
        }
        won = await runUntilDeadline(fallbacks, deadlineAt);
      }
      return won ? { panelsOut: enrich(won.panels), engine: won.engine } : { panelsOut: null, engine: null };
    };

    let { panelsOut: enrichedPanels, engine: storyboardEngine } = await runEngines(staticInstruction, startedAt + ENGINE_DEADLINE_MS);

    if (!enrichedPanels) {
      await releaseComicQuota(comicReservationKey); // nothing was produced → no comic spent
      return res.status(500).json({ success: false, code: CODES.STORYBOARD_FAIL, message: 'All storyboard engines offline.' });
    }

    // ── OUTPUT CHECK (lib/text-check.js) ───────────────────────────────────────────────────────────────────────
    // scene / visual / dialogue of every panel pass the output blocklist; ROMANCE and HORROR also pass the paid classifier (fail-closed).
    // A held-back storyboard gets ONE regeneration with an extra safety line; held back again → CONTENT_REFUSED; classifier required but
    // unavailable → CONTENT_CHECK_UNAVAILABLE. The comic quota is given back in every case.
    const left = () => ROUTE_BUDGET_MS - (Date.now() - startedAt);
    let outCheck = await checkTextOutput(storyboardText(enrichedPanels), { genre, budgetMs: left() });
    if (outCheck.verdict === 'unavailable') {
      await releaseComicQuota(comicReservationKey);
      return res.status(503).json({ success: false, code: CODES.CONTENT_CHECK_UNAVAILABLE, message: 'Safety check unavailable.' });
    }
    if (outCheck.verdict !== 'safe') {
      console.warn(`🛑 generate-storyboard: output held back (${outCheck.stage})`);
      let again = null;
      if (left() >= REGEN_MIN_LEFT_MS) {
        again = (await runEngines(`${staticInstruction}\n\n${REGENERATION_SAFETY_LINE}`, startedAt + REGEN_DEADLINE_MS)).panelsOut;
      }
      const recheck = again ? await checkTextOutput(storyboardText(again), { genre, budgetMs: left() }) : null;
      if (recheck?.verdict === 'unavailable') {
        await releaseComicQuota(comicReservationKey);
        return res.status(503).json({ success: false, code: CODES.CONTENT_CHECK_UNAVAILABLE, message: 'Safety check unavailable.' });
      }
      if (!recheck || recheck.verdict !== 'safe') {
        await releaseComicQuota(comicReservationKey);
        return res.status(422).json({ success: false, code: CODES.CONTENT_REFUSED, message: 'Content refused.' });
      }
      enrichedPanels = again;
    }

    // Selective Framing: enforce the hard hero cap server-side so a model overshoot
    // (or a tampered client) can never push more than MAX_HERO paid identity panels.
    enrichedPanels = applyHeroCap(enrichedPanels);

    // Last line of defence for the 60 s function limit: a function killed by Vercel never releases the reserved comic quota, so if the work
    // ran this long we answer with a clean JSON failure (quota given back) instead of racing the kill.
    if (Date.now() - startedAt > ROUTE_HARD_MS) {
      console.warn(`⏱️ generate-storyboard: ${Date.now() - startedAt} ms — answering with a clean failure before the 60 s limit`);
      await releaseComicQuota(comicReservationKey);
      return res.status(503).json({ success: false, code: CODES.STORYBOARD_FAIL, message: 'Storyboard took too long.' });
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

    // ── Decide this comic's provider mode ONCE, here, instead of letting each of
    // up to 7 panel requests race the same decision independently ─────────────
    // 'klein': OpenRouter Klein is available (not budget-capped, circuit closed)
    //   → every panel tries Klein first, giving the whole comic a consistent,
    //     seed-honored look.
    // 'free': Klein is unavailable right now → every panel skips it ENTIRELY
    //   (not just filtered per-call) so a mid-comic style switch never happens —
    //   the whole comic uses the free cascade instead.
    // 24h TTL (not 30 min) so a later single-panel "Replace" still reads the
    // same decision the rest of the comic was generated under.
    if (isValidComicSeed(comicSeed)) {
      try {
        const [paidImageCapped, openProviders] = await Promise.all([
          paidImageBudgetReached(redis),
          getOpenProviders(redis),
        ]);
        const mode = (!paidImageCapped && !openProviders.has('openrouter')) ? 'klein' : 'free';
        await redis.set(`comic:mode:${comicSeed}`, mode, { ex: 24 * 60 * 60 });
      } catch (err) {
        // Best-effort — a missing mode key just makes generate-poster.js fall
        // back to its existing default cascade, never fails anything here.
        console.warn(`⚠️ Comic mode decision skipped (Redis unavailable): ${err.message}`);
      }
    }

    // Resolve the effective unlock count.
    // devTier lets an admin preview the free/pro experience without affecting real quotas.
    // Free: the user's FIRST comic ever unlocks every panel, later ones fewer (config/limits.js).
    // Computed once per successful comic (lifetime ordinal in Redis), never from the client.
    let effectiveUnlocked = devTier
      ? limitFor(devTier, 'unlockedPanels')
      : unlockedPanels; // null = admin (all panels)
    if (!isAdmin && !devTier && unlockedPanels !== Infinity) {
      effectiveUnlocked = await unlockedPanelsForNewComic(tier, identifier);
    }

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

    // Open the comic SESSION the panel route enforces (owner + this comic's unlocked count +
    // per-panel/replacement counters). Admins are exempt there.
    if (!isAdmin) await openComicSession(comicSeed, identifier, unlockedCount);

    console.log(`🦸‍♂️ Comic Panel generated successfully via: ${storyboardEngine} in ${Date.now() - startedAt} ms (paid first-engine cap ${checkMaxCalls('storyboard')} calls/day = $${checkBudgetUsd('storyboard')})`);
    return res.status(200).json({
      success: true,
      panels: cappedPanels,
      unlockedPanels: unlockedCount,
      comicSeed,                       // the seed the panel requests must carry
      regenLimit: COMIC.regenLimit,    // replacements allowed for this comic (server-enforced)
    });
  } catch (err) {
    await releaseComicQuota(comicReservationKey);
    console.error('generate-storyboard unhandled error:', err.message, err.stack);
    return res.status(500).json({ success: false, code: CODES.SERVER_ERROR, message: 'Internal server error.' });
  }
}
