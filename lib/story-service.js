import { buildComicScriptPrompt, mapGenreToLabel } from "./agent.js";

/**
 * פונקציית עזר לניהול זמן - שומר על הלוגיקה המקורית שלך עם שיפור קטן ביציבות
 */
async function fetchWithTimeout(url, options, timeout = 35000) {
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
  // 1. חילוץ ההנחיות מהסוכן (שומר על המקור ב-100%)
  const { messages, lang } = buildComicScriptPrompt(userText, genre);
  
  // 2. הזרקת ה-Reinforcement (בדיוק לפי הלוגיקה המקורית שלך)
  const genreLabel = mapGenreToLabel(genre, lang);
  const reinforcement = lang === "he" 
    ? `\n\nתזכורת סופית: הסרט חייב להיות בסטייל ${genreLabel} מובהק. אל תהיה דרמטי אם זה לא הז'אנר. החזר אך ורק את התסריט בלי הקדמות.`
    : `\n\nFinal Reminder: The film MUST be in a strict ${genreLabel} style. Do not be dramatic unless the genre requires it. Return ONLY the script without introductions.`;

  // הוספת החיזוק להודעה האחרונה כדי שה-AI לא "ישכח" את הז'אנר
  messages[messages.length - 1].content += reinforcement;

  // הכנת טקסט רציף לגיבוי של Gemini (כמו בקוד המקורי)
  const fullPrompt = messages.map(m => m.content).join("\n");

  const keys = {
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
    gemini: process.env.GOOGLE_GEMINI_API_KEY?.trim()
  };

  // --- STAGE 1: DEEPSEEK (המחליף המקצועי של Cohere - מהיר וזול יותר) ---
  if (keys.openrouter) {
    try {
      console.log("🚀 Stage 1: OpenRouter (DeepSeek V3)...");
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
      console.warn(`⚠️ DeepSeek failed (${reason}), trying Stage 2...`); 
    }
  }

  // --- STAGE 2: GEMMA 3 (רשת הביטחון החינמית בתוך OpenRouter) ---
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
          temperature: 0.9
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const out = data?.choices?.[0]?.message?.content;
        if (out) return { success: true, output: out, model: "Gemma 3 (Free)" };
      }
      throw new Error(`Status ${resp.status}`);
    } catch (e) { 
      console.warn(`⚠️ Stage 2 failed, trying final backup...`); 
    }
  }

  // --- STAGE 3: GEMINI 3 FLASH (המוצא האחרון - ישירות מול גוגל) ---
  if (keys.gemini) {
    try {
      console.log("🎬 Stage 3: Gemini 3 Flash Direct...");
      const resp = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${keys.gemini}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }] })
        },
        30000
      );
      if (resp.ok) {
        const data = await resp.json();
        const out = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (out) return { success: true, output: out, model: "Gemini 1.5 Flash" };
      }
    } catch (e) { 
      console.error(`❌ All providers failed.`); 
    }
  }

  return { success: false, error: "Production Halted: כל השרתים עמוסים. נסה שוב בעוד רגע." };
}