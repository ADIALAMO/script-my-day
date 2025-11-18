// Copyright (c) 2025 adi alamo. All rights reserved.
// Intellectual property of adi alamo. Contact: adialamo@gmail.com

const axios = require('axios');
require('dotenv').config();
const Joi = require('joi'); // ולידציה
const { buildComicScriptPrompt } = require('./buildComicScriptPrompt');
const { generateScript } = require("../lib/story-service");

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
  const modelToUse = 'google/gemma-3n-e4b-it:free';

  let maxTokens = 700;
  const wordCount = trimmedEntry.split(/\s+/).length;
  if (wordCount <= 8) maxTokens = 80;
  else if (wordCount <= 20) maxTokens = 180;
  else if (wordCount <= 50) maxTokens = 350;
  else if (wordCount > 100) maxTokens = 2000; // הגדלת מגבלת טוקנים
  else maxTokens = 1200;

  let prompt;
  if (continueScript) {
    prompt = lang === 'he'
      ? `המשך את התסריט הקומיקס הבא בעברית וסיים אותו בצורה מקצועית, בלי להוסיף סצנות חדשות, רק לסגור את הסיפור. ודא שהתסריט מסתיים בסיום ברור ושלם, אל תקטע אותו באמצע: \n${continueScript}`
      : `Continue and finish the following comic script in English, just to close the story, not to add new scenes. Make sure the script ends with a clear and complete ending, do not cut it off in the middle: \n${continueScript}`;
    maxTokens = 700;
  } else {
    if (lang === 'he' || lang === 'en') {
      // Use the agent's generateScript for both Hebrew and English
      const result = await generateScript(trimmedEntry, genre);
      if (result.success) {
        return res.json({ script: result.output });
      } else {
        return res.status(500).json({ error: result.error || 'Failed to generate script.' });
      }
    } else {
      prompt = wordCount > 50
        ? `Write a professional comic script in English only, based on: "${trimmedEntry}" in the ${genre} genre.\n\n- Turn every event, action, encounter, or character that appears in the user's text into a separate scene in the script.\n- Do not omit any event, action, or character that appears in the text.\n- Arrange the scenes in the order they appear in the text.\n- You may invent characters, names, scenes, and dialogues according to the genre, but the entire script must be based on the events, feelings, and topics that appear in the user's text only.\n- Do not deviate from the plot and feelings of the original text.\n- Finish the script with a clear and complete ending, do not cut it off in the middle. If you have not finished all the events, continue until a clear ending.\n- Write a clear, logical, realistic or imaginative (according to the genre), and flowing script.\n- Every sentence must be in correct English only, with no Hebrew, no transliterations, and no language mixing.\n- Do not invent illogical words, do not use non-existent words, do not use foreign words, abbreviations, or unrelated symbols.\n- Do not write line numbers, do not write the word 'line', do not add titles, introductions, summaries, or comments.\n- Maintain a professional script style: scene descriptions, dialogues, and narration – all in correct English only.\n- Do not use any language other than English.\n- If there is dialogue – write it in the format: Character: "text"\n- If there is a description – write it simply, without unnecessary words.`
        : `Write a professional comic script in English only, based on: "${trimmedEntry}" in the ${genre} genre.\n\n- Turn every event, action, encounter, or character that appears in the user's text into a separate scene in the script.\n- Do not omit any event, action, or character that appears in the text.\n- Arrange the scenes in the order they appear in the text.\n- You may invent characters, names, scenes, and dialogues according to the genre, but the entire script must be based on the events, feelings, and topics that appear in the user's text only.\n- Do not deviate from the plot and feelings of the original text.\n- Finish the script with a clear and complete ending, do not cut it off in the middle. If you have not finished all the events, continue until a clear ending.\n- Write a clear, logical, realistic or imaginative (according to the genre), and flowing script.\n- Every sentence must be in correct English only, with no Hebrew, no transliterations, and no language mixing.\n- Do not invent illogical words, do not use non-existent words, do not use foreign words, abbreviations, or unrelated symbols.\n- Do not write line numbers, do not write the word 'line', do not add titles, introductions, summaries, or comments.\n- Maintain a professional script style: scene descriptions, dialogues, and narration – all in correct English only.\n- Do not use any language other than English.\n- If there is dialogue – write it in the format: Character: "text"\n- If there is a description – write it simply, without unnecessary words.`;
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

    let script = response.data?.choices?.[0]?.message?.content || response.data?.choices?.[0]?.text || '';

    // === Post-process: בדיקת נאמנות לאירועים המקוריים ===
    if (lang === 'he') {
      const originalEvents = trimmedEntry
        .split(/(?<=[.!?])\s+|(?<=,)\s+/)
        .map(e => e.trim())
        .filter(e => e.length > 0);
      let tries = 0;
      let warning = null;
      let panels;
      while (tries < 3) { // ננסה עד 3 פעמים להשיג תסריט שלם
        panels = script
          .split(/פאנל \d+|\*\*פאנל \d+\*\*/g)
          .map(e => e.trim())
          .filter(e => e.length > 0);
        let missingEvents = [];
        for (const event of originalEvents) {
          const found = panels.some(panel => panel.includes(event.slice(0, 8)) || event.slice(0, 8).includes(panel.slice(0, 8)));
          if (!found) missingEvents.push(event);
        }
        if (missingEvents.length === 0 && panels.length >= originalEvents.length) {
          warning = null;
          break; // תסריט שלם
        }
        // אם חסר – נבקש מהמודל להמשיך ולסיים
        tries++;
        const continuePrompt = `המשך את התסריט הקומיקס הבא בעברית וסיים אותו בצורה מקצועית, בלי להוסיף סצנות חדשות, רק לסגור את הסיפור. ודא שכל האירועים המקוריים הופיעו, ושהתסריט מסתיים בסיום ברור ושלם, אל תקטע אותו באמצע:\n${script}`;
        const continueResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
          model: modelToUse,
          messages: [
            { role: 'user', content: continuePrompt }
          ],
          max_tokens: 700
        }, axiosOpts);
        const continueScript = continueResponse.data?.choices?.[0]?.message?.content || continueResponse.data?.choices?.[0]?.text || '';
        script += '\n' + continueScript;
      }
      // אם גם אחרי 3 ניסיונות עדיין חסר – נציג תסריט כמו שהוא (בלי אזהרה למשתמש)
    }

    // בדיקה אם התסריט כנראה לא הסתיים (לא מכיל 'סוף' או קצר מ-400 תווים)
    const isLikelyIncomplete = script && (!/סוף|סיום|END|FINISH/i.test(script) && script.length < 4000);
    let tries = 0;
    while (isLikelyIncomplete && tries < 2) {
      tries++;
      // קריאה נוספת ל-API להמשך התסריט
      const continuePrompt = lang === 'he'
        ? `המשך את התסריט הקומיקס הבא בעברית וסיים אותו בצורה מקצועית, בלי להוסיף סצנות חדשות, רק לסגור את הסיפור. ודא שהתסריט מסתיים בסיום ברור ושלם, אל תקטע אותו באמצע: \n${script}`
        : `Continue and finish the following comic script in English, just to close the story, not to add new scenes. Make sure the script ends with a clear and complete ending, do not cut it off in the middle: \n${script}`;
      const continueResponse = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model: modelToUse,
        messages: [
          { role: 'user', content: continuePrompt }
        ],
        max_tokens: 700
      }, axiosOpts);
      const continueScript = continueResponse.data?.choices?.[0]?.message?.content || continueResponse.data?.choices?.[0]?.text || '';
      script += '\n' + continueScript;
      // בדוק שוב אם יש סוף
      if (/סוף|סיום|END|FINISH/i.test(script) || script.length > 4000) break;
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