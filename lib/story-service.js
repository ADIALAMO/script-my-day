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

export async function generateScript(userText, genre) {
  const { messages, lang } = buildScriptPrompt(userText, genre);

  const keys = {
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
    openrouterFree: process.env.OPENROUTER_FREE_KEY?.trim(),
    cohere: process.env.COHERE_API_KEY?.trim(),
    gemini: process.env.GOOGLE_GEMINI_API_KEY?.trim()
  };

  // --- STAGE 1: GOOGLE GEMINI (Parallel Race) ---
  if (keys.gemini) {
    try {
      const googleContents = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

      const modelNames = [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-flash-latest",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite-preview",
        "gemini-3.1-pro-preview"
      ];

      // Aborted by the winner to cancel the remaining 3 in-flight requests immediately.
      const raceController = new AbortController();

      const racePromises = modelNames.map(async (modelName) => {
        const timeoutController = new AbortController();
        // 12s per model (was 20s) so Stage 1 worst-case costs ≤12s of the 60s budget.
        const timeoutId = setTimeout(() => timeoutController.abort(), 12000);
        // Fires on per-model 20s timeout OR when another model wins the race.
        const signal = combineSignals(timeoutController.signal, raceController.signal);

        try {
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${keys.gemini}`;

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

      const winner = await Promise.any(racePromises);
      return { success: true, output: winner.output, model: `Gemini (${winner.model})` };

    } catch (e) {
      console.warn(`⚠️ Stage 1 (Gemini) exhausted — trying Stage 2`);
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
                    if (out) return { success: true, output: out, model: modelId };
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
            if (out) return { success: true, output: out, model: "Cohere Command R+" };
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
        if (out) return { success: true, output: out, model: "DeepSeek (Turbo)" };
      }
    } catch (e) {
      console.warn(`⚠️ Stage 4 (DeepSeek) failed: ${e.message}`);
    }
  }

  // --- STAGE 5: FREE OPENROUTER FALLBACK (last resort) ---
  if (keys.openrouterFree) {
    const freeModels = [
      "google/gemma-3-4b-it:free",
      "meta-llama/llama-3.1-8b-instruct:free",
      "deepseek/deepseek-r1:free"
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
          if (out) return { success: true, output: out, model: `Free fallback (${modelId})` };
        }
      } catch (e) {
        console.warn(`⚠️ Stage 5 (${modelId}) failed: ${e.message}`);
      }
    }
  }

  return { success: false, error: "Production Halted: All AI servers offline." };
}
