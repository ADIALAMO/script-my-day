// netlify/functions/generateScript.cjs

// ננסה להסתמך על fetch הגלובלי ב-Node.js.
// אם עדיין תהיה שגיאת 'fetch is not a function', נחזור לייבוא מפורש.
// If 'fetch is not a function' error persists, we will revert to explicit import.

exports.handler = async (event, context) => {
    // Log the incoming HTTP method for debugging
    console.log(`Incoming HTTP method: ${event.httpMethod}`);

    // Handle OPTIONS method for CORS preflight requests
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

    // 1. Ensure this is a POST request with a valid body
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
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

        if (!OPENROUTER_API_KEY) {
            console.error("OPENROUTER_API_KEY is not configured in Netlify Environment Variables (or .env locally).");
            return { statusCode: 500, body: JSON.stringify({ error: 'OpenRouter API key is not configured.' }) };
        }

        const promptText = `צור תסריט קומיקס בסגנון ${genre} על בסיס יומן זה: "${diaryEntry}".
                            התסריט צריך להיות בשפה ${lang === 'he' ? 'עברית' : 'אנגלית'} ויש לכלול דיאלוגים קצרים ומרתקים, ותיאורי סצנות חזותיים.
                            התחל את התסריט בכותרת הסצנה (לדוגמה: "סצנה 1: חדר המגורים - בוקר").`;

        // The line that caused the error:
        // Problematic: const openrouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        // Attempt to fix `fetch2 is not a function`:
        // 1. Remove explicit `require('node-fetch')` from the top of the file
        // 2. If the error persists, try directly accessing the default export of node-fetch if that's the issue,
        //    but for now, assuming global fetch.

        // Make the call to the OpenRouter API
        // ביצוע קריאה ל-OpenRouter API
        const openrouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                "model": "google/gemma-3-4b",
                "messages": [
                    {"role": "system", "content": "אתה עוזר יצירתי שכותב תסריטי קומיקס קצרים ומרתקים."},
                    {"role": "user", "content": promptText}
                ],
                "temperature": 0.7,
                "max_tokens": 500
            })
        });

        const openrouterData = await openrouterResponse.json();

        if (!openrouterResponse.ok) {
            console.error("OpenRouter API Error Response:", openrouterData);
            return {
                statusCode: openrouterResponse.status,
                body: JSON.stringify({ error: `OpenRouter API error: ${openrouterData.message || 'Unknown error'}` })
            };
        }

        generatedScript = openrouterData.choices[0]?.message?.content || "Failed to get script from AI.";

    } catch (error) {
        console.error("Error during OpenRouter API call:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate script due to API call error: " + error.message }) };
    }

    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*',
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ script: generatedScript }),
    };
};
