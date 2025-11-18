// /lib/story-service.ts
import { buildComicScriptPrompt } from "./agent";
import type { Genre, ScriptResult } from "./types";

export const MODEL_NAME = process.env.MODEL_NAME ?? "openai/gpt-4.1";
export const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";

interface OpenRouterChatMessage {
  role: string;
  content: string;
}

async function callOpenRouter(messages: OpenRouterChatMessage[], model = MODEL_NAME): Promise<string> {
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

export async function generateScript(userText: string, genre: Genre): Promise<ScriptResult> {
  try {
    const { messages, lang } = buildComicScriptPrompt(userText, genre);
    const extra = lang === "he"
      ? "\n\nהנחיה נוספת: שאף לתוצאה בת 6-10 פאנלים/סצנות אם הטקסט מאפשר זאת. החזר את הטקסט בלבד - ללא הסברים נוספים."
      : "\n\nExtra instruction: Aim for 6-10 panels/scenes if the text allows. Return the script text only - no extra explanations.";
    messages.push({ role: "user", content: extra });
    const output = await callOpenRouter(messages);
    return { success: true, output };
  } catch (err: any) {
    return { success: false, error: err?.message ?? String(err) };
  }
}
