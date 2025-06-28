// netlify/functions/generateScript.js

exports.handler = async (event, context) => {
    // 1. וודא שזו בקשת POST עם גוף תקין
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    if (!event.body) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body' }) };
    }

    let diaryEntry;
    let genre;
    let lang;

    try {
        const requestBody = JSON.parse(event.body);
        diaryEntry = requestBody.diaryEntry;
        genre = requestBody.genre;
        lang = requestBody.lang;

        // וודא שקיבלנו את הנתונים הנדרשים
        if (!diaryEntry || !genre || !lang) {
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing diary entry, genre, or language in request.' }) };
        }

    } catch (error) {
        console.error("Error parsing request body:", error);
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
    }

    let generatedScript = "";

    try {
        // --- 2. לוגיקת קריאה ל-OpenRouter API ---
        // נגישה למפתח ה-API ממשתני הסביבה של Netlify.
        // וודא שהגדרת OPENROUTER_API_KEY בלוח המחוונים של Netlify.
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

        if (!OPENROUTER_API_KEY) {
            console.error("OPENROUTER_API_KEY is not configured in Netlify Environment Variables.");
            return { statusCode: 500, body: JSON.stringify({ error: 'OpenRouter API key is not configured.' }) };
        }

        // בניית הפרומפט למודל ה-AI
        const promptText = `צור תסריט קומיקס בסגנון ${genre} על בסיס יומן זה: "${diaryEntry}".
                            התסריט צריך להיות בשפה ${lang === 'he' ? 'עברית' : 'אנגלית'} ויש לכלול דיאלוגים קצרים ומרתקים, ותיאורי סצנות חזותיים.
                            התחל את התסריט בכותרת הסצנה (לדוגמה: "סצנה 1: חדר המגורים - בוקר").`;

        // ביצוע קריאה ל-OpenRouter API
        const openrouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                // המודל המועדף שלך, לפי ההגדרות הקודמות: google/gemma-3-4b
                "model": "google/gemma-3-4b",
                "messages": [
                    {"role": "system", "content": "אתה עוזר יצירתי שכותב תסריטי קומיקס קצרים ומרתקים."},
                    {"role": "user", "content": promptText}
                ],
                "temperature": 0.7, // רמת יצירתיות
                "max_tokens": 500 // אורך מקסימלי של התסריט
            })
        });

        const openrouterData = await openrouterResponse.json();

        // בדיקה אם הקריאה ל-API נכשלה
        if (!openrouterResponse.ok) {
            console.error("OpenRouter API Error Response:", openrouterData);
            return {
                statusCode: openrouterResponse.status,
                body: JSON.stringify({ error: `OpenRouter API error: ${openrouterData.message || 'Unknown error'}` })
            };
        }

        // חילוץ התסריט מהתשובה של OpenRouter
        generatedScript = openrouterData.choices[0]?.message?.content || "Failed to get script from AI.";

    } catch (error) {
        console.error("Error during OpenRouter API call:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate script due to API call error: " + error.message }) };
    }

    // 3. החזר את התסריט שנוצר ל-Frontend
    return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ script: generatedScript }),
    };
};
