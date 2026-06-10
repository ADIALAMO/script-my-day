import { buildScriptPrompt } from "./agent.js";

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

// Races several Gemini models in parallel; resolves with the first one that returns
// a language-correct script, and the winner aborts the rest. Rejects if all fail.
// Extracted so Stage 1 can run it as TIERS: a quality tier first (generous timeout
// so the stronger, slower flash models can actually land) and a fast "lite" tier
// only as a fallback — instead of one flat race where the fastest (= weakest) model
// always won.
async function raceGeminiModels(modelNames, perModelTimeout, googleContents, geminiKey, lang) {
  const raceController = new AbortController();

  const racePromises = modelNames.map(async (modelName) => {
    const timeoutController = new AbortController();
    const timeoutId = setTimeout(() => timeoutController.abort(), perModelTimeout);
    // Fires on the per-model timeout OR when another model wins the race.
    const signal = combineSignals(timeoutController.signal, raceController.signal);

    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${geminiKey}`;

      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: googleContents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 4000 }
        }),
        signal
      });

      clearTimeout(timeoutId);
      if (!resp.ok) throw new Error(`${modelName} HTTP ${resp.status}`);

      const data = await resp.json();
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
      return { output: candidateText, model: modelName };
    } catch (e) {
      clearTimeout(timeoutId);
      if (e.name !== 'AbortError') console.warn(`⚠️ Gemini/${modelName}: ${e.message}`);
      throw e;
    }
  });

  return Promise.any(racePromises);
}

export async function generateScript(userText, genre, gender = 'neutral') {
  const { messages, lang } = buildScriptPrompt(userText, genre, 'medium', gender);

  // Every success path funnels through here so the language guard runs once,
  // regardless of which stage produced the script.
  const finish = (output, model) => ({
    success: true,
    output: enforceLanguagePurity(output, lang),
    model,
  });

  const keys = {
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
    openrouterFree: process.env.OPENROUTER_FREE_KEY?.trim(),
    cohere: process.env.COHERE_API_KEY?.trim(),
    gemini: process.env.GOOGLE_GEMINI_API_KEY?.trim()
  };

  // --- STAGE 1: GOOGLE GEMINI (quality-first TIERED race) ---
  // The old design raced all six models with Promise.any, so the FASTEST model won —
  // which in practice meant the smallest/weakest "flash-lite" served nearly every
  // request (~4s), while the stronger flash models (~21-26s, but measured ~2x richer
  // output and zero language leaks) were aborted before they could finish. We now run
  // tiers: quality models get a real chance first (generous timeout), and only if they
  // are slow/unavailable do we fall back to the fast "lite" models. pro-preview is
  // dropped from the hot path (persistent 429 on the current key/quota).
  if (keys.gemini) {
    const googleContents = messages.map(m => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }]
    }));

    const GEMINI_TIERS = [
      // Quality tier: 32s/model leaves room for the 21-26s responses to land,
      // while still fitting two tiers + later stages inside the ~60s budget.
      { label: "quality", perModelTimeout: 32000, models: ["gemini-2.5-flash", "gemini-3-flash-preview"] },
      // Fast tier: short timeout, reached only when the quality tier yields nothing.
      { label: "fast",    perModelTimeout: 12000, models: ["gemini-3.1-flash-lite-preview", "gemini-2.5-flash-lite", "gemini-flash-latest"] },
    ];

    for (const tier of GEMINI_TIERS) {
      try {
        const winner = await raceGeminiModels(tier.models, tier.perModelTimeout, googleContents, keys.gemini, lang);
        return finish(winner.output, `Gemini (${winner.model})`);
      } catch (e) {
        console.warn(`⚠️ Stage 1 Gemini ${tier.label} tier exhausted — ${tier.label === "quality" ? "trying fast tier" : "trying Stage 2"}`);
      }
    }
  }

  // --- STAGE 2: THE GEMMA 3 BREAKTHROUGH ---
  if (keys.openrouter) {
    const gemmaModels = [
        "google/gemma-3-27b-it",
        "google/gemma-3-12b-it",
        "google/gemma-3-4b-it"
    ];

    for (const modelId of gemmaModels) {
        // Single attempt per model (was 2) to keep Stage 2 worst-case ≤ 3×10s = 30s.
        for (let attempt = 1; attempt <= 1; attempt++) {
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
                        max_tokens: 2500
                    })
                }, 10000);

                if (resp.ok) {
                    const data = await resp.json();
                    const out = data?.choices?.[0]?.message?.content;
                    if (out) return finish(out, modelId);
                } else {
                    const err = await resp.json().catch(() => ({}));
                    if (resp.status === 429) {
                        console.warn(`⚠️ ${modelId} rate-limited — trying next model`);
                        await new Promise(r => setTimeout(r, 1500));
                    } else {
                        console.warn(`⚠️ ${modelId} failed (${resp.status}): ${err.error?.message}`);
                        break;
                    }
                }
            } catch (e) {
                console.warn(`⚠️ Stage 2 (${modelId}) connection error: ${e.message}`);
            }
        }
    }
  }

  // --- STAGE 3: COHERE (Professional Backup) ---
  if (keys.cohere) {
    try {
        const resp = await fetchWithTimeout("https://api.cohere.ai/v1/chat", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${keys.cohere}`,
                "Content-Type": "application/json",
                "Request-Source": "LifeScript-Studio"
            },
            body: JSON.stringify({
                model: "command-r-plus-08-2024",
                message: messages[messages.length - 1].content,
                chat_history: messages.slice(0, -1).map(m => ({
                    role: m.role === "assistant" ? "CHATBOT" : "USER",
                    message: m.content
                })),
                preamble: lang === 'he'
                  ? "You are a professional screenwriter. Return ONLY the screenplay text in Hebrew. No intro, no chat."
                  : "You are a professional screenwriter. Return ONLY the screenplay text in English. No intro, no chat."
            })
        }, 8000);

        if (resp.ok) {
            const data = await resp.json();
            const out = data.text;
            if (out) return finish(out, "Cohere Command R+");
        } else {
            const errData = await resp.json().catch(() => ({}));
            console.warn(`⚠️ Stage 3 (Cohere) failed (${resp.status}): ${errData.message || "unknown error"}`);
        }
    } catch (e) {
        console.warn(`⚠️ Stage 3 (Cohere) error: ${e.message}`);
    }
  }

  // --- STAGE 4: DEEPSEEK V3 ---
  if (keys.openrouter) {
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
          model: "deepseek/deepseek-chat",
          messages: messages,
          temperature: 0.9,
          max_tokens: 3000
        })
      }, 8000);

      if (resp.ok) {
        const data = await resp.json();
        const out = data?.choices?.[0]?.message?.content;
        if (out) return finish(out, "DeepSeek (Turbo)");
      }
    } catch (e) {
      console.warn(`⚠️ Stage 4 (DeepSeek) failed: ${e.message}`);
    }
  }

  // --- STAGE 5: FREE OPENROUTER FALLBACK (last resort) ---
  if (keys.openrouterFree) {
    // The previous trio (gemma-3-4b, llama-3.1-8b, deepseek-r1 :free) was DELISTED —
    // all returned 404 "unavailable for free", so this safety net was dead. Replaced
    // (benchmarked 2026-06-10 on a Hebrew script) with three currently-available,
    // capable models across THREE providers, so a single provider's rate-limit can't
    // empty the net. gemma-4-31b is first: it produced clean Hebrew (proper סצנה
    // headings, "סוף", English [image:] line) in ~1s — near the paid quality tier.
    // (gpt-oss-120b:free was rejected — it writes English "SCENE" headings in Hebrew.)
    // Free models 429 transiently under load; the loop just moves to the next.
    const freeModels = [
      "google/gemma-4-31b-it:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen3-next-80b-a3b-instruct:free"
    ];

    for (const modelId of freeModels) {
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
        }, 12000);

        if (resp.ok) {
          const data = await resp.json();
          const out = data?.choices?.[0]?.message?.content;
          if (out) return finish(out, `Free fallback (${modelId})`);
        }
      } catch (e) {
        console.warn(`⚠️ Stage 5 (${modelId}) failed: ${e.message}`);
      }
    }
  }

  return { success: false, error: "Production Halted: All AI servers offline." };
}
