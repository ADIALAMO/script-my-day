module.exports = [
"[externals]/next/dist/compiled/@opentelemetry/api [external] (next/dist/compiled/@opentelemetry/api, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/@opentelemetry/api", () => require("next/dist/compiled/@opentelemetry/api"));

module.exports = mod;
}),
"[externals]/next/dist/compiled/next-server/pages-api-turbo.runtime.dev.js [external] (next/dist/compiled/next-server/pages-api-turbo.runtime.dev.js, cjs)", ((__turbopack_context__, module, exports) => {

const mod = __turbopack_context__.x("next/dist/compiled/next-server/pages-api-turbo.runtime.dev.js", () => require("next/dist/compiled/next-server/pages-api-turbo.runtime.dev.js"));

module.exports = mod;
}),
"[project]/lib/agent.js [api] (ecmascript)", ((__turbopack_context__) => {
"use strict";

// /lib/agent.js
__turbopack_context__.s([
    "SYSTEM_PROMPT",
    ()=>SYSTEM_PROMPT,
    "buildComicScriptPrompt",
    ()=>buildComicScriptPrompt,
    "detectLanguage",
    ()=>detectLanguage,
    "mapGenreToLabel",
    ()=>mapGenreToLabel
]);
const SYSTEM_PROMPT = `
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
function detectLanguage(text) {
    const hebrew = /[\u0590-\u05FF]/;
    const hasHebrew = hebrew.test(text);
    const latin = /[A-Za-z]/;
    const hasLatin = latin.test(text);
    if (hasHebrew && !hasLatin) return "he";
    if (hasLatin && !hasHebrew) return "en";
    return hasHebrew ? "he" : "en";
}
function mapGenreToLabel(genre, lang) {
    const map = {
        drama: {
            he: "דרמה",
            en: "Drama"
        },
        action: {
            he: "פעולה",
            en: "Action"
        },
        comedy: {
            he: "קומדיה",
            en: "Comedy"
        },
        horror: {
            he: "אימה",
            en: "Horror"
        },
        romance: {
            he: "רומנטיקה",
            en: "Romance"
        },
        thriller: {
            he: "מותחן",
            en: "Thriller"
        },
        comic: {
            he: "קומיקס",
            en: "Comic"
        },
        "sci-fi": {
            he: "מדע בדיוני",
            en: "Sci-Fi"
        } // הוספת המפתח החסר עם המקף
    };
    // מנגנון הגנה: אם הז'אנר לא קיים במפה, נשתמש בדרמה כברירת מחדל
    const genreData = map[genre] || map.drama;
    return lang === "he" ? genreData.he : genreData.en;
}
function buildComicScriptPrompt(userText, genre) {
    const lang = detectLanguage(userText);
    const genreLabel = mapGenreToLabel(genre, lang);
    const userInstruction = lang === "he" ? `להלן טקסט יומן של משתמש. אנא המר/י אותו לתסריט ${genreLabel} מקצועי, מחולק לסצנות/פאנלים. שמור/י על כל האירועים.` : `Here is a user's diary text. Convert it into a professional ${genreLabel} script.`;
    const messages = [
        {
            role: "system",
            content: SYSTEM_PROMPT
        },
        {
            role: "user",
            content: userInstruction
        },
        {
            role: "user",
            content: userText
        }
    ];
    return {
        messages,
        lang
    };
}
}),
"[project]/lib/story-service.js [api] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "MODEL_NAME",
    ()=>MODEL_NAME,
    "OPENROUTER_API_KEY",
    ()=>OPENROUTER_API_KEY,
    "OPENROUTER_API_URL",
    ()=>OPENROUTER_API_URL,
    "generateScript",
    ()=>generateScript
]);
// /lib/story-service.js
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$agent$2e$js__$5b$api$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/agent.js [api] (ecmascript)"); // הוספנו סיומת .js ו-import
;
const MODEL_NAME = process.env.MODEL_NAME ?? "openai/gpt-4.1";
const OPENROUTER_API_URL = process.env.OPENROUTER_API_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "";
async function callOpenRouter(messages, model = MODEL_NAME) {
    if (!OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY not set in environment");
    const body = {
        model,
        messages,
        temperature: 0.7,
        max_tokens: 1200
    };
    const res = await fetch(OPENROUTER_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${OPENROUTER_API_KEY}`
        },
        body: JSON.stringify(body)
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
async function generateScript(userText, genre) {
    try {
        const { messages, lang } = (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$agent$2e$js__$5b$api$5d$__$28$ecmascript$29$__["buildComicScriptPrompt"])(userText, genre);
        const extra = lang === "he" ? "\n\nהנחיה נוספת: שאף לתוצאה בת 6-10 פאנלים/סצנות אם הטקסט מאפשר. החזר את טקסט התסריט בלבד - ללא הסברים נוספים." : "\n\nExtra instruction: Aim for 6-10 panels/scenes if the text allows. Return the script text only - no extra explanations.";
        messages.push({
            role: "user",
            content: extra
        });
        const output = await callOpenRouter(messages);
        return {
            success: true,
            output
        };
    } catch (err) {
        return {
            success: false,
            error: err?.message ?? String(err)
        };
    }
}
;
}),
"[project]/pages/api/generate-script.js [api] (ecmascript)", ((__turbopack_context__) => {
"use strict";

__turbopack_context__.s([
    "default",
    ()=>handler
]);
// pages/api/generate-script.js
var __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$story$2d$service$2e$js__$5b$api$5d$__$28$ecmascript$29$__ = __turbopack_context__.i("[project]/lib/story-service.js [api] (ecmascript)");
;
async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            message: 'Method Not Allowed'
        });
    }
    try {
        const { journalEntry, genre } = req.body;
        if (!journalEntry) {
            return res.status(400).json({
                message: 'Missing journal entry'
            });
        }
        const result = await (0, __TURBOPACK__imported__module__$5b$project$5d2f$lib$2f$story$2d$service$2e$js__$5b$api$5d$__$28$ecmascript$29$__["generateScript"])(journalEntry, genre || 'drama');
        if (!result.success) {
            throw new Error(result.error);
        }
        return res.status(200).json({
            script: result.output
        });
    } catch (error) {
        console.error("API Error:", error);
        return res.status(500).json({
            message: error.message
        });
    }
}
}),
];

//# sourceMappingURL=%5Broot-of-the-server%5D__74221909._.js.map