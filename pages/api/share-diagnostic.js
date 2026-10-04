import redis from '../../lib/redis.js';
import { extractIdentifier } from '../../lib/api-utils.js';

/**
 * TEMPORARY diagnostic endpoint for the Android native-share investigation.
 * See utils/share-diagnostics.js for the client side. Grep "TEMP DIAGNOSTIC
 * (share-bug)" across the repo to find everything to remove once this
 * investigation is closed — this route included.
 *
 * POST /api/share-diagnostic { surface, outcome, steps, error, extra,
 *   platform, appVersion, appBuild, userAgent }
 *
 * Fire-and-forget by design from the client — forwards straight to the admin
 * Telegram (same pattern as feedback.js / request-deletion.js). No dedicated
 * error-tracking service is installed, and this is explicitly temporary, so
 * Telegram is the fastest path to real signal without new infrastructure.
 * Nothing is persisted beyond the rate-limit counter below.
 */
const RATE_LIMIT      = 20;    // generous — a tester may retry several times
const RATE_WINDOW_SEC = 3600;  // 1 hour

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  const { surface, outcome, steps, error, extra, platform, appVersion, appBuild, userAgent } = req.body || {};
  if (!surface || !outcome) {
    return res.status(400).json({ message: 'surface and outcome are required' });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip = extractIdentifier(req);
  const rateLimitKey = `ratelimit:share-diagnostic:${ip}`;
  try {
    const current = await redis.get(rateLimitKey);
    if (current && parseInt(current, 10) >= RATE_LIMIT) {
      return res.status(429).json({ message: 'Too many reports' });
    }
    const pipeline = redis.pipeline();
    pipeline.incr(rateLimitKey);
    pipeline.expire(rateLimitKey, RATE_WINDOW_SEC);
    await pipeline.exec();
  } catch (e) {
    console.warn('share-diagnostic rate-limit check skipped (Redis unavailable):', e.message);
  }

  // ── Forward to Telegram ───────────────────────────────────────────────────
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  const stepsLine = Array.isArray(steps) && steps.length
    ? steps.map(s => `${s.step} (+${s.ms}ms)`).join(' → ')
    : '—';
  const errorLine = error ? `${error.name || 'Error'}: ${error.message || ''}` : '—';
  const extraLine = extra ? JSON.stringify(extra) : '—';

  const message = `
🔬 *Share Diagnostic (temp — Android investigation)*
-------------------------
🎯 *Surface:* ${surface}
📍 *Outcome:* ${outcome}
📱 *Platform:* ${platform || '?'}  ·  *App:* ${appVersion || '?'} (build ${appBuild || '?'})
🪜 *Steps:* ${stepsLine}
❌ *Error:* ${errorLine}
📦 *Extra:* ${extraLine}
🧬 *UA:* ${userAgent || '?'}
-------------------------
  `;

  try {
    if (botToken && chatId) {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: 'Markdown' }),
      });
    }
  } catch (e) {
    console.error('share-diagnostic Telegram forward failed:', e.message);
    // Still 200 — this is a fire-and-forget diagnostic, never worth a client-visible error.
  }

  return res.status(200).json({ success: true });
}
