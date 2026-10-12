#!/usr/bin/env node
/**
 * ONE-OFF format probe for the output-image checker (lib/image-check.js). Not run by tests or by the app.
 *
 * For each image path given (1-4 HARMLESS images) it calls the free Nemotron checker once and prints ONE line:
 *     #<n> nemotron http=<status> ms=<latency> values=<safe|unsafe|none|empty|other>[,...]
 * `values` are the values of the reply's lines, reduced to the four allowed words (anything else prints as "other").
 * and, because the reply is classification TEXT (never image data), one more line with its raw shape:
 *     #<n> nemotron raw="<JSON-escaped content, max 500 chars>" finish=<finish_reason> native_finish=<native_finish_reason>
 *          message_keys=[...] reasoning=<true|false> refusal=<true|false>
 * With PROBE_GEMINI=1 and GOOGLE_GEMINI_API_KEY set it also prints, per image (paid, ~$0.0001 each):
 *     #<n> gemini   http=<status> ms=<latency> verdict=<safe|unsafe|other>
 * Nothing else is printed: no file names, no image data, no key.
 *
 * Keys are read from the environment only (hidden prompts in the zsh block; nothing lands in shell history).
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

let n = 0;
for (const file of files) {
  n += 1;
  const mime = MIME[path.extname(file).toLowerCase()];
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { bytes = null; }
  if (!mime || !bytes) { console.log(`#${n} nemotron http=- ms=0 values=unreadable-file`); continue; }
  const b64 = bytes.toString('base64');

  let t0 = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: NEMOTRON_SLUG, temperature: 0, max_tokens: 40, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } }, { type: 'text', text: 'Image to check.' }] }] }),
      signal: AbortSignal.timeout(20000),
    });
    const ms = Date.now() - t0;
    let values = '-';
    let rawLine = null;
    if (res.ok) {
      const data = await res.json();
      const choice = data?.choices?.[0];
      const content = choice?.message?.content;
      const msg = choice?.message && typeof choice.message === 'object' ? choice.message : {};
      const hasReasoning = ['reasoning', 'reasoning_content', 'reasoning_details'].some((k) => msg[k] !== undefined && msg[k] !== null && msg[k] !== '');
      const hasRefusal = msg.refusal !== undefined && msg.refusal !== null && msg.refusal !== '';
      rawLine = `#${n} nemotron raw=${JSON.stringify(typeof content === 'string' ? content.slice(0, 500) : content ?? null)} finish=${choice?.finish_reason ?? '-'} native_finish=${choice?.native_finish_reason ?? '-'} message_keys=${JSON.stringify(Object.keys(msg))} reasoning=${hasReasoning} refusal=${hasRefusal}`;
      values = typeof content === 'string'
        ? (content.split(/\r?\n/).filter((l) => l.trim()).map((l) => word(l.includes(':') ? l.slice(l.indexOf(':') + 1) : l)).join(',') || 'empty')
        : 'other';
    }
    console.log(`#${n} nemotron http=${res.status} ms=${ms} values=${values}`);
    if (rawLine) console.log(rawLine);
  } catch { console.log(`#${n} nemotron http=- ms=${Date.now() - t0} values=-`); }

  if (process.env.PROBE_GEMINI === '1' && process.env.GOOGLE_GEMINI_API_KEY) {
    t0 = Date.now();
    try {
      const model = process.env.IMAGE_CHECK_GEMINI_MODEL || 'gemini-2.5-flash-lite';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: b64 } }, { text: 'Content-safety review for a general-audience app. Answer "unsafe" if the image shows nudity, sexual content or a minor in a revealing context; otherwise "safe".' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { verdict: { type: 'STRING', enum: ['safe', 'unsafe'] } }, required: ['verdict'] }, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(20000),
      });
      const ms = Date.now() - t0;
      let verdict = '-';
      if (res.ok) {
        const text = (await res.json())?.candidates?.[0]?.content?.parts?.[0]?.text;
        try { verdict = word(JSON.parse(text)?.verdict); } catch { verdict = 'other'; }
        if (verdict === 'none' || verdict === 'empty') verdict = 'other';
      }
      console.log(`#${n} gemini   http=${res.status} ms=${ms} verdict=${verdict}`);
    } catch { console.log(`#${n} gemini   http=- ms=${Date.now() - t0} verdict=-`); }
  }
}
