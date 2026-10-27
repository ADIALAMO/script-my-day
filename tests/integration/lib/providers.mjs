/**
 * Local mocks of EVERY external service the app calls. Nothing here touches the network.
 * Each call is counted per provider so tests can assert exactly how many PAID calls happened.
 *
 *   gemini            Google generativelanguage (scripts; storyboard fallback)        PAID
 *   openrouter-text   OpenRouter chat, non-":free" text models (storyboard primary)  PAID
 *   openrouter-free   OpenRouter ":free" text models                                 free
 *   klein             OpenRouter black-forest-labs/flux.2-klein-4b                   PAID
 *   grok              OpenRouter x-ai/grok-imagine-image-quality (identity)          PAID
 *   gemini-image      OpenRouter google/gemini-2.5-flash-image (identity)            PAID
 *   moderation        OpenRouter nvidia/nemotron ":free" (selfie moderation AND the output-image check)  free
 *   gemini-check      OpenRouter google/gemini-2.5-flash-lite, the PAID fallback of the output-image check   PAID
 *   gemini-imgsafety  the SAME model asked the second-opinion question (schema name 'image_safety'), own counter/failure switch   PAID
 *   cohere            Cohere chat                                                    PAID
 *   cloudflare        Cloudflare Workers AI flux-1-schnell                           free tier
 *   pollinations      image.pollinations.ai                                          free
 *   huggingface       router.huggingface.co (disabled in the app unless a flag is set)
 *   telegram          api.telegram.org (alerts)                                      recorder
 *   r2                @aws-sdk S3 PutObject (patched at the SDK class, see setup.mjs) recorder
 */
export const PAID = new Set(['gemini-check', 'gemini-imgsafety', 'storyboard-gemini', 'gemini', 'openrouter-text', 'klein', 'grok', 'gemini-image', 'cohere']);

// 1x1 transparent PNG
export const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
export const PNG_DATA_URI = `data:image/png;base64,${PNG_B64}`;
export const PNG_BYTES = Buffer.from(PNG_B64, 'base64');

import fs from 'node:fs';
import { createRequire } from 'node:module';
let _font;
// satori needs a real font file to render the invite card; use the one that ships inside next/og (no network)
const FONT_BYTES = () => (_font ??= fs.readFileSync(createRequire(import.meta.url)('node:path').join(createRequire(import.meta.url).resolve('next/package.json').replace(/package\.json$/, ''), 'dist/compiled/@vercel/og/noto-sans-v27-latin-regular.ttf')));

const HEBREW = /[֐-׿]/;

// The app locks the script language to the input language: its English prompt contains this
// sentence, the Hebrew prompt does not (lib/agent.js). The mock answers in the matching language.
const ENGLISH_PROMPT = /Do NOT include any Hebrew characters/;
function scriptText(prompt) {
  const he = !ENGLISH_PROMPT.test(prompt || '');
  const filler = he
    ? 'סצנה ראשונה. הגיבור פוגש את היום שלו ומגלה שהכול משתנה. ' : 'Scene one. The hero meets the day and discovers everything changes. ';
  const body = filler.repeat(14);
  return he
    ? `**בדיקה**\n\n**פתיחה:** דרמה\n\n**סצנה 1: פנים - יום**\n(${body})\n\n**סוף**\n[image: a lone figure at dawn, cinematic]`
    : `**TEST TITLE**\n\n**OPENING:** drama\n\nINT. KITCHEN - DAY\n(${body})\n\n**THE END**\n[image: a lone figure at dawn, cinematic]`;
}

function storyboardJson(visualOverride) {
  const visual = visualOverride ?? 'A calm person stands near a window in soft morning light, medium shot, gentle rim lighting on the face and shoulders';
  return JSON.stringify(Array.from({ length: 7 }, (_, i) => ({
    panel: i + 1, scene: `INT. ROOM ${i + 1} - DAY`, visual, dialogue: `Line ${i + 1}`, hero: [0, 3, 6].includes(i),
  })));
}

export function createProviders() {
  const counts = {};
  const log = [];
  const telegram = [];
  const s3puts = [];
  const s3deletes = [];
  const s3copies = [];            // { from, to } as 'bucket/key'
  const s3objects = new Map();    // 'bucket/key' -> { bytes, metadata } — a tiny in-memory R2 so Head/Copy/Delete behave
  const mode = {};   // provider -> HTTP status to fail with, or 'ok'
  const latency = { gemini: null };   // e.g. { gemini: { 'gemini-2.5-flash': 400, default: 50 } } (ms)
  // value 'safe' | 'unsafe' are rendered in NVIDIA's documented template ("User Safety: …"); `raw` overrides the whole reply text
  // (use it for the malformed shapes: "not safe", "", ...). `nonString` makes the content a number.
  const moderationVerdict = { value: 'safe', raw: undefined, nonString: false, nullLength: false, queue: [] };   // queue: one-shot replies consumed in order (each a raw string)
  const scriptOutputs = { queue: [] };   // one-shot script texts consumed in order (to simulate a model that wrote something held back)
  const sbVisuals = { queue: [] };       // one-shot storyboard 'visual' strings
  const sbRaw = { queue: [] };           // one-shot RAW storyboard answers (truncated JSON, wrapper objects, prose ...) — takes precedence over sbVisuals
  const ageVerdict = { value: 'adult', raw: undefined, block: false, queue: [] };   // the apparent-minor screen (schema name 'apparent_age'): 'adult' | 'minor' | 'unsure' | raw
  const imgSafety = { value: 'safe', raw: undefined, block: false, queue: [] };   // second-opinion image check (schema name 'image_safety'): 'safe' | 'unsafe' | raw text | block
  const checkGemini = { value: 'safe', raw: undefined, block: false, queue: [] };   // paid fallback checker reply: 'safe' | 'unsafe' | raw text | block
  const handlers = { r2: null, font: null };   // overridable per test
  const unexpected = [];
  const refuse = {};   // provider -> true: answer with that provider's CONTENT REFUSAL (safety filter) instead of an image/script
  const bodies = [];   // { provider, body } of every request, so tests can assert what was (not) sent
  const hooks = { afterPut: null };   // test hooks (see setup.mjs): run something right after an object is stored

  const count = (provider, extra = {}) => { counts[provider] = (counts[provider] || 0) + 1; log.push({ provider, ...extra }); };
  // A failure mode is a status ('500'), '<status>x<N>' = fail the first N calls with that status and then answer normally ('429x1'), or a '403:<variant>' body (below).
  const hits = {};
  const failing = (provider) => {
    const v = mode[provider];
    if (!v || v === 'ok') return null;
    const m = /^(\d{3})x(\d+)$/.exec(String(v));
    if (!m) return v;
    hits[provider] = (hits[provider] || 0) + 1;
    return hits[provider] <= Number(m[2]) ? m[1] : null;
  };
  // What a 429 looks like: optional Retry-After header (seconds) and body text, set per test through providers.rate429 (reset between scenarios).
  const rate429 = { retryAfter: null, body: null };
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const text = (t, status) => new Response(t, { status });
  // A failure mode is an HTTP status ('402', '500') or '403:<variant>': a 403 whose body is OpenRouter's real "Key limit exceeded" answer ('keylimit') or one of
  // its look-alikes that must NOT be treated as a credit failure. Anything else answers the plain 'mock failure' text with that status.
  const KEY_LIMIT_BODY = { error: { message: 'Key limit exceeded (total limit). Manage it using https://openrouter.ai/workspaces/default/keys/KEYID $0.00 of $0.00 used; does not reset.', code: 403, metadata: { limit_source: 'openrouter_key_limit', remedy_hint: "Raise or remove this API key's usage limit at https://openrouter.ai/settings/keys, or use a key without a limit.", scope: 'key_limit', limit_usd: 0, spend_usd: 0, resets_at: null } } };
  const POLICY_404 = (what) => ({ error: { message: `No endpoints found matching your data policy (${what}). Configure: https://openrouter.ai/settings/privacy`, code: 404, metadata: { routing_funnel: [{ step: 'Initial Endpoints', endpoint_count: 1 }], failed_routing_step: 'Filter by Data Policy' } } });
  const FAIL_BODIES = {
    '403:keylimit': () => json(KEY_LIMIT_BODY, 403),
    '403:scope': () => json({ error: { message: 'Key limit exceeded', code: 403, metadata: { scope: 'key_limit' } } }, 403),
    '403:source': () => json({ error: { message: 'Key limit exceeded', code: 403, metadata: { limit_source: 'openrouter_key_limit' } } }, 403),
    '403:otherscope': () => json({ error: { message: 'Forbidden', code: 403, metadata: { scope: 'model_access', limit_source: 'provider' } } }, 403),
    '403:plain': () => json({ error: { message: 'Forbidden', code: 403 } }, 403),
    '403:garbage': () => text('<html>forbidden</html>', 403),
    // OpenRouter's answer when NO endpoint satisfies provider.data_collection "deny" (probe 2026-10-27), and a look-alike whose text names "safety" (must never be read as a content refusal)
    '404:policy': () => json(POLICY_404('Free model training'), 404),
    '404:policysafety': () => json(POLICY_404('Safety retention'), 404),
  };
  const fail = (f) => {
    if (FAIL_BODIES[String(f)]) return FAIL_BODIES[String(f)]();
    if (Number(f) === 429) return new Response(rate429.body ?? 'mock failure', { status: 429, headers: rate429.retryAfter === null ? {} : { 'retry-after': String(rate429.retryAfter) } });
    return text('mock failure', Number(f));
  };

  async function handle(url, init = {}) {
    const u = new URL(url);
    const host = u.hostname;
    let body = null;
    if (typeof init?.body === 'string') { try { body = JSON.parse(init.body); } catch { body = init.body; } }

    if (host === 'generativelanguage.googleapis.com') {
      const model = decodeURIComponent(u.pathname.split('/models/')[1] || '').split(':')[0];
      count('gemini', { model }); bodies.push({ provider: 'gemini', body });
      const f = (mode[`gemini:${model}`] && mode[`gemini:${model}`] !== 'ok' ? mode[`gemini:${model}`] : null) || failing('gemini');   // per-model failure: mode['gemini:gemini-2.5-flash'] = 500
      if (f) return json({ error: { message: 'mock failure' } }, Number(f));
      // optional per-model latency; honours AbortSignal like a real fetch (counted in `gemini-aborted`, which is NOT a paid call)
      const wait = latency.gemini?.[model] ?? latency.gemini?.default ?? 0;
      if (wait > 0) {
        const sig = init?.signal;
        const aborted = await new Promise((resolve) => {
          const t = setTimeout(() => resolve(false), wait);
          sig?.addEventListener('abort', () => { clearTimeout(t); resolve(true); }, { once: true });
          if (sig?.aborted) { clearTimeout(t); resolve(true); }
        });
        if (aborted) { count('gemini-aborted', { model }); const e = new Error('The operation was aborted'); e.name = 'AbortError'; throw e; }
      }
      if (refuse.gemini) return json({ promptFeedback: { blockReason: 'SAFETY' } });
      const isStoryboard = !!body?.systemInstruction;
      const userText = (body?.contents || []).map((c) => (c.parts || []).map((p) => p.text).join(' ')).join(' ');
      return json({ candidates: [{ content: { parts: [{ text: isStoryboard ? (sbRaw.queue.length ? sbRaw.queue.shift() : storyboardJson(sbVisuals.queue.shift())) : (scriptOutputs.queue.length ? scriptOutputs.queue.shift() : scriptText(userText)) }] } }] });
    }

    if (host === 'openrouter.ai') {
      if (u.pathname === '/api/v1/credits') return json({ data: { total_credits: 10, total_usage: 1 } });
      const model = body?.model || '';
      bodies.push({ provider: model, body });
      const refusedImage = json({ choices: [{ finish_reason: 'content_filter', native_finish_reason: 'IMAGE_SAFETY', message: { content: null } }] });
      const img = { choices: [{ message: { content: null, images: [{ image_url: { url: PNG_DATA_URI } }] } }] };
      if (model.includes('gemini-2.5-flash') && /storyboard artist/i.test((body?.messages || []).find((m) => m.role === 'system')?.content || '')) {   // the PAID FIRST engine of the storyboard: Gemini Flash-Lite through OpenRouter
        count('storyboard-gemini', { model }); bodies.push({ provider: 'storyboard-gemini', body });
        const f = failing('storyboard-gemini'); if (f === 'timeout') { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; } if (f) return fail(f);
        if (mode.orNoSchema && body?.response_format) return text('{"error":{"message":"No endpoints found that can handle the requested parameters"}}', 404);
        return json({ choices: [{ finish_reason: 'stop', message: { content: sbRaw.queue.length ? sbRaw.queue.shift() : storyboardJson(sbVisuals.queue.shift()) } }], usage: { prompt_tokens: 2500, completion_tokens: 700 } });
      }
      if (model.includes('gemini-2.5-flash-lite') && body?.response_format?.json_schema?.name === 'image_safety') {   // the SECOND-OPINION image check (own counter, switch and control)
        count('gemini-imgsafety', { model }); bodies.push({ provider: 'gemini-imgsafety', body });
        const f = failing('gemini-imgsafety'); if (f === 'timeout') { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; } if (f) return fail(f);
        if (imgSafety.queue.length) imgSafety.value = imgSafety.queue.shift();
        if (imgSafety.block) return json({ choices: [{ finish_reason: 'content_filter', native_finish_reason: 'IMAGE_SAFETY', message: { content: null } }] });
        return json({ choices: [{ finish_reason: 'stop', message: { content: imgSafety.raw ?? JSON.stringify({ verdict: imgSafety.value }) } }] });
      }
      if (model.includes('gemini-2.5-flash-lite') && body?.response_format) {   // the output-image check FALLBACK, through OpenRouter
        count('gemini-check', { model, hasImage: JSON.stringify(body.messages).includes('image_url'), isAge: body?.response_format?.json_schema?.name === 'apparent_age' }); bodies.push({ provider: 'gemini-check', body });
        const hasImage = JSON.stringify(body.messages).includes('image_url');
        // three independent failure switches: image check, text classifier, minor screen
        const f = failing(body?.response_format?.json_schema?.name === 'apparent_age' ? 'gemini-check-age' : hasImage ? 'gemini-check' : 'gemini-check-text'); if (f === 'timeout') { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; } if (f) return fail(f);
        const isAge = body?.response_format?.json_schema?.name === 'apparent_age';
        const ctl = isAge ? ageVerdict : checkGemini;
        if (ctl.queue.length) ctl.value = ctl.queue.shift();   // per-call sequence: ['unsafe', 'safe'] …
        if (ctl.block) return json({ choices: [{ finish_reason: 'content_filter', native_finish_reason: 'IMAGE_SAFETY', message: { content: null } }] });
        const t = ctl.raw ?? JSON.stringify(isAge ? { apparent_age: ctl.value } : { verdict: ctl.value });
        return json({ choices: [{ finish_reason: 'stop', message: { content: t } }] });
      }
      if (model.includes('flux.2-klein')) { count('klein', { model }); const f = failing('klein'); if (f) return fail(f); if (refuse.klein) return refusedImage; return json(img); }
      if (model.includes('grok-imagine')) { count('grok', { model }); const f = failing('grok'); if (f) return fail(f); if (refuse.grok) return refusedImage; return json(img); }
      if (model.includes('gemini-2.5-flash-image')) { count('gemini-image', { model }); const f = failing('gemini-image'); if (f) return fail(f); return json(img); }
      if (model.includes('nemotron')) {
        // like the real route: the ':free' variant has ONE endpoint (NVIDIA, trains on data), so provider.data_collection "deny" leaves nothing to route to
        if (model.endsWith(':free') && body?.provider?.data_collection === 'deny') { count('moderation-free-deny', { model }); return json(POLICY_404('Free model training'), 404); }
        count('moderation', { model }); bodies.push({ provider: 'moderation', body });
        if (mode.moderation === 'timeout') { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; }
        const f = failing('moderation'); if (f) return fail(f);
        const v = moderationVerdict;
        if (v.nullLength) return json({ choices: [{ finish_reason: 'length', message: { content: null, reasoning: 'thinking about the image ...' } }], usage: { prompt_tokens: 300, completion_tokens: 40 } });   // what the real route returned with max_tokens: 40
        if (v.queue.length) { const q = v.queue.shift(); return typeof q === 'number' ? text('mock failure', q) : json({ choices: [{ message: { content: q } }] }); }
        const content = v.nonString ? 42 : (v.raw !== undefined ? v.raw : v.value === 'safe' ? 'User Safety: safe' : v.value === 'unsafe' ? 'User Safety: unsafe\nSafety Categories: Sexual' : v.value);
        return json({ choices: [{ message: { content } }] });
      }
      const system = (body?.messages || []).find((m) => m.role === 'system')?.content || '';
      const isStoryboard = /storyboard artist/i.test(system);
      const prov = model.endsWith(':free') ? 'openrouter-free' : 'openrouter-text';
      count(prov, { model });
      const f = failing(prov); if (f) return fail(f);
      if (isStoryboard && mode.orNoSchema && body?.response_format) return text('{"error":{"message":"No endpoints found that can handle the requested parameters"}}', 404);   // no provider supports json_schema
      const userText = (body?.messages || []).map((m) => (typeof m.content === 'string' ? m.content : '')).join(' ');
      return json({ choices: [{ message: { content: isStoryboard ? (sbRaw.queue.length ? sbRaw.queue.shift() : storyboardJson(sbVisuals.queue.shift())) : (scriptOutputs.queue.length ? scriptOutputs.queue.shift() : scriptText(userText)) } }] });
    }

    if (host === 'api.cohere.ai') {
      count('cohere'); const f = failing('cohere'); if (f) return json({ message: 'mock failure' }, Number(f));
      return json({ text: scriptText(body?.message || '') });
    }

    if (host === 'api.cloudflare.com' && u.pathname.includes('/ai/run/')) {
      count('cloudflare'); bodies.push({ provider: 'cloudflare', body }); const f = failing('cloudflare'); if (f) return fail(f);
      if (refuse.cloudflare) return text('{"errors":[{"code":8007,"message":"AiError: Input prompt contains NSFW content"}],"success":false}', 400);
      if (mode.cloudflareSchema) return text('{"errors":[{"code":5006,"message":"Additional or unevaluated properties \'/seed\' at \'/\' not allowed"}]}', 400);
      return json({ result: { image: PNG_B64 }, success: true });
    }

    if (host === 'image.pollinations.ai') {   // still mocked so that a regression (anything calling it) is COUNTED and asserted on
      count('pollinations'); const f = failing('pollinations'); if (f) return fail(f);
      return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } });
    }

    if (host === 'router.huggingface.co') { count('huggingface'); return text('gone', 410); }

    if (host === 'api.telegram.org') {
      const msg = body?.text ?? ''; telegram.push(msg); count('telegram');
      return json({ ok: true });
    }

    if (host === 'cdn.jsdelivr.net') { count('font'); return handlers.font ? handlers.font(u) : new Response(FONT_BYTES(), { status: 200, headers: { 'content-type': 'font/ttf' } }); }
    if (host === 'site.test') { count('site-asset'); return new Response(PNG_BYTES, { status: 200, headers: { 'content-type': 'image/png' } }); }
    if (host === 'pub-test.r2.dev' && handlers.r2) {
      count('r2-public', { url });
      const res = await handlers.r2(u, init);
      // emulate real fetch redirect semantics: only 'manual' hands the 3xx back to the caller
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        if (init?.redirect === 'manual') return res;
        if (init?.redirect === 'error') throw new TypeError('fetch failed: redirect mode is set to error');
        return globalThis.fetch(new URL(res.headers.get('location'), u).href, init);   // would leave the allow-list → the network guard will catch it
      }
      return res;
    }

    return null; // not a known mock → the fetch router treats it as a violation
  }

  return {
    handle, refuse, bodies, counts, log, telegram, s3puts, s3deletes, s3copies, s3objects, hooks, mode, rate429, latency, moderationVerdict, checkGemini, imgSafety, ageVerdict, scriptOutputs, sbVisuals, sbRaw, handlers, unexpected,
    reset() { for (const k of Object.keys(counts)) delete counts[k]; log.length = 0; telegram.length = 0; s3puts.length = 0; s3deletes.length = 0; s3copies.length = 0; s3objects.clear(); for (const k of Object.keys(mode)) delete mode[k]; latency.gemini = null; moderationVerdict.value = 'safe'; moderationVerdict.raw = undefined; moderationVerdict.nonString = false; moderationVerdict.nullLength = false; moderationVerdict.queue.length = 0; checkGemini.value = 'safe'; checkGemini.raw = undefined; checkGemini.block = false; ageVerdict.value = 'adult'; ageVerdict.raw = undefined; ageVerdict.block = false; scriptOutputs.queue.length = 0; sbVisuals.queue.length = 0; sbRaw.queue.length = 0; checkGemini.queue.length = 0; ageVerdict.queue.length = 0; imgSafety.value = 'safe'; imgSafety.raw = undefined; imgSafety.block = false; imgSafety.queue.length = 0; handlers.r2 = null; hooks.afterPut = null; for (const k of Object.keys(refuse)) delete refuse[k]; bodies.length = 0; for (const k of Object.keys(hits)) delete hits[k]; rate429.retryAfter = null; rate429.body = null; },
    snapshot() { return { ...counts, 'r2-put': s3puts.length }; },
    paidTotal() { return Object.entries(counts).filter(([k]) => PAID.has(k)).reduce((n, [, v]) => n + v, 0); },
    paid() { return Object.fromEntries(Object.entries(counts).filter(([k]) => PAID.has(k))); },
  };
}
