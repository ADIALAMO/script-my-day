// netlify/functions/generateScript.cjs

// Explicitly import fetch for local Node.js environment.
// Ensure 'node-fetch' is installed in your project: npm install node-fetch
// This specifically imports the 'default' export of node-fetch, which helps resolve
// 'fetch is not a function' or 'fetch2 is not a function' errors in some environments.
const fetch = require('node-fetch').default;

exports.handler = async (event, context) => {
    // Log the incoming HTTP method for debugging purposes.
    console.log(`Incoming HTTP method: ${event.httpMethod}`);

    // Handle OPTIONS method for CORS preflight requests.
    // This is crucial for web browsers to allow cross-origin requests.
    if (event.httpMethod === 'OPTIONS') {
        console.log('Handling OPTIONS preflight request.');
        return {
            statusCode: 200,
            headers: {
                // IMPORTANT: In production, consider restricting 'Access-Control-Allow-Origin'
                // to your actual frontend domain (e.g., 'https://your-domain.netlify.app')
                'Access-Control-Allow-Origin': '*', // Allows requests from any origin
                'Access-Control-Allow-Methods': 'POST, GET, OPTIONS', // Allowed HTTP methods
                'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Allowed request headers
                'Access-Control-Max-Age': '86400', // Cache preflight response for 24 hours
            },
            body: '' // No content needed for OPTIONS preflight
        };
    }

    // 1. Ensure this is a POST request and has a valid body.
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

        // Ensure all required parameters are present.
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
        // Access the API key from Netlify Environment Variables (or .env locally).
        const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

        // Log to verify if the API key is being loaded correctly in Netlify logs.
        // This log will show 'true' and its length if the key is present.
        console.log(`OpenRouter API Key defined: ${!!OPENROUTER_API_KEY}. Length: ${OPENROUTER_API_KEY ? OPENROUTER_API_KEY.length : 0}`);


        if (!OPENROUTER_API_KEY) {
            console.error("OPENROUTER_API_KEY is not configured in Netlify Environment Variables (or .env locally).");
            return { statusCode: 500, body: JSON.stringify({ error: 'OpenRouter API key is not configured.' }) };
        }

        // Construct the prompt for the AI model based on user input.
        const promptText = `Create a comic script in the ${genre} genre based on this diary entry: "${diaryEntry}".
                            The script should be in ${lang === 'he' ? 'Hebrew' : 'English'} and include short, engaging dialogues, and visual scene descriptions.
                            Start the script with a scene heading (e.g., "SCENE 1: LIVING ROOM - MORNING").`;


        // Make the API call to OpenRouter.
        const openrouterResponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                // Using the requested Deepseek model.
                "model": "deepseek/deepseek-chat-v3-0324:free",
                "messages": [
                    {"role": "system", "content": "You are a creative assistant that writes short, engaging comic scripts."},
                    {"role": "user", "content": promptText}
                ],
                "temperature": 0.7, // Controls creativity (0.0-1.0)
                "max_tokens": 500 // Maximum length of the generated script
            })
        });

        const openrouterData = await openrouterResponse.json();

        // Check if the API call was successful (status 2xx).
        if (!openrouterResponse.ok) {
            console.error("OpenRouter API Error Response:", openrouterData);
            return {
                statusCode: openrouterResponse.status,
                body: JSON.stringify({ error: `OpenRouter API error: ${openrouterData.message || 'Unknown error'}` })
            };
        }

        // Extract the generated script from the API response.
        generatedScript = openrouterData.choices[0]?.message?.content || "Failed to get script from AI.";

    } catch (error) {
        console.error("Error during OpenRouter API call:", error);
        return { statusCode: 500, body: JSON.stringify({ error: "Failed to generate script due to API call error: " + error.message }) };
    }

    // Return the generated script to the frontend.
    return {
        statusCode: 200,
        headers: {
            'Access-Control-Allow-Origin': '*', // Ensure this is also present on the successful response for CORS
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ script: generatedScript }),
    };
};
