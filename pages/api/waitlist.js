import redis from '../../lib/redis.js';
import { extractIdentifier } from '../../lib/api-utils.js';
import { escapeMarkdownV1, maskEmail, sendTelegram } from '../../lib/telegram.js';
import { safeErrInfo, formatSafeErr } from '../../lib/safe-error.js';
import { HONEYPOT_FIELD, normalizeEmail, waitlistKey, buildRecord, serializeRecord } from '../../lib/waitlist.js';

/**
 * POST /api/waitlist  { email, lang, [HONEYPOT_FIELD] }
 *
 * Pro waitlist capture while billing is gated (NEXT_PUBLIC_BILLING_ENABLED=false). One record per address (see lib/waitlist.js), written with SET NX so
 * a repeat signup never overwrites the first record. A duplicate answers EXACTLY like a new signup (no "already on the list" signal). A Redis failure is a
 * retryable 503 — the UI must never show "you're on the list" for something that was not saved. The full address is never logged; Telegram gets the masked form.
 */
const RATE_LIMIT      = 5;     // max submissions per window per IP
const RATE_WINDOW_SEC = 3600;  // 1 hour
const WRITE_TIMEOUT_MS = 4000;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })), ms))]);

/** the signed-in user's id (server-resolved, never from the client); any failure -> null, never blocks a signup */
async function currentUserId(req, res) {
  try {
    const { getSessionAndTier } = await import('../../lib/auth.js');
    const s = await getSessionAndTier(req, res);
    return s?.userId || null;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const body = req.body ?? {};

  // ── Honeypot: a filled hidden field = a bot. Answer like a success, store nothing, tell nobody. ───────────
  const trap = body[HONEYPOT_FIELD];
  if (trap !== undefined && trap !== null && String(trap).trim() !== '') {
    return res.status(200).json({ success: true });
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return res.status(400).json({ code: 'INVALID_EMAIL' });
  }

  // ── Rate limiting (per IP). Fails open: a limiter outage must not block signups. ───────────────────────────
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
    console.warn(`Waitlist rate-limit check skipped (Redis unavailable: ${formatSafeErr(safeErrInfo(e))})`);
  }

  // ── Persist: SET NX (first record wins). Failure = retryable 503, never a fake success. ─────────────────
  const userId = await currentUserId(req, res);
  const record = buildRecord({ email, lang: body.lang, userId });
  let created;
  try {
    const out = await withTimeout(redis.set(waitlistKey(email), serializeRecord(record), { nx: true }), WRITE_TIMEOUT_MS);
    created = out === 'OK' || out === true;
  } catch (e) {
    console.error(`Waitlist persist failed (${formatSafeErr(safeErrInfo(e))})`);
    return res.status(503).json({ code: 'TEMPORARILY_UNAVAILABLE', retryable: true });
  }

  // ── Notify via Telegram (best-effort, masked, only for a NEW address) ──────────────────────────────────
  if (created) {
    await sendTelegram(`🎟️ *New Pro waitlist signup!*\n------------------------\n📧 ${escapeMarkdownV1(maskEmail(email))}\n🌐 ${record.locale === 'he' ? 'Hebrew 🇮🇱' : 'English 🇺🇸'}`);
  }

  return res.status(200).json({ success: true });
}
