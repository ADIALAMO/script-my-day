import { buildComicScriptPrompt, mapGenreToLabel } from "./agent.js";

/**
 * פונקציית עזר לניהול זמן (Timeouts)
 */
async function fetchWithTimeout(url, options, timeout = 40000) {
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
  // 1. חילוץ ההנחיות (עכשיו יעבוד כי הוספנו את ה-Import למעלה)
  const { messages, lang } = buildComicScriptPrompt(userText, genre);

  // 2. חיזוק הז'אנר
  const genreLabel = mapGenreToLabel(genre, lang);
  const reinforcement = lang === "he" 
    ? `\n\nתזכורת סופית: הסרט חייב להיות בסטייל ${genreLabel} מובהק. החזר אך ורק את התסריט.`
    : `\n\nFinal Reminder: The film MUST be in a strict ${genreLabel} style. Return ONLY the script.`;

  messages[messages.length - 1].content += reinforcement;

  // הכנת הטקסט למודלים הישירים (Cohere/Gemini)
  const fullPrompt = messages.map(m => m.content).join("\n");

  const keys = {
    openrouter: process.env.OPENROUTER_API_KEY?.trim(),
    cohere: process.env.COHERE_API_KEY?.trim(),
    gemini: process.env.GOOGLE_GEMINI_API_KEY?.trim()
  };

  // --- STAGE 1: GOOGLE GEMINI (Smart Fallback Fix) ---
  if (keys.gemini) {
    try {
      console.log(`🚀 Stage 1: Attempting Gemini 2.5/3 (2026 Era)...`);
      
      const googleContents = messages.map(m => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }]
      }));

      const modelNames = [
        "gemini-2.5-flash-lite",  // החדש והנועז
        "gemini-flash-latest",     
        "gemini-2.5-flash",        // הסלע היציב שלך
        "gemini-3-flash-preview"
      ];

      let finalOutput = null;
      let successModel = "";

      for (const modelName of modelNames) {
        if (finalOutput) break; // אם יש לנו תוצאה טובה, סיימנו
        
        console.log(`📡 Testing: ${modelName}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${keys.gemini}`;

        try {
          const resp = await fetchWithTimeout(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: googleContents,
              generationConfig: { temperature: 0.7, maxOutputTokens: 4000 }
            })
          }, 20000);

          if (resp.status === 404) {
             console.log(`❌ ${modelName} not found (404) - Skipping...`);
             continue; 
          }

          const data = await resp.json();

          if (resp.ok && data?.candidates?.[0]?.content?.parts?.[0]?.text) {
            const candidateText = data.candidates[0].content.parts[0].text;
            
            // --- בדיקת איכות בתוך הלולאה ---
            // אם המשתמש ביקש אנגלית והמודל ענה בעברית - זה נחשב כישלון של המודל הספציפי הזה
            if (lang === "en" && /[\u0590-\u05FF]/.test(candidateText.slice(0, 200))) {
                console.warn(`⚠️ ${modelName} returned Hebrew (Language Mismatch). Skipping to next model...`);
                continue; // עובר מייד ל-Gemini 2.5
            }

            finalOutput = candidateText;
            successModel = modelName;
            console.log(`✅ Success! Model: ${modelName}`);
          } else {
            console.warn(`❌ ${modelName} error or empty response`);
          }
        } catch (e) {
          console.warn(`⚠️ Connection failed to ${modelName}: ${e.message}`);
        }
      }

      if (finalOutput) {
        return { success: true, output: finalOutput, model: `Gemini (${successModel})` };
      }
      
      throw new Error("All Gemini models failed valid generation");
    } catch (e) { 
      console.warn(`⚠️ Stage 1 (Gemini) Failed completely. Moving to Stage 2...`); 
    }
  }
 // --- STAGE 2: THE GEMMA 3 BREAKTHROUGH ---
if (keys.openRouter || keys.openrouter) {
    const activeKey = keys.openRouter || keys.openrouter;
    
    // רשימת היררכיה בתוך משפחת Gemma 3
    const gemmaModels = [
        "google/gemma-3-27b-it:free",
        "google/gemma-3-12b-it:free",
        "google/gemma-3-4b-it:free"
    ];

    for (const modelId of gemmaModels) {
        // ניסיון כפול לכל מודל (Retry)
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                console.log(`⚡ Stage 2: Attempting ${modelId} (Attempt ${attempt})...`);

                const cleanMessages = messages.map(m => ({
                    role: m.role === "system" ? "user" : m.role,
                    content: m.role === "system" ? `[INSTRUCTION]: ${m.content}` : m.content
                }));

                const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${activeKey}`,
                        "HTTP-Referer": "https://lifescript.app",
                        "X-Title": "LifeScript Studio",
                        "OR-Identify": "true" // עוזר בעקיפת Rate Limits מסוימים
                    },
                    body: JSON.stringify({
                        model: modelId,
                        messages: cleanMessages,
                        temperature: 0.8,
                        max_tokens: 2500
                    })
                }, 40000);

                if (resp.ok) {
                    const data = await resp.json();
                    const out = data?.choices?.[0]?.message?.content;
                    if (out) return { success: true, output: out, model: modelId };
                } 

                const err = await resp.json().catch(() => ({}));
                if (resp.status === 429) {
                    console.warn(`⚠️ ${modelId} is busy. Waiting 1.5s before next shot...`);
                    await new Promise(r => setTimeout(r, 1500)); // המתנה טקטית
                } else {
                    console.error(`❌ ${modelId} Error:`, err.error?.message);
                    break; // אם זו לא שגיאת עומס, אין טעם לנסות שוב את אותו מודל
                }
            } catch (e) {
                console.error("Connection lost during Gemma call");
            }
        }
    }
}

// --- STAGE 3: COHERE (Professional Backup) ---
if (keys.cohere) { // תיקון: שימוש בשם המשתנה הנכון שחילצת למעלה
    const activeKey = keys.cohere;
    try {
        console.log("🚀 Stage 3: Attempting Cohere (Command R+)...");

        const resp = await fetch("https://api.cohere.ai/v1/chat", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${activeKey}`,
                "Content-Type": "application/json",
                "Request-Source": "LifeScript-Studio"
            },
            body: JSON.stringify({
                model: "command-r-plus-08-2024", 
                message: messages[messages.length - 1].content, 
                chat_history: messages.slice(0, -1).map(m => ({
                    role: m.role === "assistant" ? "CHATBOT" : "USER",
                    message: m.content
                })),
                preamble: "You are a professional screenwriter. Return ONLY the screenplay text in Hebrew. No intro, no chat."
            })
        });

        if (resp.ok) {
            const data = await resp.json();
            const out = data.text;
            if (out) {
                console.log("✅ Cohere saved the day!");
                return { success: true, output: out, model: "Cohere Command R+" };
            }
        } else {
            const errData = await resp.json().catch(() => ({}));
            console.warn(`⚠️ Cohere failed (${resp.status}):`, errData.message || "Unknown Error");
        }
    } catch (e) {
        console.warn("⚠️ Stage 3 (Cohere) Error:", e.message);
    }
}

    // --- STAGE 4: DEEPSEEK V3 ---
  if (keys.openRouter || keys.openrouter) {
    const activeKey = keys.openRouter || keys.openrouter;
    try {
      console.log("🚀 Stage 4: OpenRouter (DeepSeek V3)...");
      // תיקון ה-URL מ-v1-fake ל-v1
      const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${activeKey}`,
          "X-Title": "LifeScript Studio",
          "HTTP-Referer": "https://lifescript.app"
        },
        body: JSON.stringify({
          model: "deepseek/deepseek-chat",
          messages: messages,
          temperature: 0.9,
          max_tokens: 3000
        })
      }, 35000);

      if (resp.ok) {
        const data = await resp.json();
        const out = data?.choices?.[0]?.message?.content;
        if (out) return { success: true, output: out, model: "DeepSeek (Turbo)" };
      }
    } catch (e) { 
      console.warn("⚠️ Stage 4 failed,final system check... "); 
    }
  }


  return { success: false, error: "Production Halted: All AI servers offline." };
  }