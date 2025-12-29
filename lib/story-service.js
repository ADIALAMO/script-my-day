import { buildComicScriptPrompt } from "./agent.js";

// המודל שנבחר על ידי הבמאי - Gemma 3 27B
const MODEL_NAME = "google/gemma-3-27b-it:free";
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

export async function generateScript(userText, genre) {
  if (!OPENROUTER_API_KEY) {
    return { success: false, error: "Missing OpenRouter API Key." };
  }

  try {
    const { messages, lang } = buildComicScriptPrompt(userText, genre);
    
    // שדרוג הנחיות הסוכן ליצירת פוסטר קולנועי אמיתי (IMAGE PROMPT UPGRADE)
    const extraInstruction = lang === "he"
      ? `\n\n### פקודות בימוי סופיות (חובה):
1. **כותרת תסריט**: בראש התסריט, תן שם יצירתי לסרט.
2. **דמויות**: שם פרטי ותיאור פיזי קצר בסוגריים.
3. **מגדר**: הקפד על לשון זכר או נקבה עקבית, ללא לוכסנים.
4. **סיום**: סיים תמיד במילים "סוף!".
5. **image (קריטי)**: בשורה האחרונה ממש, כתוב בדיוק כך: [image: Official movie poster, cinematic composition, hyper-realistic, dramatic color grading, professional studio lighting, 8k resolution, {English description of the scene without character names}].`
      : `\n\n### FINAL PRODUCTION RULES:
1. Title: Create a catchy movie title.
2. Characters: First names and physical traits only.
3. End with "THE END!".
4. image: [image: Official movie poster, cinematic composition, hyper-realistic, dramatic color grading, professional studio lighting, 8k resolution, {Short visual description without names}].`;

    messages.push({ role: "user", content: extraInstruction });

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
        temperature: 0.8,
        max_tokens: 1500,
        include_reasoning: false 
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
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