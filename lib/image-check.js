/**
 * Output-image safety check — every image the app generates is classified BEFORE it is shown or stored
 * (Google Play "AI-Generated Content": prevent restricted content). Fail-CLOSED throughout.
 *
 *   primary   NVIDIA Nemotron 3.5 Content Safety via OpenRouter (`:free`, $0)
 *   fallback  google/gemini-2.5-flash-lite THROUGH OPENROUTER (same key, PAID, daily-capped by DAILY_CHECK_BUDGET, routed with
 *             provider.data_collection = "deny") — when the primary was rate-limited (429), failed
 *             (5xx / any non-2xx), timed out, OR returned a reply the strict parser cannot read. NEVER because the primary
 *             said "unsafe": a clear primary verdict is final. Once the fallback is consulted, ITS verdict (or its
 *             unavailability) alone decides.
 *
 * SECOND OPINION (image safety): when Nemotron says "safe", the same bytes get ONE more question to Gemini Flash-Lite (paid, own budget
 * DAILY_IMAGE_SAFETY_BUDGET, own circuit `check_imgsafety`): nudity / sexualized content / a sexualized depiction of anyone who looks like a minor?
 * "unsafe", a refusal and an unreadable reply all hold the image back; no answer (circuit open, budget spent or 0, technical failure, no time) is
 * 'unavailable' — fail-CLOSED, exactly like the rest of the check. An image the Gemini FALLBACK already approved is not asked twice (same model, same question).
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
import { openRouterRefusal } from './content-safety.js';
import { reserveCheckBudget, releaseCheckBudget } from './budget.js';
import { alertOnce } from './alert-throttle.js';

export const NEMOTRON_SLUG = 'nvidia/nemotron-3.5-content-safety:free';
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Nemotron on OpenRouter is a REASONING model: reasoning tokens count against max_tokens, so a tiny budget (40) produced
// content=null / finish=length. Probe results (real route): `reasoning: { effort: "none" }` is accepted, answers in ~5 tokens
// and 150-400 ms with the same verdicts as a big budget. 512 is generous headroom for the 1-3 line verdict.
// Reasoning docs: https://openrouter.ai/docs/guides/best-practices/reasoning-tokens
export const NEMOTRON_MAX_TOKENS = 512;
const REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high']);
/** default "none"; IMAGE_CHECK_REASONING_EFFORT overrides it (a valid effort), or "off" sends no reasoning option at all */
export const reasoningOption = () => {
  const e = process.env.IMAGE_CHECK_REASONING_EFFORT?.trim().toLowerCase();
  if (e === 'off') return {};
  return { reasoning: { effort: e && REASONING_EFFORTS.has(e) ? e : 'none' } };
};

// Fallback checker: Gemini 2.5 Flash-Lite via OpenRouter (slug verified on OpenRouter's endpoints API, 2026-10-12:
// $0.10 / 1M prompt+image tokens, $0.40 / 1M output; supports response_format + structured_outputs).
export const FALLBACK_SLUG = 'google/gemini-2.5-flash-lite';
// Data policy: https://openrouter.ai/docs/features/provider-routing — `deny` = only providers that do not collect user data.
// If NO endpoint satisfies it OpenRouter answers with an error → a technical failure here → "unavailable" (fail-closed).
const FALLBACK_PROVIDER = { data_collection: 'deny' };

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
 * Fallback (Gemini via OpenRouter, OpenAI-shaped reply). The request forces `{"verdict":"safe"|"unsafe"}` (json_schema).
 * Returns 'safe' | 'unsafe' | 'unknown'. Any refusal — finish_reason content_filter, a native IMAGE_SAFETY / SAFETY /
 * PROHIBITED_CONTENT reason, or a `refusal` field — means the model itself declined the picture → 'unsafe', and wins over any
 * text. Otherwise the content must be exactly that JSON object; anything else is 'unknown'.
 */
export function parseFallbackVerdict(data) {
  if (openRouterRefusal(data)) return 'unsafe';
  const text = data?.choices?.[0]?.message?.content;
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
        max_tokens: NEMOTRON_MAX_TOKENS,
        ...reasoningOption(),
        messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }, { type: 'text', text: 'Image to check.' }] }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { kind: 'technical', status: res.status };
    const data = await res.json();
    const choice = data?.choices?.[0];
    const reason = String(choice?.finish_reason ?? 'none').replace(/[^A-Za-z0-9_]/g, '').slice(0, 20);
    return { kind: 'verdict', verdict: parseNemotronVerdict(choice?.message?.content), shape: `${shapeOf(choice?.message?.content)}|finish_${reason}` };
  } catch {
    return { kind: 'technical', status: 408 };
  }
}

export async function callFallback(imageUrl, timeoutMs) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { kind: 'technical', status: null, config: true };
  if (!/^data:image\//i.test(imageUrl || '')) return { kind: 'technical', status: null, config: true };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://lifescript.app', 'X-Title': 'LifeScript Studio' },
      body: JSON.stringify({
        model: process.env.IMAGE_CHECK_FALLBACK_MODEL || FALLBACK_SLUG,
        temperature: 0,
        max_tokens: 256,
        provider: FALLBACK_PROVIDER,
        response_format: { type: 'json_schema', json_schema: { name: 'safety_verdict', strict: true, schema: { type: 'object', properties: { verdict: { type: 'string', enum: ['safe', 'unsafe'] } }, required: ['verdict'], additionalProperties: false } } },
        messages: [{ role: 'user', content: [
          { type: 'image_url', image_url: { url: imageUrl } },
          { type: 'text', text: 'Content-safety review for a general-audience app. Answer "unsafe" if the image shows nudity, partial nudity, sexual or erotic content, a sexualized or undressed person of any age, a minor in any revealing or sexual context, or graphic gore; otherwise answer "safe".' },
        ] }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { kind: 'technical', status: res.status };
    return { kind: 'verdict', verdict: parseFallbackVerdict(await res.json()), shape: 'fallback-json' };
  } catch {
    return { kind: 'technical', status: 408 };
  }
}

/**
 * Generic call to the paid fallback model through OpenRouter (same key, provider.data_collection = "deny", strict json_schema).
 * `content` is an OpenAI-style content array (text and/or image_url parts). Returns { kind: 'ok', data } or { kind: 'technical', status }.
 */
export async function callOpenRouterJson({ content, schemaName, schema, timeoutMs, maxTokens = 256 }) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return { kind: 'technical', status: null, config: true };
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://lifescript.app', 'X-Title': 'LifeScript Studio' },
      body: JSON.stringify({
        model: process.env.IMAGE_CHECK_FALLBACK_MODEL || FALLBACK_SLUG,
        temperature: 0,
        max_tokens: maxTokens,
        provider: FALLBACK_PROVIDER,
        response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
        messages: [{ role: 'user', content }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { kind: 'technical', status: res.status };
    return { kind: 'ok', data: await res.json() };
  } catch {
    return { kind: 'technical', status: 408 };
  }
}

/**
 * Runs ONE paid fallback request under the shared guard rails used by every non-image check (generated text, the apparent-minor screen):
 * the circuit (`circuitKey`, default `check_gemini`; the text classifier and the minor screen pass their own) and the budget of its `purpose`
 * ('image' = DAILY_CHECK_BUDGET, 'text' = DAILY_TEXT_CHECK_BUDGET, 'minor' = DAILY_MINOR_CHECK_BUDGET — three independent counters), the reservation (fail-closed when it cannot be verified), release of the slot when the
 * call failed technically, circuit bookkeeping. Returns { kind: 'ok', data } or { kind: 'unavailable', why }.
 */
export async function runFallbackJson({ content, schemaName, schema, timeoutMs = CALL_TIMEOUT_MS, maxTokens, circuitKey = 'check_gemini', purpose = 'image' }) {
  let open = new Set();
  try { open = await getOpenProviders(redis); } catch { /* fail-open on the circuit read only */ }
  if (open.has(circuitKey)) return { kind: 'unavailable', why: 'circuit-open' };
  let reserved = false;
  try {
    const b = await reserveCheckBudget(purpose);
    reserved = b.ok;
    if (!b.ok) console.warn(`🛑 fallback check (${purpose}): paid cap reached (${b.used}/${b.max})`);
  } catch (e) {
    console.warn(`⚠️ fallback check: paid budget unverifiable (${e.message}) — fail-closed, no paid call`);
  }
  if (!reserved) return { kind: 'unavailable', why: 'budget' };
  const r = await callOpenRouterJson({ content, schemaName, schema, timeoutMs, maxTokens });
  if (r.kind === 'ok') { await recordSuccess(redis, circuitKey); return r; }
  await releaseCheckBudget(purpose);     // failed technically → nothing was billed
  await recordFailure(redis, circuitKey, r.status ?? null);
  return { kind: 'unavailable', why: 'technical' };
}

/** a content-free description of an unreadable answer, safe to log: field names only, never values */
function shapeOf(content) {
  if (content === null || content === undefined) return 'null';
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

/** provider names are stored in a Redis value and later in R2 object metadata: keep them to a short, plain token */
export function cleanProviderTag(p) {
  const t = String(p ?? '').replace(/[^A-Za-z0-9._-]/g, '').slice(0, 40);
  return t || null;
}

/**
 * Marks these exact bytes as approved. The value is the provider that generated them (server-written, so a client cannot
 * spoof it); upload-panel copies it into the R2 object's metadata. '1' = approved, provider unknown.
 */
export async function markImageChecked(dataUri, provider) {
  const h = imageHash(dataUri);
  if (!h) return;
  try { await redis.set(`imgok:${h}`, cleanProviderTag(provider) ?? '1', { ex: IMGOK_TTL_SEC }); }
  catch (e) { console.warn(`⚠️ imgok marker skipped (Redis): ${e.message}`); }
}

/** the approval marker for these bytes: null (none / Redis error), '1' (approved, provider unknown) or the provider tag */
export async function getImageMark(dataUri) {
  const h = imageHash(dataUri);
  if (!h) return null;
  try { const v = await redis.get(`imgok:${h}`); return v === null || v === undefined ? null : String(v); }
  catch { return null; }
}

/** true when these exact bytes passed the check earlier (inside the TTL). A Redis error counts as "not checked". */
export async function wasImageChecked(dataUri) {
  return (await getImageMark(dataUri)) !== null;
}

async function unreadable(via, shape) {
  const consequence = via === 'nemotron' ? 'sent to the paid Gemini fallback' : 'rejected';
  console.error(`🛑 image check (${via}): UNREADABLE verdict (shape=${shape}) — images are ${consequence}. If this repeats the model's output format changed.`);
  await alertOnce(`image-check-unreadable:${via}`, `⚠️ *Image check:* the ${via} checker returned an unreadable verdict (shape: ${String(shape).replace(/[^A-Za-z0-9| _-]/g, '')}). Affected images are being ${consequence} until the parser is updated.`, { windowSec: 60 * 60 });
}


// ─── second opinion (image safety) ─────────────────────────────────────────────────────────────────────────────────────
export const IMAGE_SAFETY_PROMPT =
  'Does this image contain nudity or sexualized content, or any sexualized depiction of a person who looks like a minor? ' +
  'Answer "unsafe" if yes or if you are not sure; answer "safe" only if it clearly does not.';
export const IMAGE_SAFETY_SCHEMA = { type: 'object', properties: { verdict: { type: 'string', enum: ['safe', 'unsafe'] } }, required: ['verdict'], additionalProperties: false };
/** the exact message content sent to the second-opinion check (exported so a real-route probe can send byte-for-byte what production sends) */
export const imageSafetyContent = (imageDataUri) => [{ type: 'image_url', image_url: { url: imageDataUri } }, { type: 'text', text: IMAGE_SAFETY_PROMPT }];

/**
 * ONE paid question about an image Nemotron already called safe. Own budget (purpose 'imgsafety') and own circuit (check_imgsafety): neither can
 * affect — or be affected by — the image fallback, the text classifier or the minor screen. Parsed with the same strict rules as the fallback.
 * @returns {Promise<{verdict:'safe'|'unsafe'|'unavailable', via:string, why?:string}>}
 */
async function secondOpinion(imageDataUri, timeoutMs) {
  const r = await runFallbackJson({ content: imageSafetyContent(imageDataUri), schemaName: 'image_safety', schema: IMAGE_SAFETY_SCHEMA, timeoutMs, circuitKey: 'check_imgsafety', purpose: 'imgsafety' });
  if (r.kind !== 'ok') return { verdict: 'unavailable', via: 'imgsafety', why: r.why };
  const v = parseFallbackVerdict(r.data);
  if (v === 'safe') return { verdict: 'safe', via: 'nemotron+imgsafety' };
  if (v === 'unsafe') return { verdict: 'unsafe', via: 'imgsafety', why: openRouterRefusal(r.data) ? 'refused' : 'classified-unsafe' };
  await unreadable('imgsafety', 'fallback-json');
  return { verdict: 'unsafe', via: 'imgsafety', why: 'unreadable' };
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
        if (last.verdict === 'safe') {
          // Second opinion: Nemotron's "safe" alone is not enough to show or store the image (it can miss sexualized young-looking subjects).
          if (left() < MIN_CALL_MS) return { verdict: 'unavailable', via: 'imgsafety', why: 'no-time' };
          return secondOpinion(imageDataUri, Math.min(CALL_TIMEOUT_MS, Math.floor(left())));
        }
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
      const r = await callFallback(imageDataUri, Math.min(CALL_TIMEOUT_MS, Math.floor(left())));
      if (r.kind === 'verdict') {
        await recordSuccess(redis, 'check_gemini');
        if (r.verdict === 'safe') return { verdict: 'safe', via: 'gemini' };
        if (r.verdict === 'unsafe') return { verdict: 'unsafe', via: 'gemini', why: 'classified-unsafe' };
        await unreadable('gemini', r.shape);
        return { verdict: 'unsafe', via: 'gemini', why: 'unreadable' };
      }
      await releaseCheckBudget();   // it failed technically → nothing was billed
      await recordFailure(redis, 'check_gemini', r.status ?? null);
      console.warn(`⚠️ image check: fallback failed (status ${r.status ?? 'n/a'})`);
    }
  }
  return { verdict: 'unavailable', via: 'none', why: 'no-checker-available' };
}
