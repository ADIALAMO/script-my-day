import redis from '../../lib/redis.js';
import { extractIdentifier } from '../../lib/api-utils.js';
import { sanitize } from '../../utils/input-processor.js';

/**
 * POST /api/request-deletion  { email, note, lang }
 *
 * Account/data deletion request intake for the /data-deletion page (Google Play
 * Account & Data Deletion policy requires an accessible URL, not just an email
 * address). This does NOT delete anything automatically — it logs the request
 * and pings the admin Telegram so it can be verified and processed by hand,
 * the same trust boundary as the existing email-based flow in the Privacy
 * Policy, just reachable via a real page instead of a mailto: link.
 * Fails open on Redis hiccups — capturing the request must never hard-error.
 */
const RATE_LIMIT      = 5;     // max submissions per window per IP
const RATE_WINDOW_SEC = 3600;  // 1 hour
const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { email, note, lang } = req.body ?? {};
  const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';
  const cleanNote = sanitize(note || '', 500);

  if (!clean || clean.length > 254 || !EMAIL_RE.test(clean)) {
    return res.status(400).json({ code: 'INVALID_EMAIL' });
  }

  // ── Rate limiting (per IP) ──────────────────────────────────────────────────
  const ip = extractIdentifier(req);
  const rateLimitKey = `ratelimit:deletion:${ip}`;
  try {
    const current = await redis.get(rateLimitKey);
    if (current && parseInt(current, 10) >= RATE_LIMIT) {
      return res.status(429).json({ code: 'RATE_LIMITED' });
    }
    const pipeline = redis.pipeline();
    pipeline.incr(rateLimitKey);
    pipeline.expire(rateLimitKey, RATE_WINDOW_SEC);
    await pipeline.exec();
  } catch (e) {
    console.warn('Deletion rate-limit check skipped (Redis unavailable):', e.message);
  }

  // ── Log the request (one key per submission; kept 30 days for audit) ───────
  try {
    const key = `deletion-request:${clean}:${Date.now()}`;
    await redis.set(key, JSON.stringify({ email: clean, note: cleanNote, ip, ts: Date.now() }), { ex: 30 * 86400 });
  } catch (e) {
    console.warn('Deletion request log skipped (Redis unavailable):', e.message);
  }

  // ── Notify via Telegram (best-effort) ───────────────────────────────────────
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;
  if (botToken && chatId) {
    const message = `🗑️ *Data deletion request!*\n------------------------\n📧 ${clean}\n🌐 ${lang === 'he' ? 'Hebrew 🇮🇱' : 'English 🇺🇸'}${cleanNote ? `\n📝 ${cleanNote}` : ''}`;
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
      });
    } catch (e) {
      console.warn('Deletion Telegram notify failed:', e.message);
    }
  }

  return res.status(200).json({ success: true });
}
