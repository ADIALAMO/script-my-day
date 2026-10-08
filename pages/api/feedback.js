import redis from '../../lib/redis.js';
import { extractIdentifier } from '../../lib/api-utils.js';
import { sanitize } from '../../utils/input-processor.js';
import { escapeMarkdownV1, sendTelegram } from '../../lib/telegram.js';

const RATE_LIMIT      = 5;     // max submissions per window
const RATE_WINDOW_SEC = 3600;  // 1 hour

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { text, lang, producerName } = req.body;
  const cleanText = sanitize(text, 500);
  const cleanName = sanitize(producerName || '', 100);

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
  // Every user-supplied value is escaped so it can't inject Markdown into the
  // admin chat or make Telegram reject the whole message.
  const message = `
🎬 *New Director's Note!*
-------------------------
👤 *Producer:* ${escapeMarkdownV1(cleanName) || 'Guest'}
🌐 *Language:* ${lang === 'he' ? 'Hebrew 🇮🇱' : 'English 🇺🇸'}
📝 *Message:*
"${escapeMarkdownV1(cleanText)}"
-------------------------
  `;

  const { ok } = await sendTelegram(message);
  if (ok) return res.status(200).json({ success: true });
  return res.status(500).json({ message: 'Failed to send to Telegram' });
}
