const axios = require('axios');
require('dotenv').config();

// פונקציה לזיהוי שפה (עברית/אנגלית)
function detectLanguage(text) {
  if (typeof text !== 'string') {
    console.warn('detectLanguage received non-string input:', text);
    return 'en';
  }
  const hebrewPattern = /[\u0590-\u05FF]/;
  return hebrewPattern.test(text) ? 'he' : 'en';
}

// פונקציה להערכת אורך הטקסט
function estimateLength(journalText) {
  if (typeof journalText !== 'string') {
    console.warn('estimateLength received non-string input:', journalText);
    return 'בינוני, עד 20 שורות';
  }
  const wordCount = journalText.trim().split(/\s+/).length;
  if (wordCount <= 10) return 'קצר מאוד, עד 5 שורות';
  if (wordCount <= 30) return 'קצר, עד 10 שורות';
  if (wordCount <= 80) return 'בינוני, עד 20 שורות';
  return 'מפורט, לא יותר מ-500 מילים';
}

module.exports = async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse body (Vercel provides req.body if content-type is application/json)
  const { journalEntry, genre } = req.body || {};
  if (!journalEntry || !genre) {
    return res.status(400).json({ error: 'Journal entry and genre are required.' });
  }

  const lang = detectLanguage(journalEntry);
  const lengthDesc = estimateLength(journalEntry);
  const modelToUse = 'deepseek/deepseek-chat-v3-0324:free';

  const prompt = lang === 'he'
    ? `כתוב תסריט קומיקס מקצועי בעברית, בפורמט ברור ומסודר הכולל:
- כותרות סצנה (למשל: "סצנה 1 – רחוב הומה אדם")
- הוראות בימוי (בשורות נפרדות או בסוגריים)
- שמות דמויות בתחילת כל שורת דיאלוג

התסריט צריך להתבסס על: "${journalEntry}", בז'אנר ${genre}.
התאם את אורך התסריט לאורך הרשומה: אם הרשומה קצרה – תסריט קצר, ואם ארוכה – תסריט מפורט, אך בכל מקרה אל תחרוג מ-500 מילים.
השתדל לשמור על מבנה קומיקס פשוט, מובן וויזואלי.`
    : `Write a professional comic script in English. Use clear formatting:
- Scene titles (e.g., "Scene 1 – A crowded street")
- Stage directions (in separate lines or in parentheses)
- Character names at the beginning of each dialogue line

Base the script on: "${journalEntry}", in the ${genre} genre.
Match the script length to the journal entry: short if the entry is short, longer if detailed – but in any case, no more than 500 words.
Keep it visual, structured, and clear.`;

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: modelToUse,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ]
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