// api/generateScript.cjs

const axios = require('axios'); // ייבוא axios

exports.handler = async (event, context) => {
    // רשום את שיטת ה-HTTP הנכנסת לצרכי דיבוג
    console.log(`Incoming HTTP method: ${event.httpMethod}`);

    // טיפול בבקשות OPTIONS עבור בדיקות Preflight של CORS
    if (event.httpMethod === 'OPTIONS') {
        console.log('Handling OPTIONS preflight request.');
        return {
            statusCode: 200,
            headers: {
                // חשוב: בסביבת פרודקשן, החלף את '*' בכתובת ה-URL האמיתית של הפרונטאנד שלך
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type, Authorization',
                'Access-Control-Max-Age': '86400',
            },
            body: ''
        };
    }

    // וודא שזו בקשת POST עם גוף תקין
    if (event.httpMethod !== 'POST') {
        console.log(`Method Not Allowed: Received ${event.httpMethod}, expected POST.`);
        return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    if (!event.body) {
        console.log('Missing request body.');
        return { statusCode: 400, body: JSON.stringify({ error: 'Missing request body.' }) };
    }

    let diaryEntry;
    let genre;
    let lang;

    try {
        const requestBody = JSON.parse(event.body);
        diaryEntry = requestBody.diaryEntry;
        genre = requestBody.genre;
        lang = requestBody.lang;

        // וודא שכל הנתונים הנדרשים קיימים
        if (!diaryEntry || !genre || !lang) {
            console.log('Missing required data in request body.');
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing diary entry, genre, or language in request.' }) };
        }

    } catch (error) {
        console.error("Error parsing request body:", error);
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
    }

    let generatedScript = "";

    try {
        // ניגש למפתח ה-API ממשתני הסביבה של Vercel (או קובץ .env מקומית).
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

        // רשום ללוג כדי לוודא שמפתח ה-API נטען כראוי
        console.log(`OpenRouter API Key defined: ${!!OPENROUTER_API_KEY}. Length: ${OPENROUTER_API_KEY ? OPENROUTER_API_KEY.length : 0}`);

        if (!OPENROUTER_API_KEY) {
            console.error("OPENROUTER_API_KEY is not configured in Vercel Environment Variables (or .env locally).");
            return { statusCode: 500, body: JSON.stringify({ error: 'OpenRouter API key is not configured.' }) };
        }

        // בניית הפרומפט למודל ה-AI
        const promptText = `Create a comic script in the ${genre} genre based on this diary entry: "${diaryEntry}".
                            The script should be in ${lang === 'he' ? 'Hebrew' : 'English'} and include short, engaging dialogues, and visual scene descriptions.
                            Start the script with a scene heading (e.g., "SCENE 1: LIVING ROOM - MORNING").`;


        // ביצוע קריאה ל-OpenRouter API באמצעות Axios.
        const openrouterResponse = await axios.post("https://openrouter.ai/api/v1/chat/completions", {
            "model": "deepseek/deepseek-chat-v3-0324:free",
            "messages": [
                {"role": "system", "content": "You are a creative assistant that writes short, engaging comic scripts."},
                {"role": "user", "content": promptText}
            ],
            "temperature": 0.7,
            "max_tokens": 500
        }, {
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            }
        });

        // נתוני התגובה של Axios נמצאים ישירות ב-openrouterResponse.data
        generatedScript = openrouterResponse.data.choices[0]?.message?.content || "Failed to get script from AI.";

    } catch (error) {
        // שגיאות Axios מכילות אובייקט 'response' עבור שגיאות שרת
        if (error.response) {
            console.error("OpenRouter API Error Response (Axios):", error.response.data);
            return {
                statusCode: error.response.status,
                body: JSON.stringify({ error: `OpenRouter API error: ${error.response.data.message || 'Unknown error'}` })
            };
        } else {
            console.error("Error during OpenRouter API call (Axios):", error);
            return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate script due to API call error: " + error.message }) };
        }
    }

    // החזר את התסריט שנוצר ל-Frontend
    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*', // וודא שזה קיים גם בתגובה מוצלחת עבור CORS
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ script: generatedScript }),
    };
};
