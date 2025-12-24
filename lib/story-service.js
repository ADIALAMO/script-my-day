// /lib/story-service.js
import { buildComicScriptPrompt } from "./agent.js"; // הוספנו סיומת .js ו-import

const MODEL_NAME = process.env.MODEL_NAME ?? "openai/gpt-4.1";
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

async function callOpenRouter(messages, model = MODEL_NAME) {
  if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set in environment");
  const body = {
    model,
    messages,
    temperature: 0.7,
    max_tokens: 1200,
  };
  const res = await fetch(OPENROUTER_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`OpenRouter API error: ${res.status} - ${txt}`);
  }
  const j = await res.json();
  const content = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.text ?? j?.output?.[0]?.content?.text ?? null;
  if (!content) throw new Error("Could not parse response from OpenRouter");
  return content;
}

// שימוש ב-export מודרני
export async function generateScript(userText, genre) {
  try {
    const { messages, lang } = buildComicScriptPrompt(userText, genre);
    const extra = lang === "he"
      ? "\n\nהנחיה נוספת: שאף לתוצאה בת 6-10 פאנלים/סצנות אם הטקסט מאפשר. החזר את טקסט התסריט בלבד - ללא הסברים נוספים."
      : "\n\nExtra instruction: Aim for 6-10 panels/scenes if the text allows. Return the script text only - no extra explanations.";
    messages.push({ role: "user", content: extra });
    const output = await callOpenRouter(messages);
    return { success: true, output };
  } catch (err) {
    return { success: false, error: err?.message ?? String(err) };
  }
}

// ייצוא המשתנים הנוספים
export { MODEL_NAME, OPENROUTER_API_URL, OPENROUTER_API_KEY };