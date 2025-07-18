// Copyright (c) 2025 adi alamo. All rights reserved.
// Intellectual property of adi alamo. Contact: adialamo@gmail.com

const axios = require('axios');
require('dotenv').config();

function detectLanguage(text) {
  if (typeof text !== 'string') return 'en';
  const hebrewPattern = /[\u0590-\u05FF]/;
  return hebrewPattern.test(text) ? 'he' : 'en';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { journalEntry, genre, continueScript } = req.body || {};
  if (!journalEntry || !genre) {
    return res.status(400).json({ error: 'Journal entry and genre are required.' });
  }

  const maxInputLength = 300;
  // חיתוך הקלט ל-300 מילים (ולא תווים)
  const words = journalEntry.trim().split(/\s+/).slice(0, maxInputLength);
  const trimmedEntry = words.join(' ');
  const lang = detectLanguage(trimmedEntry);
  const modelToUse = 'deepseek/deepseek-chat-v3-0324:free';

  let maxTokens = 700;
  const wordCount = trimmedEntry.split(/\s+/).length;
  if (wordCount <= 8) maxTokens = 80;
  else if (wordCount <= 20) maxTokens = 180;
  else if (wordCount <= 50) maxTokens = 350;
  else if (wordCount > 100) maxTokens = 1600; // הגדלת מגבלת הפלט לכ-800-1000 מילים

  let prompt;
  if (continueScript) {
    prompt = lang === 'he'
      ? `המשך את התסריט הקומיקס הבא בעברית וסיים אותו בצורה מקצועית, בלי להוסיף סצנות חדשות, רק לסגור את הסיפור: \n${continueScript}`
      : `Continue and finish the following comic script in English, just to close the story, not to add new scenes: \n${continueScript}`;
    maxTokens = 300;
  } else {
    if (lang === 'he') {
      prompt = wordCount > 50
        ? `כתוב תסריט קומיקס מפורט בעברית על פי הטקסט הבא: "${trimmedEntry}" בז'אנר ${genre}. שמור על מבנה ברור, הוסף דיאלוגים, תאר סצנות, וכתוב לפחות 10-15 שורות. אל תוסיף הערות מיותרות. נסח את התסריט עד 800 מילים לכל היותר. סיים את התסריט בצורה ברורה, אל תקטע אותו באמצע.`
        : `כתוב תסריט קומיקס קצר בעברית על פי הטקסט הבא: "${trimmedEntry}" בז'אנר ${genre}. שמור על מבנה פשוט וברור. אם הסיפור קצר, כתוב תסריט של 3-5 משפטים בלבד. אל תוסיף הערות מיותרות. סיים את התסריט בצורה ברורה, אל תקטע אותו באמצע.`;
    } else {
      prompt = wordCount > 50
        ? `Write a detailed comic script in English based on: "${trimmedEntry}" in the ${genre} genre. Use clear structure, add dialogues, describe scenes, and write at most 800 words. Do not add unnecessary comments. Make sure to finish the script with a clear ending, do not cut it off in the middle.`
        : `Write a short comic script in English based on: "${trimmedEntry}" in the ${genre} genre. Keep it simple and clear. If the story is short, write a script of only 3-5 sentences. Do not add unnecessary comments. Make sure to finish the script with a clear ending, do not cut it off in the middle.`;
    }
  }

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: modelToUse,
      messages: [
        { role: 'user', content: prompt }
      ],
      max_tokens: maxTokens
    }, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    const script = response.data.choices[0].message.content;
    res.json({ script });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate script.', details: error.message });
  }
};