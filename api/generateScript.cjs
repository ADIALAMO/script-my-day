// api/generateScript.cjs

const axios = require('axios'); // ייבוא axios בשיטת CommonJS

exports.handler = async (event, context) => {
    // רשום את שיטת ה-HTTP הנכנסת לצרכי דיבוג
    console.log(`Incoming HTTP method: ${event.httpMethod}`);
    console.log(`Request Path: ${event.path}`); // הוספת לוג לנתיב הבקשה

    // טיפול בבקשות OPTIONS עבור בדיקות Preflight של CORS
    if (event.httpMethod === 'OPTIONS') {
        console.log('Handling OPTIONS preflight request.');
        return {
            statusCode: 200,
            headers: {
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
        console.log('Attempting to parse request body...');
        const requestBody = JSON.parse(event.body);
        console.log('Request body parsed successfully.');
        console.log('Parsed body content:', JSON.stringify(requestBody)); // לוג תוכן גוף הבקשה המנותח

        diaryEntry = requestBody.diaryEntry;
        genre = requestBody.genre;
        lang = requestBody.lang;

        // וודא שכל הנתונים הנדרשים קיימים
        if (!diaryEntry || !genre || !lang) {
            console.log('Missing required data in request body.');
            return { statusCode: 400, body: JSON.stringify({ error: 'Missing diary entry, genre, or language in request.' }) };
        }
        console.log(`Received diaryEntry length: ${diaryEntry.length}, genre: ${genre}, lang: ${lang}`);


    } catch (error) {
        console.error("Error parsing request body:", error);
        // הוסף לוג עבור גוף הבקשה המקורי אם הניתוח נכשל
        console.error("Original request body:", event.body);
        return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON in request body.' }) };
    }

    let generatedScript = "";

    try {
        // ניגש למפתח ה-API ממשתני הסביבה של Vercel.
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

        console.log(`OpenRouter API Key defined: ${!!OPENROUTER_API_KEY}. Length: ${OPENROUTER_API_KEY ? OPENROUTER_API_KEY.length : 0}`);

        if (!OPENROUTER_API_KEY) {
            console.error("OPENROUTER_API_KEY is not configured in Vercel Environment Variables.");
            return { statusCode: 500, body: JSON.stringify({ error: 'OpenRouter API key is not configured.' }) };
        }

        // בניית הפרומפט למודל ה-AI
        const promptText = `Create a comic script in the ${genre} genre based on this diary entry: "${diaryEntry}".
                            The script should be in ${lang === 'he' ? 'Hebrew' : 'English'} and include short, engaging dialogues, and visual scene descriptions.
                            Start the script with a scene heading (e.g., "SCENE 1: LIVING ROOM - MORNING").`;

        console.log('Sending request to OpenRouter API...');
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
        console.log('Received response from OpenRouter API.');

        generatedScript = openrouterResponse.data.choices[0]?.message?.content || "Failed to get script from AI.";
        console.log('Generated script content (first 100 chars):', generatedScript.substring(0, 100));

    } catch (error) {
        if (error.response) {
            console.error("OpenRouter API Error Response (Axios):", error.response.status, error.response.data);
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
            'Access-Control-Allow-Origin': '*',
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ script: generatedScript }),
    };
};
