import { buildComicScriptPrompt, mapGenreToLabel } from "./agent.js";

// הגדרות מודלים
const GEMINI_API_KEY = process.env.GOOGLE_GEMINI_API_KEY ?? "";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

const MODEL_NAME = "google/gemma-3-27b-it:free";
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

export async function generateScript(userText, genre) {
  // בניית הפרומפט המקורי (שומר על כל הלוגיקה של ה-agent)
  const { messages } = buildComicScriptPrompt(userText, genre);
  
  // הפיכת מערך ה-messages לפורמט שגוגל מבינה (טקסט שטוח)
  const fullPrompt = messages.map(m => `${m.role === 'system' ? 'Instructions:' : 'Input:'} ${m.content}`).join("\n\n");

  // --- ניסיון 1: Google Gemini (מודל ראשי) ---
  if (GEMINI_API_KEY) {
    try {
      const response = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            temperature: 0.8,
            maxOutputTokens: 2000,
            topP: 0.95
          }
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const output = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (output) return { success: true, output };
      }
      console.warn("Gemini Primary failed, trying OpenRouter fallback...");
    } catch (err) {
      console.error("Gemini Error:", err.message);
    }
  }

  // --- ניסיון 2: OpenRouter (גיבוי) ---
  if (!OPENROUTER_API_KEY) {
    return { success: false, error: "Missing API Keys for all providers." };
  }

  try {
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "X-Title": "LifeScript Studio",
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages,
        temperature: 0.7,
        max_tokens: 2000, 
        top_p: 0.95,
        include_reasoning: false 
      }),
    });

    if (!response.ok) throw new Error(`OpenRouter error: ${response.status}`);

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content || "";
    return { success: true, output };

  } catch (err) {
    console.error("Fallback Generation Error:", err);
    return { success: false, error: "שירות יצירת התסריטים אינו זמין כרגע." };
  }
}

export { MODEL_NAME, OPENROUTER_API_URL, OPENROUTER_API_KEY };