// netlify/functions/generateScript.cjs

// Explicitly import fetch for local Node.js environment; ensure node-fetch is installed (npm install node-fetch)
// This specifically imports the 'default' export of node-fetch, which resolves 'fetch2 is not a function' errors.
// ייבוא מפורש של fetch עבור סביבת Node.js מקומית; וודא ש-node-fetch מותקן (npm install node-fetch)
// זה מייבא במפורש את ה-default export של node-fetch, מה שפותר שגיאות כמו 'fetch2 is not a function'.
const fetch = require('node-fetch').default; // This line is crucial for local testing

exports.handler = async (event, context) => {
    // Log the incoming HTTP method for debugging
    // רשום את שיטת ה-HTTP הנכנסת לצרכי דיבוג
    console.log(`Incoming HTTP method: ${event.httpMethod}`);

    // Handle OPTIONS method for CORS preflight requests
    // טיפול בבקשות OPTIONS עבור בדיקות Preflight של CORS
    if (event.httpMethod === 'OPTIONS') {
        console.log('Handling OPTIONS preflight request.');
        return {
            statusCode: 200,
            headers: {
                // IMPORTANT: In production, replace '*' with your actual frontend URL (e.g., 'https://your-domain.netlify.app')
                // חשוב: בסביבת פרודקשן, החלף את '*' בכתובת ה-URL האמיתית של הפרונטאנד שלך
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', // Ensure POST and OPTIONS are allowed
                // וודא ש-POST ו-OPTIONS מותרים
                'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Include Authorization if API key is sent in headers
                // כלול Authorization אם מפתח API נשלח בכותרות
                'Access-Control-Max-Age': '86400', // Cache preflight response for 24 hours
                // שמור תגובת preflight למשך 24 שעות
            },
            body: '' // No content needed for OPTIONS preflight
            // אין צורך בתוכן עבור בקשת Preflight מסוג OPTIONS
        };
    }

    // 1. Ensure this is a POST request with a valid body
    // 1. וודא שזו בקשת POST עם גוף תקין
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
        // Accesses the API key from Netlify Environment Variables (or .env locally)
        // ניגש למפתח ה-API ממשתני הסביבה של Netlify (או קובץ .env מקומית)
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

        if (!OPENROUTER_API_KEY) {
            console.error("OPENROUTER_API_KEY is not configured in Netlify Environment Variables (or .env locally).");
            return { statusCode: 500, body: JSON.stringify({ error: 'OpenRouter API key is not configured.' }) };
        }

        // Construct the prompt for the AI model
        // בניית הפרומפט למודל ה-AI
        const promptText = `צור תסריט קומיקס בסגנון ${genre} על בסיס יומן זה: "${diaryEntry}".
                            התסריט צריך להיות בשפה ${lang === 'he' ? 'עברית' : 'אנגלית'} ויש לכלול דיאלוגים קצרים ומרתקים, ותיאורי סצנות חזותיים.
                            התחל את התסריט בכותרת הסצנה (לדוגמה: "סצנה 1: חדר המגורים - בוקר").`;

        // Make the call to the OpenRouter API
        // ביצוע קריאה ל-OpenRouter API
        const openrouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                // Model changed to deepseek/deepseek-chat-v3-0324:free as requested
                "model": "deepseek/deepseek-chat-v3-0324:free",
                "messages": [
                    {"role": "system", "content": "אתה עוזר יצירתי שכותב תסריטי קומיקס קצרים ומרתקים."},
                    {"role": "user", "content": promptText}
                ],
                "temperature": 0.7, // Creativity level
                // רמת יצירתיות
                "max_tokens": 500 // Maximum length of the generated script
                // אורך מקסימלי של התסריט שיופק
            })
        });

        const openrouterData = await openrouterResponse.json();

        // Check if the API call was successful
        // בדוק אם הקריאה ל-API הצליחה
        if (!openrouterResponse.ok) {
            console.error("OpenRouter API Error Response:", openrouterData);
            return {
                statusCode: openrouterResponse.status,
                body: JSON.stringify({ error: `OpenRouter API error: ${openrouterData.message || 'Unknown error'}` })
            };
        }

        // Extract the generated script from the OpenRouter response
        // חלץ את התסריט שנוצר מהתשובה של OpenRouter
        generatedScript = openrouterData.choices[0]?.message?.content || "Failed to get script from AI.";

    } catch (error) {
        console.error("Error during OpenRouter API call:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate script due to API call error: " + error.message }) };
    }

    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*', // Ensure this is also present on the successful response
            // וודא שזה קיים גם בתגובה מוצלחת
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ script: generatedScript }),
    };
};
