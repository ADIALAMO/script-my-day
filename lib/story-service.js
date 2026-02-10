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
      console.warn(`⚠️ Stage 1 (Gemini) Failed completely. Moving to Stage 3...`); 
    }
  }
  // --- STAGE 2: OPENROUTER (Gemma 3) ---
  if (keys.openRouter || keys.openrouter) { // תמיכה בשני הסוגים ליתר ביטחון
    const activeKey = keys.openRouter || keys.openrouter;
    try {
      console.log("⚡ Stage 2: Gemma 3 (OpenRouter)...");
      const resp = await fetchWithTimeout("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${activeKey}`,
          "X-Title": "LifeScript Studio"
        },
        body: JSON.stringify({
          model: "google/gemma-3-27b-it:free",
          messages: messages,
          temperature: 0.8
        })
      }, 35000);

      if (resp.ok) {
        const data = await resp.json();
        const out = data?.choices?.[0]?.message?.content;
        if (out) return { success: true, output: out, model: "Gemma 3" };
      }
    } catch (e) { 
      console.warn("⚠️ Stage 2 Timeout/Error, moving to backup..."); 
    }
  }

  
  // --- STAGE 3: EMERGENCY BACKUP (Pollinations) ---
    try {
      console.log("🆘 Stage 3: Emergency Backup (Pollinations)...");
      const resp = await fetch("https://text.pollinations.ai/", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          // הזרקת ההוראה ישירות למערך ההודעות רק עבור קריאה זו
          messages: [
            ...messages,
            { role: "user", content: "IMPORTANT: Return ONLY the raw screenplay text. No thinking process, no intro, no reasoning. Start directly with the title." }
          ], 
          model: "mistral", 
          seed: 42
        })
      });

      // קריאה כטקסט ועטיפה באובייקט תואם
      const textResult = await resp.text();
      
      if (textResult && textResult.length > 10) {
        return { 
          success: true, 
          output: textResult, 
          model: "Emergency Backup (Pollinations)" 
        };
      }
    } catch (e) {
      console.warn("⚠️ Stage 3 failed, moving to final safety net..."); 
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