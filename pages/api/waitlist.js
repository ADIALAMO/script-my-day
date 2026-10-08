import redis from '../../lib/redis.js';
import { extractIdentifier } from '../../lib/api-utils.js';
import { escapeMarkdownV1, sendTelegram } from '../../lib/telegram.js';

/**
 * POST /api/waitlist  { email, lang }
 *
 * Pro waitlist capture while billing is gated (NEXT_PUBLIC_BILLING_ENABLED=false).
 * Stores the email in Redis and pings Telegram so we have a warm list to convert
 * the day Stripe goes Live. Fails open on Redis hiccups — capturing interest is
 * best-effort and must never hard-error in the user's face.
 */
const RATE_LIMIT      = 5;     // max submissions per window per IP
const RATE_WINDOW_SEC = 3600;  // 1 hour
const EMAIL_RE        = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { email, lang } = req.body ?? {};
  const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';

  if (!clean || clean.length > 254 || !EMAIL_RE.test(clean)) {
    return res.status(400).json({ code: 'INVALID_EMAIL' });
  }

  // ── Rate limiting (per IP) ──────────────────────────────────────────────────
  const ip = extractIdentifier(req);
  const rateLimitKey = `ratelimit:waitlist:${ip}`;
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
    console.warn('Waitlist rate-limit check skipped (Redis unavailable):', e.message);
  }

  // ── Persist (one key per email; no expiry) ──────────────────────────────────
  let alreadyOnList = false;
  try {
    const key = `waitlist:${clean}`;
    const existed = await redis.get(key);
    alreadyOnList = !!existed;
    if (!existed) await redis.set(key, Date.now());
  } catch (e) {
    console.warn('Waitlist persist skipped (Redis unavailable):', e.message);
  }

  // ── Notify via Telegram (best-effort) ───────────────────────────────────────
  if (!alreadyOnList) {
    await sendTelegram(`🎟️ *New Pro waitlist signup!*\n------------------------\n📧 ${escapeMarkdownV1(clean)}\n🌐 ${lang === 'he' ? 'Hebrew 🇮🇱' : 'English 🇺🇸'}`);
  }

  return res.status(200).json({ success: true, alreadyOnList });
}
