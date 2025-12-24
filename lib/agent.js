// /lib/agent.js

export const SYSTEM_PROMPT = `
You are "ScriptCraft" — a senior screenwriter, comic/script expert and narrative philosopher.
Your job: transform a user's diary-style text into a professional, panel-by-panel script
(or screenplay-style scenes) in the SAME LANGUAGE as the user's input (Hebrew or English).

CORE RULES (must be strictly enforced):
1) PRESERVE ALL EVENTS: The output MUST include every event and character described in the user's text, in the same chronological order.
2) NO FACTUAL ALTERATIONS: You MUST NOT invent significant new events.
3) NAMES: Keep user-provided names.
4) GENRE ADAPTATION: Adapt tone to the requested genre.
5) LANGUAGE: Output must be in the user's input language.
6) FORMAT: Provide a panel/scene structured script.
7) LENGTH: Aim for 6-10 panels/scenes.
8) DRAMATIC ENRICHMENT: Add atmosphere and camera notes.
9) NO UNWANTED ADDITIONS: Keep it grounded.
10) OUTPUT ONLY: Return only the script text.
`;

export function detectLanguage(text) {
  const hebrew = /[\u0590-\u05FF]/;
  const hasHebrew = hebrew.test(text);
  const latin = /[A-Za-z]/;
  const hasLatin = latin.test(text);
  if (hasHebrew && !hasLatin) return "he";
  if (hasLatin && !hasHebrew) return "en";
  return hasHebrew ? "he" : "en";
}

export function mapGenreToLabel(genre, lang) {
  const map = {
    drama: { he: "דרמה", en: "Drama" },
    action: { he: "פעולה", en: "Action" },
    comedy: { he: "קומדיה", en: "Comedy" },
    horror: { he: "אימה", en: "Horror" },
    romance: { he: "רומנטיקה", en: "Romance" },
    thriller: { he: "מותחן", en: "Thriller" },
    comic: { he: "קומיקס", en: "Comic" },
    "sci-fi": { he: "מדע בדיוני", en: "Sci-Fi" } // הוספת המפתח החסר עם המקף
  };

  // מנגנון הגנה: אם הז'אנר לא קיים במפה, נשתמש בדרמה כברירת מחדל
  const genreData = map[genre] || map.drama;
  return lang === "he" ? genreData.he : genreData.en;
}

export function buildComicScriptPrompt(userText, genre) {
  const lang = detectLanguage(userText);
  const genreLabel = mapGenreToLabel(genre, lang);
  const userInstruction = lang === "he"
    ? `להלן טקסט יומן של משתמש. אנא המר/י אותו לתסריט ${genreLabel} מקצועי, מחולק לסצנות/פאנלים. שמור/י על כל האירועים.`
    : `Here is a user's diary text. Convert it into a professional ${genreLabel} script.`;
  
  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userInstruction },
    { role: "user", content: userText }
  ];
  return { messages, lang };
}