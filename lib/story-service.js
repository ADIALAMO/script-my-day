
import { buildComicScriptPrompt, mapGenreToLabel } from "./agent.js";

const MODEL_NAME = "google/gemma-3-27b-it:free";
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

export async function generateScript(userText, genre) {
  if (!OPENROUTER_API_KEY) {
    return { success: false, error: "Missing OpenRouter API Key." };
  }

  try {
    // 1. קריאה לפונקציית הבנייה המקורית - היא כבר כוללת את הכל בתוכה
    const { messages, lang } = buildComicScriptPrompt(userText, genre);
    
    
    // 3. קריאת API ל-OpenRouter
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
        temperature: 0.7, // העליתי מעט ל-0.9 כדי לתת לו יותר "אומץ" בשינוי הז'אנר
        max_tokens: 2000, 
        top_p: 0.95, // מוסיף גמישות יצירתית
        include_reasoning: false 
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      console.error(`API Error Details: ${errorData}`);
      throw new Error(`OpenRouter error: ${response.status}`);
    }

    const data = await response.json();
    const output = data?.choices?.[0]?.message?.content || "";

    return { success: true, output };
  } catch (err) {
    console.error("Generation Error:", err);
    return { success: false, error: err.message };
  }
}

export { MODEL_NAME, OPENROUTER_API_URL, OPENROUTER_API_KEY };
