// Copyright (c) 2025 adi alamo. All rights reserved.
// Intellectual property of adi alamo. Contact: adialamo@gmail.com

const axios = require('axios');
require('dotenv').config();
const Joi = require('joi'); // ולידציה

function detectLanguage(text) {
  if (typeof text !== 'string') return 'en';
  const hebrewPattern = /[\u0590-\u05FF]/;
  return hebrewPattern.test(text) ? 'he' : 'en';
}

// סכימת ולידציה
const schema = Joi.object({
  journalEntry: Joi.string().min(3).max(3000).required(),
  genre: Joi.string().min(2).max(40).required(),
  continueScript: Joi.string().allow('').optional()
});

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Ensure API key is present - common cause for 500/401
  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || process.env.OPENROUTER_KEY || null;
  if (!OPENROUTER_API_KEY) {
    console.error('Missing OPENROUTER_API_KEY environment variable');
    return res.status(500).json({ error: 'Server configuration error: missing API key (OPENROUTER_API_KEY).' });
  }

  // ולידציה
  const { error, value } = schema.validate(req.body || {});
  if (error) {
    return res.status(400).json({ error: 'Invalid input', details: error.details });
  }
  const { journalEntry, genre, continueScript } = value;

  const maxInputLength = 300;
  const words = journalEntry.trim().split(/\s+/).slice(0, maxInputLength);
  const trimmedEntry = words.join(' ');
  const lang = detectLanguage(trimmedEntry);
  const modelToUse = 'qwen/qwen3-vl-32b-instruct';

  let maxTokens = 700;
  const wordCount = trimmedEntry.split(/\s+/).length;
  if (wordCount <= 8) maxTokens = 80;
  else if (wordCount <= 20) maxTokens = 180;
  else if (wordCount <= 50) maxTokens = 350;
  else if (wordCount > 100) maxTokens = 1600;

  let prompt;
  if (continueScript) {
    prompt = lang === 'he'
      ? `המשך את התסריט הקומיקס הבא בעברית וסיים אותו בצורה מקצועית, בלי להוסיף סצנות חדשות, רק לסגור את הסיפור: \n${continueScript}`
      : `Continue and finish the following comic script in English, just to close the story, not to add new scenes: \n${continueScript}`;
    maxTokens = 300;
  } else {
    if (lang === 'he') {
      prompt = wordCount > 50
        ? `כתוב תסריט קומיקס מקצועי בעברית בלבד, על פי הטקסט הבא:\n"${trimmedEntry}"\nבז'אנר: ${genre}.\n\n- כתוב תסריט ברור, מובן, הגיוני, וזורם.\n- כל משפט חייב להיות בעברית תקינה בלבד, ללא מילים באנגלית, ללא תעתיקים, וללא ערבוב שפות.\n- אל תמציא מילים, אל תשתמש במילים לא קיימות, אל תשתמש במילים לועזיות, קיצורים, או סימנים לא שייכים.\n- אל תכתוב מספרי שורות, אל תכתוב את המילה "שורה", אל תוסיף כותרות, הקדמות, סיכומים, או הערות.\n- כל שורה בתסריט צריכה להיות הגיונית, ריאליסטית, וקשורה לעלילה.\n- שמור על סגנון תסריט מקצועי: תיאור סצנות, דיאלוגים, ותיאורים – הכל בעברית תקינה בלבד.\n- אל תשתמש בשום שפה אחרת מלבד עברית.\n- אם יש דיאלוג – כתוב אותו בפורמט: דמות: "הטקסט"\n- אם יש תיאור – כתוב אותו בפשטות, ללא מילים מיותרות.\n- סיים את התסריט בצורה ברורה ושלמה, ללא קטעים חסרים.`
        : `כתוב תסריט קומיקס מקצועי בעברית בלבד, על פי הטקסט הבא:\n"${trimmedEntry}"\nבז'אנר: ${genre}.\n\n- כתוב תסריט ברור, מובן, הגיוני, וזורם.\n- כל משפט חייב להיות בעברית תקינה בלבד, ללא מילים באנגלית, ללא תעתיקים, וללא ערבוב שפות.\n- אל תמציא מילים, אל תשתמש במילים לא קיימות, אל תשתמש במילים לועזיות, קיצורים, או סימנים לא שייכים.\n- אל תכתוב מספרי שורות, אל תכתוב את המילה "שורה", אל תוסיף כותרות, הקדמות, סיכומים, או הערות.\n- כל שורה בתסריט צריכה להיות הגיונית, ריאליסטית, וקשורה לעלילה.\n- שמור על סגנון תסריט מקצועי: תיאור סצנות, דיאלוגים, ותיאורים – הכל בעברית תקינה בלבד.\n- אל תשתמש בשום שפה אחרת מלבד עברית.\n- אם יש דיאלוג – כתוב אותו בפורמט: דמות: "הטקסט"\n- אם יש תיאור – כתוב אותו בפשטות, ללא מילים מיותרות.\n- סיים את התסריט בצורה ברורה ושלמה, ללא קטעים חסרים.`;
    } else {
      prompt = wordCount > 50
        ? `Write a professional comic script in English only, based on: "${trimmedEntry}" in the ${genre} genre.\n\n- Write a clear, logical, and flowing script.\n- Every sentence must be in correct English only, with no Hebrew, no transliterations, and no language mixing.\n- Do not invent words, do not use non-existent words, do not use foreign words, abbreviations, or unrelated symbols.\n- Do not write line numbers, do not write the word 'line', do not add titles, introductions, summaries, or comments.\n- Every line in the script must be logical, realistic, and relevant to the plot.\n- Maintain a professional script style: scene descriptions, dialogues, and narration – all in correct English only.\n- Do not use any language other than English.\n- If there is dialogue – write it in the format: Character: "text"\n- If there is a description – write it simply, without unnecessary words.\n- Finish the script with a clear and complete ending, with no missing parts.`
        : `Write a professional comic script in English only, based on: "${trimmedEntry}" in the ${genre} genre.\n\n- Write a clear, logical, and flowing script.\n- Every sentence must be in correct English only, with no Hebrew, no transliterations, and no language mixing.\n- Do not invent words, do not use non-existent words, do not use foreign words, abbreviations, or unrelated symbols.\n- Do not write line numbers, do not write the word 'line', do not add titles, introductions, summaries, or comments.\n- Every line in the script must be logical, realistic, and relevant to the plot.\n- Maintain a professional script style: scene descriptions, dialogues, and narration – all in correct English only.\n- Do not use any language other than English.\n- If there is dialogue – write it in the format: Character: "text"\n- If there is a description – write it simply, without unnecessary words.\n- Finish the script with a clear and complete ending, with no missing parts.`;
    }
  }

  try {
    // Set reasonable timeout to avoid hanging serverless function
    const axiosOpts = {
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: 20000 // 20s
    };

    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: modelToUse,
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens
    }, axiosOpts);

    // Defensive checks on response shape
    if (!response || !response.data) {
      console.error('Empty response from OpenRouter:', response);
      return res.status(502).json({ error: 'Bad gateway: empty response from upstream API.' });
    }

    const script = response.data?.choices?.[0]?.message?.content || response.data?.choices?.[0]?.text || '';
    if (!script) {
      console.error('No script returned from API:', response.data);
      return res.status(502).json({ error: 'No script returned from API', details: response.data });
    }

    res.json({ script });
  } catch (error) {
    // Improve logging for easier debugging
    console.error('API error status:', error?.response?.status);
    console.error('API error data:', error?.response?.data || error.message);

    // If upstream returned a status, forward meaningful info (but avoid leaking secrets)
    const upstream = error?.response;
    if (upstream && upstream.status) {
      return res.status(502).json({ error: 'Upstream API error', status: upstream.status, details: upstream.data });
    }

    // Fallback generic error
    res.status(500).json({ error: 'Failed to generate script.', details: error.message });
  }
};