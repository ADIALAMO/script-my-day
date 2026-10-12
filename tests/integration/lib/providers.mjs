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
 *   cohere            Cohere chat                                                    PAID
 *   cloudflare        Cloudflare Workers AI flux-1-schnell                           free tier
 *   pollinations      image.pollinations.ai                                          free
 *   huggingface       router.huggingface.co (disabled in the app unless a flag is set)
 *   telegram          api.telegram.org (alerts)                                      recorder
 *   r2                @aws-sdk S3 PutObject (patched at the SDK class, see setup.mjs) recorder
 */
export const PAID = new Set(['gemini-check', 'gemini', 'openrouter-text', 'klein', 'grok', 'gemini-image', 'cohere']);

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

function storyboardJson() {
  const visual = 'A calm person stands near a window in soft morning light, medium shot, gentle rim lighting on the face and shoulders';
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
  const mode = {};   // provider -> HTTP status to fail with, or 'ok'
  const latency = { gemini: null };   // e.g. { gemini: { 'gemini-2.5-flash': 400, default: 50 } } (ms)
  // value 'safe' | 'unsafe' are rendered in NVIDIA's documented template ("User Safety: …"); `raw` overrides the whole reply text
  // (use it for the malformed shapes: "not safe", "", ...). `nonString` makes the content a number.
  const moderationVerdict = { value: 'safe', raw: undefined, nonString: false, nullLength: false, queue: [] };   // queue: one-shot replies consumed in order (each a raw string)
  const checkGemini = { value: 'safe', raw: undefined, block: false };   // paid fallback checker reply: 'safe' | 'unsafe' | raw text | block
  const handlers = { r2: null, font: null };   // overridable per test
  const unexpected = [];
  const refuse = {};   // provider -> true: answer with that provider's CONTENT REFUSAL (safety filter) instead of an image/script
  const bodies = [];   // { provider, body } of every request, so tests can assert what was (not) sent

  const count = (provider, extra = {}) => { counts[provider] = (counts[provider] || 0) + 1; log.push({ provider, ...extra }); };
  const failing = (provider) => (mode[provider] && mode[provider] !== 'ok' ? mode[provider] : null);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
  const text = (t, status) => new Response(t, { status });

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
      return json({ candidates: [{ content: { parts: [{ text: isStoryboard ? storyboardJson() : scriptText(userText) }] } }] });
    }

    if (host === 'openrouter.ai') {
      if (u.pathname === '/api/v1/credits') return json({ data: { total_credits: 10, total_usage: 1 } });
      const model = body?.model || '';
      bodies.push({ provider: model, body });
      const refusedImage = json({ choices: [{ finish_reason: 'content_filter', native_finish_reason: 'IMAGE_SAFETY', message: { content: null } }] });
      const img = { choices: [{ message: { content: null, images: [{ image_url: { url: PNG_DATA_URI } }] } }] };
      if (model.includes('gemini-2.5-flash-lite') && body?.response_format) {   // the output-image check FALLBACK, through OpenRouter
        count('gemini-check', { model, hasImage: JSON.stringify(body.messages).includes('image_url') }); bodies.push({ provider: 'gemini-check', body });
        const f = failing('gemini-check'); if (f === 'timeout') { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; } if (f) return text('mock failure', Number(f));
        if (checkGemini.block) return json({ choices: [{ finish_reason: 'content_filter', native_finish_reason: 'IMAGE_SAFETY', message: { content: null } }] });
        const t = checkGemini.raw ?? JSON.stringify({ verdict: checkGemini.value });
        return json({ choices: [{ finish_reason: 'stop', message: { content: t } }] });
      }
      if (model.includes('flux.2-klein')) { count('klein', { model }); const f = failing('klein'); if (f) return text('mock failure', Number(f)); if (refuse.klein) return refusedImage; return json(img); }
      if (model.includes('grok-imagine')) { count('grok', { model }); const f = failing('grok'); if (f) return text('mock failure', Number(f)); if (refuse.grok) return refusedImage; return json(img); }
      if (model.includes('gemini-2.5-flash-image')) { count('gemini-image', { model }); const f = failing('gemini-image'); if (f) return text('mock failure', Number(f)); return json(img); }
      if (model.includes('nemotron')) {
        count('moderation', { model }); bodies.push({ provider: 'moderation', body });
        if (mode.moderation === 'timeout') { const e = new Error('The operation timed out'); e.name = 'TimeoutError'; throw e; }
        const f = failing('moderation'); if (f) return text('mock failure', Number(f));
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
      const f = failing(prov); if (f) return text('mock failure', Number(f));
      const userText = (body?.messages || []).map((m) => (typeof m.content === 'string' ? m.content : '')).join(' ');
      return json({ choices: [{ message: { content: isStoryboard ? storyboardJson() : scriptText(userText) } }] });
    }

    if (host === 'api.cohere.ai') {
      count('cohere'); const f = failing('cohere'); if (f) return json({ message: 'mock failure' }, Number(f));
      return json({ text: scriptText(body?.message || '') });
    }

    if (host === 'api.cloudflare.com' && u.pathname.includes('/ai/run/')) {
      count('cloudflare'); bodies.push({ provider: 'cloudflare', body }); const f = failing('cloudflare'); if (f) return text('mock failure', Number(f));
      if (refuse.cloudflare) return text('{"errors":[{"code":8007,"message":"AiError: Input prompt contains NSFW content"}],"success":false}', 400);
      if (mode.cloudflareSchema) return text('{"errors":[{"code":5006,"message":"Additional or unevaluated properties \'/seed\' at \'/\' not allowed"}]}', 400);
      return json({ result: { image: PNG_B64 }, success: true });
    }

    if (host === 'image.pollinations.ai') {   // still mocked so that a regression (anything calling it) is COUNTED and asserted on
      count('pollinations'); const f = failing('pollinations'); if (f) return text('mock failure', Number(f));
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
    handle, refuse, bodies, counts, log, telegram, s3puts, s3deletes, mode, latency, moderationVerdict, checkGemini, handlers, unexpected,
    reset() { for (const k of Object.keys(counts)) delete counts[k]; log.length = 0; telegram.length = 0; s3puts.length = 0; s3deletes.length = 0; for (const k of Object.keys(mode)) delete mode[k]; latency.gemini = null; moderationVerdict.value = 'safe'; moderationVerdict.raw = undefined; moderationVerdict.nonString = false; moderationVerdict.nullLength = false; moderationVerdict.queue.length = 0; checkGemini.value = 'safe'; checkGemini.raw = undefined; checkGemini.block = false; handlers.r2 = null; for (const k of Object.keys(refuse)) delete refuse[k]; bodies.length = 0; },
    snapshot() { return { ...counts, 'r2-put': s3puts.length }; },
    paidTotal() { return Object.entries(counts).filter(([k]) => PAID.has(k)).reduce((n, [, v]) => n + v, 0); },
    paid() { return Object.fromEntries(Object.entries(counts).filter(([k]) => PAID.has(k))); },
  };
}
