import { buildComicScriptPrompt, mapGenreToLabel } from "./agent.js";

/**
 * פונקציית עזר לניהול זמן (Timeouts)
 */
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

export async function generateScript(userText, genre) {
  // 1. חילוץ ההנחיות (עכשיו יעבוד כי הוספנו את ה-Import למעלה)
  const { messages, lang } = buildComicScriptPrompt(userText, genre);

  // 2. חיזוק הז'אנר
  const genreLabel = mapGenreToLabel(genre, lang);
  const reinforcement = lang === "he" 
    ? `\n\nתזכורת סופית: הסרט חייב להיות בסטייל ${genreLabel} מובהק. החזר אך ורק את התסריט.`
    : `\n\nFinal Reminder: The film MUST be in a strict ${genreLabel} style. Return ONLY the script.`;

  messages[messages.length - 1].content += reinforcement;

  // הכנת הטקסט למודלים הישירים (Cohere/Gemini)
  const fullPrompt = messages.map(m => m.content).join("\n");

  const keys = {
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
    cohere: process.env.COHERE_API_KEY?.trim(),
    gemini: process.env.GOOGLE_GEMINI_API_KEY?.trim()
  };

  // --- STAGE 1: OPENROUTER (Gemma 3 - מהירות וחיסכון) ---
  if (keys.openrouter) {
    try {
      console.log("⚡ Stage 1: Gemma 3 (OpenRouter)...");
      const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${keys.openrouter}`,
          "X-Title": "LifeScript Studio"
        },
        body: JSON.stringify({
          model: "google/gemma-3-27b-it:free",
          messages: messages,
          temperature: 0.8
        })
      }, 35000); // 35 שניות זמן המתנה

      if (resp.ok) {
        const data = await resp.json();
        const out = data?.choices?.[0]?.message?.content;
        if (out) return { success: true, output: out, model: "Gemma 3" };
      }
    } catch (e) { 
      console.warn("⚠️ Stage 1 Timeout/Error, moving to backup..."); 
    }
  }

  // --- STAGE 2: COHERE DIRECT (הגיבוי הקלאסי שעבד לך בעבר) ---
  if (keys.cohere) {
    try {
      console.log("🚀 Stage 2: Cohere Command-R...");
      const resp = await fetchWithTimeout("https://api.cohere.ai/v1/chat", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${keys.cohere}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: "command-r-08-2024",
          message: fullPrompt,
          temperature: 0.9
        })
      });
      const data = await resp.json();
      if (resp.ok && data.text) return { success: true, output: data.text, model: "Cohere" };
      
      // אם התשובה לא OK (למשל מכסה נגמרה), נזרוק שגיאה כדי להגיע ל-catch
      throw new Error(`HTTP ${resp.status}`);
    } catch (e) { 
      const reason = e.name === 'AbortError' ? 'Timeout (25s)' : e.message;
      console.warn(`⚠️ Cohere failed (${reason}), trying backup...`); 
    }
  }

  // --- STAGE 3: DEEPSEEK V3 (המוצא האחרון והבטוח) ---
  if (keys.openrouter) {
    try {
      console.log("🚀 Stage 3: OpenRouter (DeepSeek V3)...");
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
      });

      if (resp.ok) {
        const data = await resp.json();
        const out = data?.choices?.[0]?.message?.content;
        if (out) return { success: true, output: out, model: "DeepSeek (Turbo)" };
      }
      throw new Error(`Status ${resp.status}`);
    } catch (e) { 
      const reason = e.name === 'AbortError' ? 'Timeout (35s)' : e.message;
      console.warn(`⚠️ DeepSeek failed (${reason}), All AI Stages failed...`); 
    }
  }
  return { success: false, error: "Production Halted: All AI servers offline." };
}