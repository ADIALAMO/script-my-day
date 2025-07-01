const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  console.log(`Received ${req.method} request to ${req.url}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.post('/api/generateScript', async (req, res) => {
  console.log('POST /api/generateScript received:', req.body);

  const { journalEntry, genre } = req.body;
  if (!journalEntry || !genre) {
    console.error('Missing journalEntry or genre');
    return res.status(400).json({ error: 'Diary entry and genre are required.' });
  }

  try {
    console.log('Calling OpenRouter with model: deepseek/deepseek');
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'deepseek/deepseek',
      messages: [
        {
          role: 'user',
          content: `כתוב תסריט קומיקס קצר בז'אנר ${genre} בהתבסס על הרשומה הבאה: ${journalEntry}`
        }
      ]
    }, {
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    console.log('OpenRouter response:', response.data);
    const script = response.data.choices[0].message.content;
    res.json({ script });
  } catch (error) {
    console.error('Error calling OpenRouter:', error.message, error.response ? error.response.data : {});
    res.status(500).json({ error: 'שגיאה ביצירת התסריט.', details: error.message });
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log(`Server is running on port ${process.env.PORT || 3000}`);
});

module.exports = app;