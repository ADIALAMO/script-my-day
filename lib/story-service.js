import { buildComicScriptPrompt, mapGenreToLabel } from "./agent.js";

// פונקציית עזר לניהול זמן (15 שניות לכל שרת - כפי שסיכמנו מקצועית)
async function fetchWithTimeout(url, options, timeout = 25000) {
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
  // 1. חילוץ ההנחיות המדויקות מה-Agent
  const { messages, lang } = buildComicScriptPrompt(userText, genre);
  
  // 2. הוספת ה-Reinforcement (החיזוק)
  const genreLabel = mapGenreToLabel(genre, lang);
  const reinforcement = lang === "he" 
    ? `\n\nתזכורת סופית: הסרט חייב להיות בסטייל ${genreLabel} מובהק. אל תהיה דרמטי אם זה לא הז'אנר. החזר אך ורק את התסריט בלי הקדמות.`
    : `\n\nFinal Reminder: The film MUST be in a strict ${genreLabel} style. Do not be dramatic unless the genre requires it. Return ONLY the script without introductions.`;

  messages[messages.length - 1].content += reinforcement;

  // הכנת הפרומפט כטקסט רציף עבור המודלים הרלוונטיים
  const fullPrompt = messages.map(m => m.content).join("\n");

  const keys = {
    gemini: process.env.GOOGLE_GEMINI_API_KEY?.trim(),
    cohere: process.env.COHERE_API_KEY?.trim(),
    openrouter: process.env.OPENROUTER_API_KEY?.trim()
  };

  // --- STAGE 1: COHERE (עובר להיות המנוע הראשי) ---
  if (keys.cohere) {
    try {
      console.log("🚀 Stage 1: Cohere Command-R...");
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
    } catch (e) { console.warn("Cohere failed, trying backup..."); }
  }

  // --- STAGE 2: OPENROUTER (Gemma 3 - רשת הביטחון הראשונה) ---
  if (keys.openrouter) {
    try {
      console.log("🛡️ Stage 2: OpenRouter (Gemma 3)...");
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
          temperature: 0.9,
          top_p: 0.95
        })
      }, 25000);
      const data = await resp.json();
      const out = data?.choices?.[0]?.message?.content;
      if (out) return { success: true, output: out, model: "Gemma (OpenRouter)" };
    } catch (e) { console.warn("OpenRouter failed, trying final backup..."); }
  }

  // --- STAGE 3: GEMINI 3 FLASH (המוצא האחרון) ---
  if (keys.gemini) {
    try {
      console.log("🎬 Stage 3: Gemini 3 Flash...");
      const resp = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${keys.gemini}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
        }
      );
      if (resp.ok) {
        const data = await resp.json();
        const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (out) return { success: true, output: out, model: "Gemini 3" };
      }
    } catch (e) { console.error("All providers failed."); }
  }

  return { success: false, error: "Production Halted: All AI servers offline." };
}