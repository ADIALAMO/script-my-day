export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { text, lang, producerName } = req.body;

  if (!text) {
    return res.status(400).json({ message: 'Feedback text is required' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  // עיצוב ההודעה שתגיע אליך לטלגרם
  const message = `
🎬 *New Director's Note!*
-------------------------
👤 *Producer:* ${producerName || 'Guest'}
🌐 *Language:* ${lang === 'he' ? 'Hebrew 🇮🇱' : 'English 🇺🇸'}
📝 *Message:*
"${text}"
-------------------------
  `;

  try {
    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });

    if (telegramRes.ok) {
      return res.status(200).json({ success: true });
    } else {
      const errorData = await telegramRes.json();
      console.error('Telegram Error:', errorData);
      return res.status(500).json({ message: 'Failed to send to Telegram' });
    }
  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}