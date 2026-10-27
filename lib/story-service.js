import { buildScriptPrompt } from "./agent.js";
import { SCRIPT_GEMINI, SCRIPT_CASCADE, SCRIPT_PAID } from "../config/limits.js";
import redis from "./redis.js";
import { getOpenProviders, recordFailure, recordSuccess } from "./circuit-breaker.js";
import { reserveCheckBudget, releaseCheckBudget, checkBudgetUsd } from "./budget.js";
import { loadScriptCircuit } from "./script-circuit.js";
import { alertGemini429, alertCascadeFailed } from "./script-alerts.js";
import { isCreditStatus, creditStatus, readErrorBody, noteCreditFailure } from "./credit-failure.js";
import { GEMINI_SAFETY_SETTINGS, geminiBlockReason, ContentRefusalError } from "./content-safety.js";

// Names only (never values) of the optional keys whose stage is silently skipped when unset. Logged once per instance.
const KEY_ENV_NAMES = { gemini: "GOOGLE_GEMINI_API_KEY", openrouter: "OPENROUTER_API_KEY", openrouterFree: "OPENROUTER_FREE_KEY", cohere: "COHERE_API_KEY" };
const KEY_STAGES = { gemini: "Stage 1 (Gemini)", openrouter: "Stages 2 and 4 (Gemma, DeepSeek)", openrouterFree: "Stage 5 (free models)", cohere: "Stage 3 (Cohere)" };
let warnedMissingKeys = false;
function warnMissingKeysOnce(keys) {
  if (warnedMissingKeys) return;
  warnedMissingKeys = true;
  const missing = Object.keys(KEY_ENV_NAMES).filter((k) => !keys[k]);
  if (missing.length) console.warn(`⚠️ Script cascade: ${missing.map((k) => `${KEY_ENV_NAMES[k]} not set → ${KEY_STAGES[k]} skipped`).join("; ")}`);
}

// Every model id the cascade can call — the circuit breaker is loaded for all of them with ONE capped MGET.
const GEMINI_QUALITY = ["gemini-2.5-flash", "gemini-3-flash-preview"];
const GEMINI_FAST = ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite", "gemini-flash-latest"];
const GEMMA_MODELS = ["google/gemma-3-27b-it", "google/gemma-3-12b-it"];
const COHERE_MODEL = "command-r-plus-08-2024";
const DEEPSEEK_MODEL = "deepseek/deepseek-chat";
// llama-3.3-70b-instruct:free and qwen3-next-80b-a3b-instruct:free were removed: OpenRouter's public models list (checked
// 2026-10-11) has no free variant of either (only paid slugs), so they always answered 404.
const FREE_MODELS = [
  "google/gemma-4-31b-it:free"
];
const ALL_SCRIPT_MODELS = [...GEMINI_QUALITY, ...GEMINI_FAST, ...GEMMA_MODELS, COHERE_MODEL, DEEPSEEK_MODEL, ...FREE_MODELS];

async function fetchWithTimeout(url, options, timeout = 40000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return response;
  } catch (e) {
    clearTimeout(id);
    throw e;
  }
}

// Combines two AbortSignals into one that fires when either fires.
// Used instead of AbortSignal.any() to support Node 18 (Vercel minimum).
function combineSignals(sig1, sig2) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (sig1.aborted || sig2.aborted) { controller.abort(); return controller.signal; }
  sig1.addEventListener('abort', abort, { once: true });
  sig2.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

// Final-pass language guard. Models occasionally close a Hebrew script with the
// English final beat ("THE END") instead of "סוף" — observed in ~1/3 of flash-lite
// Hebrew runs. Swap it for the Hebrew beat WITHOUT touching the trailing
// [image: …] line, which is intentionally English. No-op for English scripts.
function enforceLanguagePurity(output, lang) {
  if (lang !== "he" || !output) return output;
  return output
    .replace(/\*\*\s*THE\s+END\s*\*\*/gi, "**סוף**")
    .replace(/(^|\n)[ \t]*THE\s+END[ \t]*(?=\r?\n|$)/gi, "$1סוף");
}

// Sleep that ends early (without keeping a timer alive) when the signal aborts.
function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (ms <= 0 || signal.aborted) return resolve();
    const done = () => { clearTimeout(t); signal.removeEventListener("abort", done); resolve(); };
    const t = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

// Runs several Gemini models for one tier and resolves with the first one that returns a language-correct
// script; the winner aborts the rest. Rejects if all fail.
// Extracted so Stage 1 can run it as TIERS: a quality tier first (generous timeout so the stronger, slower flash
// models can actually land) and a fast "lite" tier only as a fallback.
//
// COST: with staggerMs = 0 every model starts at once (the old RACE: N paid calls per script). With staggerMs > 0
// (config SCRIPT_GEMINI, default) model i+1 is started only when model i has not answered within staggerMs or has
// already failed ("hedging"), so a normal script costs ONE call. The loser of a hedge is aborted via AbortController;
// that stops OUR side of the request, whether the provider stops billing is not documented.
async function raceGeminiModels(modelNames, perModelTimeout, googleContents, geminiKey, lang, { staggerMs = 0, budgetMs = Infinity, minStartBudgetMs = 0, onFailure, onSuccess } = {}) {
  const raceController = new AbortController();
  const t0 = performance.now();
  const attempts = [];

  const abortError = () => { const e = new Error("aborted"); e.name = "AbortError"; return e; };

  modelNames.forEach((modelName, index) => {
    const attempt = (async () => {
      let timeoutMs = perModelTimeout;
      if (index > 0 && staggerMs > 0) {
        // wait for the cumulative delay of this slot, OR until every earlier model has already failed
        const due = index * staggerMs - (performance.now() - t0);
        await Promise.race([abortableSleep(due, raceController.signal), Promise.allSettled(attempts.slice(0, index))]);
        if (raceController.signal.aborted) throw abortError();      // somebody already won → never start (no cost)
        const left = budgetMs - (performance.now() - t0);
        if (left < minStartBudgetMs) throw new Error(`${modelName} not started: ${Math.round(left)}ms left in the tier budget`);
        timeoutMs = Math.min(perModelTimeout, left);
        console.log(`🪁 Gemini hedge: starting ${modelName} after ${Math.round(performance.now() - t0)}ms`);
      }

      const timeoutController = new AbortController();
      const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs);
      // Fires on the per-model timeout OR when another model wins the race.
      const signal = combineSignals(timeoutController.signal, raceController.signal);

      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

        const resp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: googleContents,
            generationConfig: { temperature: 0.7, maxOutputTokens: 4000 },
            safetySettings: GEMINI_SAFETY_SETTINGS
          }),
          signal
        });

        clearTimeout(timeoutId);
        if (!resp.ok) {
          // Error shape stays "<model> HTTP <status>". For a 429 also keep the (bounded) body so the circuit breaker can
          // tell a per-minute limit from a per-day quota. The body is only read here, never logged.
          const err = new Error(`${modelName} HTTP ${resp.status}`);
          err.status = resp.status;
          if (resp.status === 429) err.bodyText = await resp.text().then((t) => t.slice(0, 2000)).catch(() => "");
          throw err;
        }

        const data = await resp.json();
        // A Gemini SAFETY / PROHIBITED_CONTENT block is a refusal, not a technical failure: it must not fall through to
        // the unfiltered Gemma / Cohere / DeepSeek stages (see the check around the tier loop).
        const blocked = geminiBlockReason(data);
        if (blocked) throw new ContentRefusalError(`${modelName} blocked the content (${blocked})`);
        const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!candidateText) throw new Error(`${modelName} empty response`);
        // Reject obviously-truncated responses (Gemini occasionally cuts a stream
        // under load). A valid 5-8 scene script is always well over this floor, so
        // rejecting lets the race/cascade fall through to another model instead of
        // returning a half-sentence stub — the old slice(0,200) language check
        // happily passed a 287-char fragment.
        if (candidateText.trim().length < 500) throw new Error(`${modelName} truncated (${candidateText.trim().length} chars)`);
        const preview = candidateText.slice(0, 200);
        const hebrewCharCount = (preview.match(/[֐-׿]/g) || []).length;
        if (lang === "he" && hebrewCharCount < 5) throw new Error(`${modelName} language mismatch`);
        if (lang === "en" && hebrewCharCount > 15) throw new Error(`${modelName} language mismatch`);

        raceController.abort();
        onSuccess?.(modelName);
        return { output: candidateText, model: modelName };
      } catch (e) {
        clearTimeout(timeoutId);
        if (e.name !== 'AbortError') console.warn(`⚠️ Gemini/${modelName}: ${e.message}`);
        if (e.status) onFailure?.(modelName, e);
        throw e;
      }
    })();
    attempts.push(attempt);
  });

  return Promise.any(attempts);
}

/**
 * @param {{ extraSafety?: string, budgetMs?: number }} [opts]  extraSafety: appended safety reminder (the one regeneration after a held-back output);
 *                                                                budgetMs: caps the whole cascade (so a regeneration stays inside the route's 60 s)
 */
export async function generateScript(userText, genre, gender = 'neutral', opts = {}) {
  // The deadline clock starts here, BEFORE the (capped, ≤500 ms) circuit-state read, so a slow Redis cannot push the
  // cascade past the budget. Circuit writes and alerts are settled in `finally` (each bounded, never throwing).
  const startedAt = performance.now();
  const circ = await loadScriptCircuit(ALL_SCRIPT_MODELS);
  const side = []; // pending alert promises (alertOnce is bounded to ~1.5 s and never throws)
  try {
    const result = await runCascade(userText, genre, gender, { startedAt, circ, side, extraSafety: opts.extraSafety || '', protagonistName: opts.protagonistName || '', budgetMs: opts.budgetMs ?? SCRIPT_GEMINI.totalBudgetMs });
    if (!result.success && !result.refused) {   // a content refusal is not an outage
      // A 402 means the OpenRouter credit ran out: that gets its own (counted, deduped) credit alert instead of the generic one. The paid engine's own 402 was already
      // counted and announced by the circuit breaker (recordFailure) — only a 402 seen by a later stage alone is counted here.
      if (result.credit) { if (result.trace?.paid !== 'failed:402') side.push(noteCreditFailure('script')); }
      else side.push(alertCascadeFailed());
    }
    return result;
  } finally {
    await Promise.allSettled([circ.flush(), ...side]);
  }
}

const PAID_CIRCUIT = 'script_paid';

/**
 * Stage 0: paid Gemini 2.5 Flash through OpenRouter with provider.data_collection = "deny". Same pattern as the storyboard's paid engine:
 * its own daily USD budget (DAILY_SCRIPT_BUDGET, key usage:script:paid:global:<day>) and its own circuit (`script_paid`). Budget spent / circuit open /
 * budget unverifiable (Redis down: no paid call without a verified count) = SKIPPED, never an error; the caller falls through to the deny-only fallbacks.
 * Returns { output } on success, { refused:true } on a content refusal, {} otherwise. `trace` records what happened (stats only: no text, no keys).
 */
async function runPaidScript({ messages, apiKey, timeoutMs, hasTime, trace }) {
  let open = new Set();
  try { open = await getOpenProviders(redis); } catch { /* the circuit read fails open */ }
  if (open.has(PAID_CIRCUIT)) { trace.paid = 'skipped:circuit'; return {}; }
  if (!hasTime()) { trace.paid = 'skipped:time'; return {}; }
  let b;
  try { b = await reserveCheckBudget('script'); } catch (e) { console.warn(`⚠️ script paid budget unverifiable (${e.message}) — no paid call`); trace.paid = 'skipped:unverifiable'; return {}; }
  if (!b.ok) { trace.paid = 'skipped:budget'; return {}; }
  console.log(`💳 paid script engine: ${b.used}/${b.max} today (cap $${checkBudgetUsd('script')})`);
  let status = null;
  try {
    const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}`, "HTTP-Referer": "https://lifescript.app", "X-Title": "LifeScript Studio" },
      body: JSON.stringify({ model: SCRIPT_PAID.model, messages, temperature: 0.8, max_tokens: SCRIPT_PAID.maxTokens, provider: { data_collection: "deny" } }),
    }, timeoutMs());
    status = resp.status;
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) status = creditStatus(status, data);   // a key-limit 403 is a credit failure (402)
    const choice = data?.choices?.[0];
    const out = choice?.message?.content;
    if (resp.ok && out) {
      await recordSuccess(redis, PAID_CIRCUIT);
      trace.paid = 'served';
      trace.tokens = { in: Number(data?.usage?.prompt_tokens) || 0, out: Number(data?.usage?.completion_tokens) || 0 };
      return { output: out };
    }
    const finishReason = `${choice?.finish_reason || ''} ${choice?.native_finish_reason || ''}`;
    if (resp.ok && /content_filter|SAFETY|PROHIBITED|BLOCKLIST/i.test(finishReason)) { trace.paid = 'refused'; return { refused: true };  }   // billed, no circuit failure
    if (resp.ok) { trace.paid = 'empty'; return {}; }                                                                                         // billed, unusable: slot stays spent
    await releaseCheckBudget('script');                                                                                                       // not billed
    await recordFailure(redis, PAID_CIRCUIT, status);
    if (isCreditStatus(status)) trace.credit = true;
    trace.paid = `failed:${status}`;
  } catch (e) {
    if (e?.name === 'AbortError') { await recordFailure(redis, PAID_CIRCUIT, 408); trace.paid = 'failed:timeout'; }   // may have been billed: the slot stays spent
    else { await releaseCheckBudget('script'); trace.paid = 'failed:network'; }
  }
  return {};
}

async function runCascade(userText, genre, gender, { startedAt, circ, side, extraSafety = '', protagonistName = '', budgetMs = SCRIPT_GEMINI.totalBudgetMs }) {
  const { messages, lang } = buildScriptPrompt(userText, genre, 'medium', gender, extraSafety, protagonistName);

  // The route is killed at maxDuration (60 s) and a killed function never releases the reserved quota slot, so the
  // whole cascade runs against SCRIPT_GEMINI.totalBudgetMs: stages that cannot finish are skipped, timeouts are cut.
  // `reserve` = time that must stay available for later stages (Stage 1 → Stages 2–5; Stages 2–4 → Stage 5).
  const timeLeft = () => budgetMs - (performance.now() - startedAt);
  const MIN_CALL_MS = 4000; // a call with less time left than this cannot return a script
  const capTimeout = (ms, reserve = 0) => Math.min(ms, Math.floor(timeLeft() - reserve));
  const hasTime = (stage, reserve = 0) => {
    if (timeLeft() - reserve >= MIN_CALL_MS) return true;
    console.warn(`⏱️ Skipping ${stage}: ${Math.round(timeLeft() - reserve)}ms left of the ${budgetMs}ms script budget${reserve ? ` (after the ${reserve}ms kept for later stages)` : ""}`);
    return false;
  };

  // Every success path funnels through here so the language guard runs once,
  // regardless of which stage produced the script.
  // `stage` is the label counted in stats:script:stage:<day> (see pages/api/generate-script.js); `trace` says what the paid engine did.
  const trace = { paid: 'off', tokens: null };
  const finish = (output, model, stage) => ({
    success: true,
    output: enforceLanguagePurity(output, lang),
    model,
    stage,
    trace,
  });

  const keys = {
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
    openrouterFree: process.env.OPENROUTER_FREE_KEY?.trim(),
    cohere: process.env.COHERE_API_KEY?.trim(),
    gemini: process.env.GOOGLE_GEMINI_API_KEY?.trim()
  };
  warnMissingKeysOnce(keys);

  // Circuit breaker (lib/script-circuit.js): a 429 pauses that one model for following requests. Only Gemini escalates
  // (2nd consecutive 429 → longer pause) and alerts; the OpenRouter/Cohere 429s get the flat short pause.
  const noteFailure = (model, status, { bodyText, gemini = false } = {}) => {
    if (status !== 429) return;
    const r = circ.recordFailure(model, { status, bodyText, escalate: gemini });
    if (r.opened && gemini) side.push(alertGemini429(model, r.kind));
  };
  const skipPaused = (model) => {
    if (!circ.isOpen(model)) return false;
    console.log(`⏭️ ${model} skipped: paused after a recent HTTP 429`);
    return true;
  };

  // Time kept back for the later stages (see config/limits.js: SCRIPT_GEMINI.stage1ReserveMs / SCRIPT_CASCADE).
  const hasLaterStages = !!(keys.openrouter || keys.cohere || keys.openrouterFree);
  const stage1Reserve = hasLaterStages ? SCRIPT_GEMINI.stage1ReserveMs : 0;
  const stage5Reserve = keys.openrouterFree && checkBudgetUsd('script') <= 0 && FREE_MODELS.some((m) => !circ.isOpen(m)) ? SCRIPT_CASCADE.lastResortReserveMs : 0;

  // PRIVACY ROUTES (DAILY_SCRIPT_BUDGET > 0, the default): the journal text goes ONLY to OpenRouter models with provider.data_collection = "deny"
  // (paid Gemini 2.5 Flash first, then Gemma / DeepSeek, which the live probe showed accept "deny"). The free Google key (Stage 1), Cohere and the free
  // models (Stage 5) are not asked at all — also once the day's paid budget is spent or its circuit is open. DAILY_SCRIPT_BUDGET=0, or no OpenRouter key,
  // restores the old cascade unchanged.
  const privacy = !!keys.openrouter && checkBudgetUsd('script') > 0;
  const DENY = privacy ? { provider: { data_collection: "deny" } } : {};

  // --- STAGE 0: PAID GEMINI 2.5 FLASH THROUGH OPENROUTER (data_collection deny) ---
  if (privacy) {
    const paid = await runPaidScript({ messages, apiKey: keys.openrouter, timeoutMs: () => capTimeout(SCRIPT_PAID.timeoutMs, SCRIPT_PAID.fallbackReserveMs), hasTime: () => hasTime('Paid script', SCRIPT_PAID.fallbackReserveMs), trace });
    if (paid.refused) {
      console.warn('🛑 The paid engine refused the content — ending the script request, no fallback to the other stages');
      return { success: false, refused: true, error: 'content refused', trace };
    }
    if (paid.output) return finish(paid.output, `Paid Gemini (${SCRIPT_PAID.model})`, 'paid-gemini');
  }

  // --- STAGE 1: GOOGLE GEMINI (quality-first TIERED race) ---
  // The old design raced all six models with Promise.any, so the FASTEST model won —
  // which in practice meant the smallest/weakest "flash-lite" served nearly every
  // request (~4s), while the stronger flash models (~21-26s, but measured ~2x richer
  // output and zero language leaks) were aborted before they could finish. We now run
  // tiers: quality models get a real chance first (generous timeout), and only if they
  // are slow/unavailable do we fall back to the fast "lite" models. pro-preview is
  // dropped from the hot path (persistent 429 on the current key/quota).
  if (keys.gemini && !privacy) {
    const googleContents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const geminiHooks = {
      onFailure: (model, e) => noteFailure(model, e.status, { bodyText: e.bodyText, gemini: true }),
      onSuccess: (model) => circ.recordSuccess(model),
    };

    const GEMINI_TIERS = [
      // Quality tier: 32s/model leaves room for the 21-26s responses to land,
      // while still fitting two tiers + later stages inside the ~60s budget.
      { label: "quality", perModelTimeout: 32000, models: GEMINI_QUALITY,
        hedge: { staggerMs: SCRIPT_GEMINI.mode === "race" ? 0 : SCRIPT_GEMINI.qualityHedgeMs, budgetMs: SCRIPT_GEMINI.qualityBudgetMs, minStartBudgetMs: SCRIPT_GEMINI.minStartBudgetMs } },
      // Fast tier: short timeout, reached only when the quality tier yields nothing.
      { label: "fast",    perModelTimeout: 12000, models: GEMINI_FAST,
        hedge: { staggerMs: SCRIPT_GEMINI.mode === "race" ? 0 : SCRIPT_GEMINI.fastHedgeMs } },
    ];

    for (const tier of GEMINI_TIERS) {
      // Models paused by the circuit breaker are left out (order of the rest is unchanged); a fully paused tier is skipped.
      const models = tier.models.filter((m) => !skipPaused(m));
      if (!models.length) continue;
      if (!hasTime(`Gemini ${tier.label} tier`, stage1Reserve)) break;
      try {
        const budgetMs = Math.min(tier.hedge.budgetMs ?? Infinity, timeLeft() - stage1Reserve);
        const winner = await raceGeminiModels(models, capTimeout(tier.perModelTimeout, stage1Reserve), googleContents, keys.gemini, lang, { ...tier.hedge, budgetMs, ...geminiHooks });
        return finish(winner.output, `Gemini (${winner.model})`, `gemini-${tier.label}`);
      } catch (e) {
        // Promise.any rejects with an AggregateError once EVERY model of the tier failed. If any of them was a content
        // refusal, the request ends here — the other stages have no safety filter and must not get to answer it.
        if (e?.errors?.some((x) => x?.contentRefusal)) {
          console.warn('🛑 Gemini refused the content — ending the script request, no fallback to the other stages');
          return { success: false, refused: true, error: 'content refused' };
        }
        console.warn(`⚠️ Stage 1 Gemini ${tier.label} tier exhausted — ${tier.label === "quality" ? "trying fast tier" : "trying Stage 2"}`);
      }
    }
  }

  // --- STAGE 2: THE GEMMA 3 BREAKTHROUGH ---
  if (keys.openrouter && hasTime('Stage 2 (Gemma)', stage5Reserve)) {
    // gemma-3-4b-it removed (2026-06-10 benchmark): it was the slowest backup (~38s)
    // AND malformed — duplicate scene headings and a "הסרט:" title prefix. 27b/12b
    // both produce clean Hebrew, so dropping 4b improves both speed and quality here.
    const gemmaTimeouts = { "google/gemma-3-27b-it": SCRIPT_CASCADE.gemma27bMs, "google/gemma-3-12b-it": SCRIPT_CASCADE.gemma12bMs };

    for (const modelId of GEMMA_MODELS) {
        if (skipPaused(modelId)) continue;
        if (!hasTime(`Gemma ${modelId}`, stage5Reserve)) break;
        // Single attempt per model. A 429 moves straight on to the next model (the old fixed 1.5 s sleep after a 429 was
        // dead time: there was no retry for it to wait for).
        try {
            const cleanMessages = messages.map(m => ({
                role: m.role === "system" ? "user" : m.role,
                content: m.role === "system" ? `[INSTRUCTION]: ${m.content}` : m.content
            }));

            const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${keys.openrouter}`,
                    "HTTP-Referer": "https://lifescript.app",
                    "X-Title": "LifeScript Studio",
                    "OR-Identify": "true"
                },
                body: JSON.stringify({
                    model: modelId,
                    messages: cleanMessages,
                    temperature: 0.8,
                    max_tokens: 2500,
                    ...DENY
                })
            }, capTimeout(gemmaTimeouts[modelId], stage5Reserve));

            if (resp.ok) {
                const data = await resp.json();
                const out = data?.choices?.[0]?.message?.content;
                if (out) { circ.recordSuccess(modelId); return finish(out, modelId, "gemma"); }
            } else {
                const err = await resp.json().catch(() => ({}));
                if (isCreditStatus(creditStatus(resp.status, err))) trace.credit = true;
                noteFailure(modelId, resp.status);
                if (resp.status === 429) console.warn(`⚠️ ${modelId} rate-limited — trying next model`);
                else if (creditStatus(resp.status, err) !== resp.status) console.warn(`⚠️ ${modelId} failed (${resp.status}): (key limit)`);   // fixed text: the provider message names the key's management URL
                else console.warn(`⚠️ ${modelId} failed (${resp.status}): ${err.error?.message}`);
            }
        } catch (e) {
            console.warn(`⚠️ Stage 2 (${modelId}) connection error: ${e.message}`);
        }
    }
  }

  // --- STAGE 3: COHERE (Professional Backup) ---
  if (keys.cohere && !privacy && !skipPaused(COHERE_MODEL) && hasTime('Stage 3 (Cohere)', stage5Reserve)) {
    try {
        const resp = await fetchWithTimeout("https://api.cohere.ai/v1/chat", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${keys.cohere}`,
                "Content-Type": "application/json",
                "Request-Source": "LifeScript-Studio"
            },
            body: JSON.stringify({
                model: COHERE_MODEL,
                message: messages[messages.length - 1].content,
                chat_history: messages.slice(0, -1).map(m => ({
                    role: m.role === "assistant" ? "CHATBOT" : "USER",
                    message: m.content
                })),
                preamble: lang === 'he'
                  ? "You are a professional screenwriter. Return ONLY the screenplay text in Hebrew. No intro, no chat."
                  : "You are a professional screenwriter. Return ONLY the screenplay text in English. No intro, no chat."
            })
        }, capTimeout(SCRIPT_CASCADE.cohereMs, stage5Reserve));

        if (resp.ok) {
            const data = await resp.json();
            const out = data.text;
            if (out) { circ.recordSuccess(COHERE_MODEL); return finish(out, "Cohere Command R+", "cohere"); }
        } else {
            const errData = await resp.json().catch(() => ({}));
            noteFailure(COHERE_MODEL, resp.status);
            console.warn(`⚠️ Stage 3 (Cohere) failed (${resp.status}): ${errData.message || "unknown error"}`);
        }
    } catch (e) {
        console.warn(`⚠️ Stage 3 (Cohere) error: ${e.message}`);
    }
  }

  // --- STAGE 4: DEEPSEEK V3 ---
  if (keys.openrouter && !skipPaused(DEEPSEEK_MODEL) && hasTime('Stage 4 (DeepSeek)', stage5Reserve)) {
    try {
      const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${keys.openrouter}`,
          "X-Title": "LifeScript Studio",
          "HTTP-Referer": "https://lifescript.app"
        },
        body: JSON.stringify({
          model: DEEPSEEK_MODEL,
          messages: messages,
          temperature: 0.9,
          max_tokens: 3000,
          ...DENY
        })
      }, capTimeout(SCRIPT_CASCADE.deepseekMs, stage5Reserve));

      if (resp.ok) {
        const data = await resp.json();
        const out = data?.choices?.[0]?.message?.content;
        if (out) { circ.recordSuccess(DEEPSEEK_MODEL); return finish(out, "DeepSeek (Turbo)", "deepseek"); }
      } else {
        if (isCreditStatus(resp.status === 403 ? creditStatus(403, await readErrorBody(resp)) : resp.status)) trace.credit = true;
        noteFailure(DEEPSEEK_MODEL, resp.status);
        console.warn(`⚠️ Stage 4 (DeepSeek) failed (${resp.status})`);
      }
    } catch (e) {
      console.warn(`⚠️ Stage 4 (DeepSeek) failed: ${e.message}`);
    }
  }

  // --- STAGE 5: FREE OPENROUTER FALLBACK (last resort) ---
  if (keys.openrouterFree && !privacy && hasTime('Stage 5 (free models)')) {
    // The previous trio (gemma-3-4b, llama-3.1-8b, deepseek-r1 :free) was DELISTED —
    // all returned 404 "unavailable for free". gemma-4-31b is the one free model that exists and is capable: it produced
    // clean Hebrew (proper סצנה headings, "סוף", English [image:] line) in ~1s — near the paid quality tier.
    // (gpt-oss-120b:free was rejected — it writes English "SCENE" headings in Hebrew.) The llama/qwen ":free" slugs that
    // later replaced the trio do not exist either (see FREE_MODELS). It is a single model on a shared free pool, so it can
    // 429 under load; the loop is kept so a replacement can be added without touching the control flow.
    for (const modelId of FREE_MODELS) {
      if (skipPaused(modelId)) continue;
      if (!hasTime(`free model ${modelId}`)) break;
      try {
        const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${keys.openrouterFree}`,
            "HTTP-Referer": "https://lifescript.app",
            "X-Title": "LifeScript Studio"
          },
          body: JSON.stringify({
            model: modelId,
            messages,
            temperature: 0.8,
            max_tokens: 2500
          })
        }, capTimeout(SCRIPT_CASCADE.freeMs));

        if (resp.ok) {
          const data = await resp.json();
          const out = data?.choices?.[0]?.message?.content;
          if (out) { circ.recordSuccess(modelId); return finish(out, `Free fallback (${modelId})`, "free-model"); }
        } else {
          noteFailure(modelId, resp.status);
          console.warn(`⚠️ Stage 5 (${modelId}) failed (${resp.status})`);
        }
      } catch (e) {
        console.warn(`⚠️ Stage 5 (${modelId}) failed: ${e.message}`);
      }
    }
  }

  return { success: false, error: "Production Halted: All AI servers offline.", trace, ...(trace.credit ? { credit: true } : {}) };
}
