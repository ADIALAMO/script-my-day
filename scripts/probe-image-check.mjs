#!/usr/bin/env node
/**
 * ONE-OFF format probe for the output-image checker (lib/image-check.js). Not run by tests or by the app.
 *
 * Sends 1-4 HARMLESS images (file paths) to the free Nemotron checker in up to three request VARIANTS and prints ONE line per
 * image and variant (reply text and reasoning text are model output, never image data, so they are printed, truncated):
 *     #<n> <variant> http=<status> ms=<latency> finish=<finish_reason> usage=<prompt>/<completion>/reasoning:<n>
 *          values=<safe|unsafe|none|empty|other,...> raw="<content, JSON-escaped, <=500 chars>"
 *          reasoning=<true|false> reasoning_text="<JSON-escaped, <=300 chars>"
 * Variants: legacy (what moderateImage sent on main), larger (max_tokens 2048), reasoning-<effort> (PROBE_REASONING_EFFORT,
 * default none). With PROBE_GEMINI=1 it also calls the paid FALLBACK checker (Gemini 2.5 Flash-Lite through OpenRouter, same
 * key, data_collection deny) and prints: #<n> fallback http=… ms=… finish=… verdict=<safe|unsafe|other> usage=<prompt>/<completion>
 * (on an HTTP error: a short JSON-escaped slice of the error text, which shows e.g. a data-policy routing failure).
 * No file names, no image data, no key is ever printed. Keys come from the environment only (hidden prompts in the zsh block).
 */
import fs from 'node:fs';
import path from 'node:path';

const NEMOTRON_SLUG = 'nvidia/nemotron-3.5-content-safety:free';   // keep in sync with lib/image-check.js
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
// a pasted path may carry surrounding quotes / spaces ('/Users/x/Downloads/a b.png') — strip them
const unquote = (p) => String(p).trim().replace(/^(['"])(.*)\1$/, '$2').trim();
const files = process.argv.slice(2).map(unquote).filter(Boolean);
if (!files.length || files.length > 4) { console.error('usage: node scripts/probe-image-check.mjs <image> [... up to 4 images]'); process.exit(2); }
if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is not set'); process.exit(2); }
if (process.env.UPSTASH_REDIS_REST_URL) { console.error('Refusing to run with UPSTASH_REDIS_REST_URL set.'); process.exit(2); }

const ALLOWED = new Set(['safe', 'unsafe', 'none']);
const word = (v) => { const t = String(v).trim().toLowerCase(); return t === '' ? 'empty' : ALLOWED.has(t) ? t : 'other'; };

// Request variants. 'legacy' is EXACTLY what moderateImage() sent on main (no max_tokens, no temperature, text first);
// 'larger' is the lib/image-check.js shape with a big token budget; 'reasoning' adds OpenRouter's reasoning option
// (PROBE_REASONING_EFFORT, default none; try minimal / low). PROBE_VARIANTS=legacy,larger,reasoning picks a subset.
const EFFORT = process.env.PROBE_REASONING_EFFORT || 'none';
const stub = (url) => [{ type: 'image_url', image_url: { url } }, { type: 'text', text: 'Image to check.' }];
const ALL_VARIANTS = [
  { name: 'legacy', body: (url) => ({ model: NEMOTRON_SLUG, messages: [{ role: 'user', content: [{ type: 'text', text: 'Classify this image for content safety. Answer "safe" or "unsafe".' }, { type: 'image_url', image_url: { url } }] }] }) },
  { name: 'larger', body: (url) => ({ model: NEMOTRON_SLUG, temperature: 0, max_tokens: 2048, messages: [{ role: 'user', content: stub(url) }] }) },
  { name: `reasoning-${EFFORT}`, key: 'reasoning', body: (url) => ({ model: NEMOTRON_SLUG, temperature: 0, max_tokens: 512, reasoning: { effort: EFFORT }, messages: [{ role: 'user', content: stub(url) }] }) },
];
const wanted = (process.env.PROBE_VARIANTS || 'legacy,larger,reasoning').split(',').map((x) => x.trim());
const VARIANTS = ALL_VARIANTS.filter((v) => wanted.includes(v.key || v.name));

let n = 0;
for (const file of files) {
  n += 1;
  const mime = MIME[path.extname(file).toLowerCase()];
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { bytes = null; }
  if (!mime || !bytes) { console.log(`#${n} nemotron http=- ms=0 values=unreadable-file`); continue; }
  const b64 = bytes.toString('base64');

  let t0;
  for (const v of VARIANTS) {
    t0 = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(v.body(`data:${mime};base64,${b64}`)),
        signal: AbortSignal.timeout(90000),
      });
      const ms = Date.now() - t0;
      let line = `#${n} ${v.name} http=${res.status} ms=${ms}`;
      if (res.ok) {
        const data = await res.json();
        const choice = data?.choices?.[0];
        const msg = choice?.message && typeof choice.message === 'object' ? choice.message : {};
        const content = msg.content;
        const reasoning = msg.reasoning ?? msg.reasoning_content ?? msg.reasoning_details;
        const hasReasoning = reasoning !== undefined && reasoning !== null && reasoning !== '' && !(Array.isArray(reasoning) && !reasoning.length);
        const u = data?.usage;
        const values = typeof content === 'string' ? (content.split(/\r?\n/).filter((l) => l.trim()).map((l) => word(l.includes(':') ? l.slice(l.indexOf(':') + 1) : l)).join(',') || 'empty') : '-';
        line += ` finish=${choice?.finish_reason ?? '-'} usage=${u ? `${u.prompt_tokens ?? '-'}/${u.completion_tokens ?? '-'}/reasoning:${u.completion_tokens_details?.reasoning_tokens ?? '-'}` : '-'}`
          + ` values=${values} raw=${JSON.stringify(typeof content === 'string' ? content.slice(0, 500) : content ?? null)}`
          + ` reasoning=${hasReasoning} reasoning_text=${JSON.stringify(hasReasoning ? (typeof reasoning === 'string' ? reasoning : JSON.stringify(reasoning)).slice(0, 300) : null)}`;
      }
      console.log(line);
    } catch { console.log(`#${n} ${v.name} http=- ms=${Date.now() - t0}`); }
  }

  if (process.env.PROBE_GEMINI === '1') {
    // the paid FALLBACK checker exactly as lib/image-check.js sends it: Gemini 2.5 Flash-Lite through OpenRouter (same key)
    t0 = Date.now();
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.IMAGE_CHECK_FALLBACK_MODEL || 'google/gemini-2.5-flash-lite', temperature: 0, max_tokens: 256,
          provider: { data_collection: 'deny' },
          response_format: { type: 'json_schema', json_schema: { name: 'safety_verdict', strict: true, schema: { type: 'object', properties: { verdict: { type: 'string', enum: ['safe', 'unsafe'] } }, required: ['verdict'], additionalProperties: false } } },
          messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }, { type: 'text', text: 'Content-safety review for a general-audience app. Answer "unsafe" if the image shows nudity, partial nudity, sexual or erotic content, a sexualized or undressed person of any age, a minor in any revealing or sexual context, or graphic gore; otherwise answer "safe".' }] }],
        }),
        signal: AbortSignal.timeout(30000),
      });
      const ms = Date.now() - t0;
      let line = `#${n} fallback http=${res.status} ms=${ms}`;
      if (res.ok) {
        const data = await res.json();
        const choice = data?.choices?.[0];
        let verdict = 'other';
        try { verdict = word(JSON.parse(choice?.message?.content)?.verdict); } catch { /* other */ }
        if (verdict === 'none' || verdict === 'empty') verdict = 'other';
        const u = data?.usage;
        line += ` finish=${choice?.finish_reason ?? '-'} verdict=${verdict} usage=${u ? `${u.prompt_tokens ?? '-'}/${u.completion_tokens ?? '-'}` : '-'}`;
      } else {
        // an error body is provider text, not image data: show a short, JSON-escaped slice (e.g. "no endpoints match your data policy")
        line += ` error=${JSON.stringify((await res.text()).slice(0, 200))}`;
      }
      console.log(line);
    } catch { console.log(`#${n} fallback http=- ms=${Date.now() - t0}`); }
  }
}
