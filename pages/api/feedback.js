import redis from '../../lib/redis.js';
import { extractIdentifier } from '../../lib/api-utils.js';
import { sanitize } from '../../utils/input-processor.js';

const RATE_LIMIT      = 5;     // max submissions per window
const RATE_WINDOW_SEC = 3600;  // 1 hour

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { text, lang, producerName } = req.body;
  const cleanText = sanitize(text, 500);
  // Strip Telegram MarkdownV1 special chars from the user-supplied name to
  // prevent *bold*, _italic_, `code`, and [link]() injection into the admin chat.
  const cleanName = sanitize(producerName || '', 100).replace(/[*_`[\]()]/g, '');

  if (!cleanText) {
    return res.status(400).json({ message: 'Feedback text is required' });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip = extractIdentifier(req);
  const rateLimitKey = `ratelimit:feedback:${ip}`;

  try {
    const current = await redis.get(rateLimitKey);
    if (current && parseInt(current, 10) >= RATE_LIMIT) {
      return res.status(429).json({ message: 'Too many feedback submissions. Please try again later.' });
    }
    const pipeline = redis.pipeline();
    pipeline.incr(rateLimitKey);
    pipeline.expire(rateLimitKey, RATE_WINDOW_SEC);
    await pipeline.exec();
  } catch (e) {
    // Redis unavailable — fail open so legitimate feedback isn't silently dropped.
    console.warn('Feedback rate-limit check skipped (Redis unavailable):', e.message);
  }

  // ── Forward to Telegram ───────────────────────────────────────────────────
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  const message = `
🎬 *New Director's Note!*
-------------------------
👤 *Producer:* ${cleanName || 'Guest'}
🌐 *Language:* ${lang === 'he' ? 'Hebrew 🇮🇱' : 'English 🇺🇸'}
📝 *Message:*
"${cleanText}"
-------------------------
  `;

  try {
    const telegramRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
    });

    if (telegramRes.ok) {
      return res.status(200).json({ success: true });
    } else {
      const errorData = await telegramRes.json();
      console.error('Telegram error:', errorData);
      return res.status(500).json({ message: 'Failed to send to Telegram' });
    }
  } catch (error) {
    console.error('Feedback API error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
