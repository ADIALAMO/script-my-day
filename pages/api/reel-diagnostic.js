import redis from '../../lib/redis.js';
import { extractIdentifier } from '../../lib/api-utils.js';

/**
 * TEMP DIAGNOSTIC (reel-crash) — see utils/reel-diagnostics.js for the client
 * side. Grep "TEMP DIAGNOSTIC (reel-crash)" to find everything to remove
 * once this investigation is closed — this route included.
 *
 * POST /api/reel-diagnostic { flag: 'finished'|'error'|'cancelled'|'recovered-after-kill', trail }
 *
 * Fire-and-forget (sendBeacon) — forwards to the admin Telegram, same
 * pattern as feedback.js / the now-removed share-diagnostic.js. The client
 * only ever sends ONE message per reel attempt (not one per breadcrumb
 * stage — see reelBreadcrumb's doc comment), so this stays well within the
 * rate limit even with many testers.
 */

// A breadcrumb trail is metadata only (stage names, timestamps, byte counts,
// booleans) — never user content — so it should never come close to this.
// Guards against a malformed/abusive payload, not a real limit.
export const config = {
  api: { bodyParser: { sizeLimit: '20kb' } },
};

const RATE_LIMIT      = 20;
const RATE_WINDOW_SEC = 3600;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // navigator.sendBeacon(url, <string>) sends Content-Type: text/plain — Next's
  // default body parser only JSON-parses recognized content types, so req.body
  // arrives as the raw string in that case, not an object. The client now sends
  // a Blob with an explicit application/json type instead (which parses
  // normally), but this handles any already-deployed client still sending the
  // old shape, and any other caller that sends text/plain.
  let parsedBody = req.body;
  if (typeof parsedBody === 'string') {
    if (parsedBody.length > 20_000) {
      return res.status(413).json({ message: 'Payload too large' });
    }
    try {
      parsedBody = JSON.parse(parsedBody);
    } catch {
      return res.status(400).json({ message: 'Invalid JSON body' });
    }
  }

  const { flag, trail } = parsedBody || {};
  if (!flag || !trail) {
    return res.status(400).json({ message: 'flag and trail are required' });
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  const ip = extractIdentifier(req);
  const rateLimitKey = `ratelimit:reel-diagnostic:${ip}`;
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
    console.warn('reel-diagnostic rate-limit check skipped (Redis unavailable):', e.message);
  }

  // ── Forward to Telegram ───────────────────────────────────────────────────
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;

  const stepsLine = Array.isArray(trail.steps) && trail.steps.length
    ? trail.steps.map((s) => {
        const mem = s.memory
          ? ` heap=${Math.round(s.memory.usedJSHeapSize / 1e6)}/${Math.round(s.memory.jsHeapSizeLimit / 1e6)}MB`
          : '';
        const bits = Object.entries(s)
          .filter(([k]) => !['stage', 'ts', 'memory'].includes(k))
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join(' ');
        return `${s.stage}${mem}${bits ? ' ' + bits : ''}`;
      }).join('\n')
    : '—';

  const message = `
🎬 *Reel Diagnostic (temp — crash investigation)*
-------------------------
🏷 *Flag:* ${flag}
🆔 *Session:* ${trail.sessionId || '?'}
⏱ *App start → tap:* ${trail.msSinceAppStart ?? '?'}ms
📱 *UA:* ${trail.device?.userAgent || '?'}
💾 *deviceMemory:* ${trail.device?.deviceMemory ?? '?'}GB  ·  *cores:* ${trail.device?.hardwareConcurrency ?? '?'}
🪜 *Trail:*
${stepsLine}
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
    console.error('reel-diagnostic Telegram forward failed:', e.message);
    // Still 200 — fire-and-forget, never worth a client-visible error.
  }

  return res.status(200).json({ success: true });
}
