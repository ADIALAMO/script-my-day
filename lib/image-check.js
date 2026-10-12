/**
 * Output-image safety check — every image the app generates is classified BEFORE it is shown or stored
 * (Google Play "AI-Generated Content": prevent restricted content). Fail-CLOSED throughout.
 *
 *   primary   NVIDIA Nemotron 3.5 Content Safety via OpenRouter (`:free`, $0)
 *   fallback  Gemini Flash-Lite (PAID, daily-capped by DAILY_CHECK_BUDGET) — when the primary was rate-limited (429), failed
 *             (5xx / any non-2xx), timed out, OR returned a reply the strict parser cannot read. NEVER because the primary
 *             said "unsafe": a clear primary verdict is final. Once the fallback is consulted, ITS verdict (or its
 *             unavailability) alone decides.
 *
 * Result: { verdict: 'safe' | 'unsafe' | 'unavailable', via, why }.
 *   'safe'         → show/store the image
 *   'unsafe'       → a checker said so, OR Gemini blocked the image, OR the fallback's own reply was unreadable
 *   'unavailable'  → no checker could answer in time (both down / capped / circuit-open): the image is NOT shown
 *
 * Strict parsing: exactly the documented shapes, one pinned format per model slug (see parseNemotronVerdict). A reply the
 * primary parser cannot read is "unknown": it is logged loudly (and alerted, throttled) because a model whose format changed
 * would otherwise silently push every image to the paid fallback — and the fallback decides. An unreadable reply from the
 * FALLBACK itself is treated as unsafe (there is nothing left to ask).
 */
import { createHash } from 'crypto';
import redis from './redis.js';
import { getOpenProviders, recordFailure, recordSuccess } from './circuit-breaker.js';
import { GEMINI_SAFETY_SETTINGS, geminiBlockReason } from './content-safety.js';
import { reserveCheckBudget, releaseCheckBudget } from './budget.js';
import { alertOnce } from './alert-throttle.js';

export const NEMOTRON_SLUG = 'nvidia/nemotron-3.5-content-safety:free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

const CALL_TIMEOUT_MS = 8000;      // per checker call (brief: 8-10 s)
const TOTAL_BUDGET_MS = 16000;     // the whole check, retry and fallback included
const RETRY_PAUSE_MS = 300;
const MIN_CALL_MS = 2500;          // do not start a call with less time than this left
export const IMGOK_TTL_SEC = 6 * 60 * 60;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── verdict parsers (pure, exported for the table-driven tests) ────────────────────────────────────────────────────

/**
 * Pinned format for `nvidia/nemotron-3.5-content-safety` — NVIDIA model card / NIM API reference:
 *   User Safety: safe|unsafe              (required)
 *   Response Safety: safe|unsafe          (optional — only when a response is supplied; we send none)
 *   Safety Categories: a, b, c            (optional — only when categories are requested)
 * Returns 'safe' | 'unsafe' | 'unknown'. 'safe' requires: a string, only these three field lines (each at most once), exactly one
 * `User Safety` line whose value is safe, no `Response Safety: unsafe`, and no categories listed on a safe verdict.
 * ANY other line, duplicate, value or non-string input is 'unknown'.
 */
export function parseNemotronVerdict(content) {
  if (typeof content !== 'string') return 'unknown';
  const lines = content.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length || lines.length > 3) return 'unknown';
  const seen = {};
  for (const line of lines) {
    const m = /^(User Safety|Response Safety|Safety Categories):[ \t]*(.*)$/.exec(line);
    if (!m || m[1] in seen) return 'unknown';
    seen[m[1]] = m[2].trim();
  }
  const user = seen['User Safety']?.toLowerCase();
  if (user !== 'safe' && user !== 'unsafe') return 'unknown';
  const response = seen['Response Safety']?.toLowerCase();
  if (response !== undefined && response !== 'safe' && response !== 'unsafe') return 'unknown';
  if (user === 'unsafe' || response === 'unsafe') return 'unsafe';
  const cats = seen['Safety Categories'];
  if (cats !== undefined && cats !== '' && cats.toLowerCase() !== 'none') return 'unknown';   // categories on a "safe" verdict contradict each other
  return 'safe';
}

/**
 * Gemini fallback. The request forces `{"verdict":"safe"|"unsafe"}` (responseSchema). Returns 'safe' | 'unsafe' | 'unknown'.
 * A Gemini block (promptFeedback.blockReason, or a SAFETY / PROHIBITED_CONTENT / IMAGE_SAFETY finish reason) on an IMAGE input
 * means Gemini itself refused the picture → 'unsafe'. Anything that is not exactly that JSON object is 'unknown'.
 */
export function parseGeminiVerdict(data) {
  if (geminiBlockReason(data)) return 'unsafe';
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string') return 'unknown';
  let obj;
  try { obj = JSON.parse(text); } catch { return 'unknown'; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return 'unknown';
  if (Object.keys(obj).length !== 1 || obj.verdict === undefined) return 'unknown';
  return obj.verdict === 'safe' || obj.verdict === 'unsafe' ? obj.verdict : 'unknown';
}

// ─── checker calls ───────────────────────────────────────────────────────────────────────────────────────────────────
// Each returns { kind: 'verdict', verdict } or { kind: 'technical', status }  (status 408 for a timeout / network error).

export async function callNemotron(imageUrl, timeoutMs) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { kind: 'technical', status: null, config: true };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://lifescript.app', 'X-Title': 'LifeScript Studio' },
      // The model's chat template wants the image first, then the text turn; the text is only a neutral stub — the verdict
      // always comes back in the fixed "User Safety: …" template.
      body: JSON.stringify({
        model: NEMOTRON_SLUG,
        temperature: 0,
        max_tokens: 40,
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }, { type: 'text', text: 'Image to check.' }] }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { kind: 'technical', status: res.status };
    const data = await res.json();
    return { kind: 'verdict', verdict: parseNemotronVerdict(data?.choices?.[0]?.message?.content), shape: shapeOf(data?.choices?.[0]?.message?.content) };
  } catch {
    return { kind: 'technical', status: 408 };
  }
}

async function callGemini(imageUrl, timeoutMs) {
  const key = process.env.GOOGLE_GEMINI_API_KEY?.trim();
  if (!key) return { kind: 'technical', status: null, config: true };
  const m = /^data:(image\/[a-z0-9.+-]+);base64,(.+)$/is.exec(imageUrl || '');
  if (!m) return { kind: 'technical', status: null, config: true };
  const model = process.env.IMAGE_CHECK_GEMINI_MODEL || 'gemini-2.5-flash-lite';
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { inlineData: { mimeType: m[1], data: m[2] } },
          { text: 'Content-safety review for a general-audience app. Answer "unsafe" if the image shows nudity, partial nudity, sexual or erotic content, a sexualized or undressed person of any age, a minor in any revealing or sexual context, or graphic gore; otherwise answer "safe".' },
        ] }],
        generationConfig: {
          temperature: 0, maxOutputTokens: 20, responseMimeType: 'application/json',
          responseSchema: { type: 'OBJECT', properties: { verdict: { type: 'STRING', enum: ['safe', 'unsafe'] } }, required: ['verdict'] },
          thinkingConfig: { thinkingBudget: 0 },
        },
        safetySettings: GEMINI_SAFETY_SETTINGS,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { kind: 'technical', status: res.status };
    const data = await res.json();
    return { kind: 'verdict', verdict: parseGeminiVerdict(data), shape: 'gemini-json' };
  } catch {
    return { kind: 'technical', status: 408 };
  }
}

/** a content-free description of an unreadable answer, safe to log: field names only, never values */
function shapeOf(content) {
  if (typeof content !== 'string') return typeof content;
  if (!content.trim()) return 'empty';
  return content.split(/\r?\n/).slice(0, 4).map((l) => (/^([A-Za-z ]{1,24}):/.exec(l.trim())?.[1] ?? '?')).join('|');
}

// ─── the check ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** SHA-256 (hex) of the decoded image bytes of a base64 data URI — the key of the `imgok:` marker. null if not a data URI. */
export function imageHash(dataUri) {
  const m = /^data:[^;,]*;base64,(.+)$/s.exec(dataUri || '');
  return m ? createHash('sha256').update(Buffer.from(m[1], 'base64')).digest('hex') : null;
}

export async function markImageChecked(dataUri) {
  const h = imageHash(dataUri);
  if (!h) return;
  try { await redis.set(`imgok:${h}`, '1', { ex: IMGOK_TTL_SEC }); }
  catch (e) { console.warn(`⚠️ imgok marker skipped (Redis): ${e.message}`); }
}

/** true when these exact bytes passed the check earlier (inside the TTL). A Redis error counts as "not checked". */
export async function wasImageChecked(dataUri) {
  const h = imageHash(dataUri);
  if (!h) return false;
  try { return (await redis.get(`imgok:${h}`)) !== null; }
  catch { return false; }
}

async function unreadable(via, shape) {
  const consequence = via === 'nemotron' ? 'sent to the paid Gemini fallback' : 'rejected';
  console.error(`🛑 image check (${via}): UNREADABLE verdict (shape=${shape}) — images are ${consequence}. If this repeats the model's output format changed.`);
  await alertOnce(`image-check-unreadable:${via}`, `⚠️ *Image check:* the ${via} checker returned an unreadable verdict (shape: ${String(shape).replace(/[^A-Za-z0-9| _-]/g, '')}). Affected images are being ${consequence} until the parser is updated.`, { windowSec: 60 * 60 });
}

/**
 * @param {string} imageDataUri  base64 data URI of the generated image
 * @param {{budgetMs?: number}} [opts]  upper bound for the whole check (default 16 s)
 * @returns {Promise<{ verdict: 'safe'|'unsafe'|'unavailable', via: string, why?: string }>}
 */
export async function checkImage(imageDataUri, { budgetMs = TOTAL_BUDGET_MS } = {}) {
  const t0 = performance.now();
  const total = Math.min(TOTAL_BUDGET_MS, budgetMs);   // callers pass what is left of their own function timeout
  const left = () => total - (performance.now() - t0);
  if (typeof imageDataUri !== 'string' || !imageDataUri.startsWith('data:image/')) return { verdict: 'unsafe', via: 'none', why: 'not-an-image' };

  let open = new Set();
  try { open = await getOpenProviders(redis); } catch { /* fail-open on the circuit read only */ }

  // 1) PRIMARY — Nemotron free: one attempt + one short retry on a TECHNICAL failure (an unreadable reply is not retried).
  let primaryFailed = false;
  let unreadablePrimary = false;
  if (!open.has('check_nemotron')) {
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        if (left() < MIN_CALL_MS + RETRY_PAUSE_MS) break;
        await sleep(RETRY_PAUSE_MS);
      }
      last = await callNemotron(imageDataUri, Math.min(CALL_TIMEOUT_MS, Math.floor(left())));
      if (last.kind === 'verdict') {
        await recordSuccess(redis, 'check_nemotron');   // the service answered; only its FORMAT is the problem
        if (last.verdict === 'safe') return { verdict: 'safe', via: 'nemotron' };
        if (last.verdict === 'unsafe') return { verdict: 'unsafe', via: 'nemotron', why: 'classified-unsafe' };
        // Unreadable reply: do not retry (temperature 0 → the same text again) and do not open the circuit; ask the
        // fallback instead. It is still metered against DAILY_CHECK_BUDGET below.
        await unreadable('nemotron', last.shape);
        unreadablePrimary = true;
        break;
      }
      if (last.config) break;   // a missing key is not transient: no retry
    }
    primaryFailed = true;
    if (!unreadablePrimary) {
      await recordFailure(redis, 'check_nemotron', last?.status ?? null);
      console.warn(`⚠️ image check: Nemotron unavailable (status ${last?.status ?? 'n/a'}) — trying the fallback`);
    }
  } else {
    primaryFailed = true;   // circuit open → straight to the fallback
  }

  // 2) FALLBACK — Gemini Flash-Lite (paid), only after a technical failure or an unreadable reply of the primary, only with budget.
  if (primaryFailed && !open.has('check_gemini') && left() >= MIN_CALL_MS) {
    let reserved = false;
    try {
      const b = await reserveCheckBudget();
      reserved = b.ok;
      if (!b.ok) console.warn(`🛑 image check: paid fallback cap reached (${b.used}/${b.max}) — fallback unavailable`);
    } catch (e) {
      console.warn(`⚠️ image check: paid budget unverifiable (${e.message}) — fail-closed, no paid call`);
    }
    if (reserved) {
      const r = await callGemini(imageDataUri, Math.min(CALL_TIMEOUT_MS, Math.floor(left())));
      if (r.kind === 'verdict') {
        await recordSuccess(redis, 'check_gemini');
        if (r.verdict === 'safe') return { verdict: 'safe', via: 'gemini' };
        if (r.verdict === 'unsafe') return { verdict: 'unsafe', via: 'gemini', why: 'classified-unsafe' };
        await unreadable('gemini', r.shape);
        return { verdict: 'unsafe', via: 'gemini', why: 'unreadable' };
      }
      await releaseCheckBudget();   // it failed technically → nothing was billed
      await recordFailure(redis, 'check_gemini', r.status ?? null);
      console.warn(`⚠️ image check: Gemini fallback failed (status ${r.status ?? 'n/a'})`);
    }
  }
  return { verdict: 'unavailable', via: 'none', why: 'no-checker-available' };
}
