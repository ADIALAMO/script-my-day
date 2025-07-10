// Copyright (c) 2025 adi alamo. All rights reserved.
// This file and all related source code are the intellectual property of adi alamo.
// Unauthorized copying, distribution, or use of this code or its concept is strictly prohibited.
// For license details, see the LICENSE file in the project root.
// Contact: adialamo@gmail.com

const axios = require('axios');
require('dotenv').config();

function detectLanguage(text) {
  if (typeof text !== 'string') {
    return 'en';
  }
  const hebrewPattern = /[\u0590-\u05FF]/;
  return hebrewPattern.test(text) ? 'he' : 'en';
}

function estimateLength(journalText) {
  if (typeof journalText !== 'string') {
    return 'בינוני, עד 20 שורות';
  }
  const wordCount = journalText.trim().split(/\s+/).length;
  if (wordCount <= 10) return 'קצר מאוד, עד 5 שורות';
  if (wordCount <= 30) return 'קצר, עד 10 שורות';
  if (wordCount <= 80) return 'בינוני, עד 20 שורות';
  return 'מפורט, לא יותר מ-500 מילים';
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { journalEntry, genre, continueScript } = req.body || {};
  if (!journalEntry || !genre) {
    return res.status(400).json({ error: 'Journal entry and genre are required.' });
  }

  // הגבלת אורך קלט
  const maxInputLength = 300;
  const trimmedEntry = journalEntry.trim().slice(0, maxInputLength);

  const lang = detectLanguage(trimmedEntry);
  const modelToUse = 'deepseek/deepseek-chat-v3-0324:free';

  // קביעת max_tokens דינמית לפי אורך הקלט
  let maxTokens = 700;
  const wordCount = trimmedEntry.split(/\s+/).length;
  if (wordCount <= 8) maxTokens = 80; // סיפור קצר מאוד
  else if (wordCount <= 20) maxTokens = 180;
  else if (wordCount <= 50) maxTokens = 350;
  // אחרת, ברירת מחדל 700

  // פרומפט מקוצר
  let prompt;
  if (continueScript) {
    prompt = lang === 'he'
      ? `המשך את התסריט הקומיקס הבא בעברית וסיים אותו בצורה מקצועית, בלי להוסיף סצנות חדשות, רק לסגור את הסיפור: \n${continueScript}`
      : `Continue and finish the following comic script in English, just to close the story, not to add new scenes: \n${continueScript}`;
    maxTokens = 300;
  } else {
    prompt = lang === 'he'
      ? `כתוב תסריט קומיקס קצר בעברית על פי הטקסט הבא: "${trimmedEntry}" בז'אנר ${genre}. שמור על מבנה פשוט וברור. אם הסיפור קצר, כתוב תסריט של 3-5 משפטים בלבד.`
      : `Write a short comic script in English based on: "${trimmedEntry}" in the ${genre} genre. Keep it simple and clear. If the story is short, write a script of only 3-5 sentences.`;
  }

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: modelToUse,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: maxTokens // הגבלת אורך תשובה דינמית
    }, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    const script = response.data.choices[0].message.content;
    res.json({ script });
  } catch (error) {
    if (error.response) {
      console.error('OpenRouter error response data:', error.response.data);
      console.error('OpenRouter error response status:', error.response.status);
    }
    res.status(500).json({ error: 'Failed to generate script.', details: error.message });
  }
};