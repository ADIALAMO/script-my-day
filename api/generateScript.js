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

  const { journalEntry, genre } = req.body || {};
  if (!journalEntry || !genre) {
    return res.status(400).json({ error: 'Journal entry and genre are required.' });
  }

  // הגבלת אורך קלט
  const maxInputLength = 300;
  const trimmedEntry = journalEntry.trim().slice(0, maxInputLength);

  const lang = detectLanguage(trimmedEntry);
  const modelToUse = 'deepseek/deepseek-chat-v3-0324:free';

  // פרומפט מקוצר
  const prompt = lang === 'he'
    ? `כתוב תסריט קומיקס קצר בעברית על פי הטקסט הבא: "${trimmedEntry}" בז'אנר ${genre}. שמור על מבנה פשוט וברור.`
    : `Write a short comic script in English based on: "${trimmedEntry}" in the ${genre} genre. Keep it simple and clear.`;

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: modelToUse,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: 350 // הגבלת אורך תשובה
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