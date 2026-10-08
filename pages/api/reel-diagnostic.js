import { enforceRateLimit } from '../../lib/rate-limit.js';
import { alertOnce } from '../../lib/alert-throttle.js';
import { escapeMarkdownV1, sendTelegram } from '../../lib/telegram.js';

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
 * stage — see reelBreadcrumb's doc comment).
 *
 * This endpoint is unauthenticated, so everything is bounded:
 *   method → per-IP limit → payload validation → global limit → Telegram.
 * Limits: 30/h per IP (≈3 testers sharing a network, one message per reel attempt) and
 * 100/h overall (keeps a many-IP flood from saturating the Telegram chat that also carries
 * the magic-link and feedback alerts). A limit hit returns 429 + Retry-After, sends nothing
 * to Telegram, and raises at most one "rate limit hit" alert per 30 min per bucket.
 */

// A breadcrumb trail is metadata only (stage names, timestamps, byte counts,
// booleans) — never user content. The real client's worst case is ~12 KB.
export const config = {
  api: { bodyParser: { sizeLimit: '20kb' } },
};

const FLAGS = new Set(['finished', 'error', 'cancelled', 'recovered-after-kill']);

// The client caps itself at ~57 steps (48 rolling + ~9 pinned).
const MAX_STEPS         = 60;
const MAX_STEPS_CHARS   = 2800; // + ~600 chars of header/device lines stays under sendTelegram's 3500 cut

const PER_IP_FALLBACK  = { max: 30,  windowMs: 60 * 60 * 1000 };
const GLOBAL_FALLBACK  = { max: 100, windowMs: 60 * 60 * 1000 };
const REDIS_TIMEOUT_MS = 500;

/**
 * Client-supplied text → safe, short, single-line text for the admin chat:
 * control characters (incl. newlines) become spaces, links become [link], "@" is
 * defused so Telegram can't turn it into a mention. Markdown is escaped separately
 * by escapeMarkdownV1 at the point of use.
 */
function clean(value, max) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, ' ')
    .replace(/(?:https?:\/\/|www\.|t\.me\/)\S*/gi, '[link]')
    .replace(/@/g, '(at)')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const num = (v) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Math.round(Number(v)) : '?');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ message: 'Method not allowed' });
  }

  // ── 1. Per-IP limit — before any parsing/validation work ───────────────────
  if (await enforceRateLimit(req, res, 'reel-diagnostic', { timeoutMs: REDIS_TIMEOUT_MS, fallback: PER_IP_FALLBACK })) {
    // 429 already sent. At most one alert per 30 min; fixed text, no IP, no payload.
    await alertOnce('reel-diag-ip', '⚠️ *reel-diagnostic* rate limit hit (per-IP bucket)');
    return;
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

  // ── 2. Validation — garbage never reaches the global budget or Telegram ────
  const { flag, trail } = parsedBody || {};
  if (!FLAGS.has(flag)) {
    return res.status(400).json({ message: 'invalid flag' });
  }
  if (!trail || typeof trail !== 'object' || Array.isArray(trail)) {
    return res.status(400).json({ message: 'trail is required' });
  }

  // ── 3. Global limit ────────────────────────────────────────────────────────
  if (await enforceRateLimit(req, res, 'reel-diagnostic-global', { identifier: 'global', timeoutMs: REDIS_TIMEOUT_MS, fallback: GLOBAL_FALLBACK })) {
    await alertOnce('reel-diag-global', '⚠️ *reel-diagnostic* rate limit hit (global bucket)');
    return;
  }

  // ── 4. Forward to Telegram ─────────────────────────────────────────────────
  // Every client-supplied value is length-bounded, scrubbed (clean) and Markdown-escaped.
  const e = escapeMarkdownV1;
  const steps = Array.isArray(trail.steps) ? trail.steps.slice(0, MAX_STEPS) : [];
  let stepsLine = steps.length
    ? steps.map((s) => {
        if (!s || typeof s !== 'object') return '';
        const m = s.memory && typeof s.memory === 'object' ? s.memory : null;
        const mem = m ? ` heap=${num(m.usedJSHeapSize / 1e6)}/${num(m.jsHeapSizeLimit / 1e6)}MB` : '';
        const bits = Object.entries(s)
          .filter(([k]) => !['stage', 'ts', 'memory'].includes(k))
          .slice(0, 12)
          .map(([k, v]) => `${clean(k, 24)}=${clean(JSON.stringify(v), 80)}`)
          .join(' ');
        return e(`${clean(s.stage, 32)}${mem}${bits ? ' ' + bits : ''}`);
      }).filter(Boolean).join('\n')
    : '—';
  if (stepsLine.length > MAX_STEPS_CHARS) {
    // Too long: keep the start (tap/mount/decode stages) AND the end (the last stages before a
    // crash are the most valuable) and drop the middle — never just cut off the tail.
    const lines = stepsLine.split('\n');
    const head = []; const tail = []; let used = 0;
    const budget = MAX_STEPS_CHARS - 40;
    for (let i = 0; i < lines.length && used + lines[i].length + 1 <= budget * 0.4; i++) { head.push(lines[i]); used += lines[i].length + 1; }
    for (let i = lines.length - 1; i >= head.length && used + lines[i].length + 1 <= budget; i--) { tail.unshift(lines[i]); used += lines[i].length + 1; }
    stepsLine = [...head, `…(${lines.length - head.length - tail.length} steps omitted)`, ...tail].join('\n');
  }

  const device = trail.device && typeof trail.device === 'object' ? trail.device : {};
  const message = `
🎬 *Reel Diagnostic (temp — crash investigation)*
-------------------------
🏷 *Flag:* ${e(flag)}
🆔 *Session:* ${e(clean(trail.sessionId, 64) || '?')}
⏱ *App start → tap:* ${e(num(trail.msSinceAppStart))}ms
📱 *UA:* ${e(clean(device.userAgent, 200) || '?')}
💾 *deviceMemory:* ${e(num(device.deviceMemory))}GB  ·  *cores:* ${e(num(device.hardwareConcurrency))}
🪜 *Trail:*
${stepsLine}
-------------------------
  `;

  // Fire-and-forget on the client side; sendTelegram never throws and logs failures.
  await sendTelegram(message);

  return res.status(200).json({ success: true });
}
