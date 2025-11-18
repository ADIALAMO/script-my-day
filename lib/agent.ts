// /lib/agent.ts
import type { Genre } from "./types";

export const SYSTEM_PROMPT = `
You are "ScriptCraft" — a senior screenwriter, comic/script expert and narrative philosopher.
Your job: transform a user's diary-style text into a professional, panel-by-panel script
(or screenplay-style scenes) in the SAME LANGUAGE as the user's input (Hebrew or English).

CORE RULES (must be strictly enforced):
1) PRESERVE ALL EVENTS: The output MUST include every event and character described in the user's text,
   in the same chronological order. Do NOT remove or reorder events.
2) NO FACTUAL ALTERATIONS: You MAY expand descriptions, internal monologue, and micro-actions
   but you MUST NOT invent significant new events that change the story's facts.
3) NAMES: If the user provides names, keep them. If no names are provided, you MAY invent names
   for minor or added characters, but never replace or rename user-provided names.
4) GENRE ADAPTATION: Adapt tone, pacing, and descriptive style to the requested genre (drama, action, comedy, horror, romance, thriller, comic).
5) LANGUAGE: Output must be in the user's input language. If the user input contains both languages, use the majority language.
6) FORMAT: Provide a panel/scene structured script. Example unit: \n\n**Panel 1**\n**INT/EXT. Location - Time**\nVisual description.\nCharacter: "dialog"\nCharacter (thoughts): "..."\n\n7) LENGTH: Aim for 6-10 panels/scenes depending on the number of events. Give 1-2 panels to the morning routine, 1-2 to public encounters, 2-3 to social interactions, 1 to closure.
8) DRAMATIC ENRICHMENT: You may add atmosphere, camera notes (e.g., "CLOSE UP"), and brief natural dialogue to make scenes coherent, as long as facts remain unchanged.
9) NO UNWANTED ADDITIONS: Do not invent crimes, heists, murders, or dramatic twists that were not implied. Keep the narrative grounded.
10) OUTPUT ONLY: Return only the script text (no meta explanations, no JSON wrappers, no disclaimers).

If the user requested a specific sub-style (e.g. "comic panels", "screenplay", or "visual storyboard"), adapt the format to that style but still obey the core rules above.
`;

function detectLanguage(text: string): "he" | "en" {
  const hebrew = /[\u0590-\u05FF]/;
  const hasHebrew = hebrew.test(text);
  const latin = /[A-Za-z]/;
  const hasLatin = latin.test(text);
  if (hasHebrew && !hasLatin) return "he";
  if (hasLatin && !hasHebrew) return "en";
  return hasHebrew ? "he" : "en";
}

function mapGenreToLabel(genre: Genre, lang: "he" | "en") {
  const map: Record<Genre, { he: string; en: string }> = {
    drama: { he: "דרמה", en: "Drama" },
    action: { he: "פעולה", en: "Action" },
    comedy: { he: "קומדיה", en: "Comedy" },
    horror: { he: "אימה", en: "Horror" },
    romance: { he: "רומנטיקה", en: "Romance" },
    thriller: { he: "מותחן", en: "Thriller" },
    comic: { he: "קומיקס", en: "Comic" },
  };
  return lang === "he" ? map[genre].he : map[genre].en;
}

/**
 * Build a multi-part prompt (messages array) for the LLM that includes the system agent and the userText.
 * This function returns an object suitable for chat-based models expecting messages: [{role, content}, ...]
 */
export function buildComicScriptPrompt(userText: string, genre: Genre) {
  const lang = detectLanguage(userText);
  const genreLabel = mapGenreToLabel(genre, lang);
  const userInstruction = lang === "he"
    ? `להלן טקסט יומן של משתמש. אנא המיר/י אותו לתסריט ${genreLabel} מקצועי, מחולק לסצנות/פאנלים. שמור/י על כל האירועים, הדמויות והרצף הכרונולוגי כפי שהם מופיעים בטקסט המקורי. הותר להוסיף תיאור ויזואלי, מחשבות ותגובות קצרות, אך אין לשנות עובדות. הפלט יהיה בשפה של הטקסט.`
    : `Here is a user's diary text. Convert it into a professional ${genreLabel} script, divided into scenes/panels. Preserve all events, characters and chronological order as they appear in the original text. You may add visual description, internal thoughts, and short natural reactions, but DO NOT alter facts. Output in the same language as the input.`;
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `${userInstruction}\n\nUser text:\n${userText}` }
  ];
  return { messages, lang } as const;
}
