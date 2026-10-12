/**
 * Admin notifications via the Telegram Bot API.
 *
 * Messages use legacy Markdown (parse_mode: 'Markdown'), where an unescaped
 * `_`, `*`, `` ` `` or `[` inside user-supplied text (an email like a_b@x.com, a
 * feedback note with a lone `*`) makes Telegram reject the WHOLE message with
 * HTTP 400 — so the notification was silently lost. Every interpolated user
 * value must go through escapeMarkdownV1().
 */

const MAX_TEXT = 3500;

/** Escapes the characters that are special in Telegram's legacy Markdown. */
export function escapeMarkdownV1(value) {
  return String(value ?? '').replace(/([_*`[])/g, '\\$1');
}

/**
 * Masks an e-mail for admin alerts: first character + *** + the domain  (adialamo@gmail.com → a***@gmail.com).
 * Keeps the domain so the alert stays useful; the FULL address stays in the Redis record (waitlist:<email>,
 * deletion-request:<email>:<ts>), not in Telegram's history. Unparseable input becomes "***".
 */
export function maskEmail(email) {
  const e = String(email ?? '').trim();
  const at = e.lastIndexOf('@');
  if (at < 1 || at === e.length - 1) return '***';
  return `${e[0]}***${e.slice(at)}`;
}

/**
 * Sends a Markdown message to the admin chat. Never throws.
 * Resolves { ok, status } — ok=false when unconfigured, rejected, or unreachable.
 * A rejected/failed send is logged (it used to fail silently).
 *
 * TELEGRAM_API_BASE is for tests only (point it at a local fake); production
 * leaves it unset and talks to api.telegram.org.
 */
export async function sendTelegram(text) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId   = process.env.TELEGRAM_CHAT_ID;
  if (!botToken || !chatId) return { ok: false, status: 0 };

  // Telegram's hard limit is 4096 chars; stay well under it so a long note can't
  // make the whole message fail.
  const body = text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;

  const base = (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/$/, '');
  try {
    const res = await fetch(`${base}/bot${botToken}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: body, parse_mode: 'Markdown' }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      console.warn(`⚠️ Telegram rejected message (HTTP ${res.status}): ${detail}`);
    }
    return { ok: res.ok, status: res.status };
  } catch (e) {
    console.warn(`⚠️ Telegram send failed: ${e.message}`);
    return { ok: false, status: 0 };
  }
}
