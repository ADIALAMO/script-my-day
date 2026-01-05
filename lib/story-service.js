import { buildComicScriptPrompt } from "./agent.js";

// שימוש במודל שנבחר ע"י הבמאי - Gemma 3 27B
const MODEL_NAME = "google/gemma-3-27b-it:free";
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

export async function generateScript(userText, genre) {
  if (!OPENROUTER_API_KEY) {
    return { success: false, error: "Missing OpenRouter API Key." };
  }

  try {
    // 1. קריאה לפונקציית הבנייה מתוך agent.js - מקבלים הודעות ושפה מזוהה
    const { messages, lang } = buildComicScriptPrompt(userText, genre);
    
    // 2. הזרקת הנחיית ה-Image (חובה להפקה) - כירורגית בלבד
    // אנחנו מוודאים שה-AI מבין את ההוראה בשפה שלו, אבל מייצר את הפרומפט באנגלית
    const extraInstruction = lang === "he"
      ? `\n\n### פקודת בימוי סופית (חובה):
בסיום התסריט ממש, בשורה אחרונה ונפרדת, כתוב בדיוק כך:
[image: Official movie poster, cinematic composition, hyper-realistic, dramatic color grading, professional studio lighting, 8k resolution, {visual description of the scene without character names}].`
      : `\n\n### FINAL PRODUCTION RULE:
At the very end of the script, on a dedicated last line, write exactly:
[image: Official movie poster, cinematic composition, hyper-realistic, dramatic color grading, professional studio lighting, 8k resolution, {visual description of the scene without character names}].`;

    // הוספת ההנחיה כהודעת משתמש אחרונה לחיזוק הציות
    messages.push({ role: "user", content: extraInstruction });

    // 3. קריאת API ל-OpenRouter
    const response = await fetch(OPENROUTER_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "X-Title": "LifeScript Studio", // שימור הפונקציה המקורית
      },
      body: JSON.stringify({
        model: MODEL_NAME,
        messages,
        temperature: 0.8, // שימור רמת היצירתיות המקורית
        max_tokens: 1800, // הגדלה קלה להבטחת סיום (THE END) מלא
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

    // 4. החזרת הפלט במבנה המקורי
    return { success: true, output };
  } catch (err) {
    console.error("Generation Error:", err);
    return { success: false, error: err.message };
  }
}

export { MODEL_NAME, OPENROUTER_API_URL, OPENROUTER_API_KEY };