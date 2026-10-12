#!/usr/bin/env node
/**
 * ONE-OFF format probe for the output-image checker (lib/image-check.js). NOT run by tests, never run automatically.
 *
 * Sends 1-3 HARMLESS images that YOU pass as file paths (suggested: a landscape photo, a clothed portrait, a comic panel with
 * no skin exposure) to the free Nemotron model and prints ONLY the shape of each reply: HTTP status, latency, the field names,
 * and values only when they are one of safe / unsafe / none / empty. Any other text is reduced to its length. No image data,
 * no raw reply text and no key is ever printed or written.
 *
 * Keys come from the environment (see the zsh block in the report: hidden `read -s` prompts, nothing lands in history).
 *   OPENROUTER_API_KEY      required
 *   GOOGLE_GEMINI_API_KEY   optional — only with PROBE_GEMINI=1; costs ~$0.0001 per image (the paid fallback)
 *
 *   node scripts/probe-image-check.mjs landscape.jpg portrait.jpg panel.png
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseNemotronVerdict, parseGeminiVerdict, NEMOTRON_SLUG } from '../lib/image-check.js';

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const files = process.argv.slice(2);
if (!files.length || files.length > 3) { console.error('usage: node scripts/probe-image-check.mjs <image> [<image> [<image>]]   (max 3 harmless images)'); process.exit(2); }
if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is not set'); process.exit(2); }
if (process.env.UPSTASH_REDIS_REST_URL) { console.error('Refusing to run with UPSTASH_REDIS_REST_URL set — the probe must not touch the production Redis. Unset it.'); process.exit(2); }

const SAFE_TOKENS = new Set(['safe', 'unsafe', 'none', '']);
const describeValue = (v) => (SAFE_TOKENS.has(v.trim().toLowerCase()) ? JSON.stringify(v.trim().toLowerCase()) : `<${v.trim().length} chars>`);

function shape(content) {
  if (typeof content !== 'string') return { type: typeof content };
  return {
    type: 'string',
    lines: content.split(/\r?\n/).filter((l) => l.trim()).map((l) => {
      const m = /^([^:]{1,30}):(.*)$/.exec(l.trim());
      return m ? { field: m[1], value: describeValue(m[2]) } : { unstructured: `<${l.trim().length} chars>` };
    }),
  };
}

for (const file of files) {
  const mime = MIME[path.extname(file).toLowerCase()];
  if (!mime) { console.error(`${path.basename(file)}: unsupported extension`); continue; }
  const bytes = fs.readFileSync(file);
  const uri = `data:${mime};base64,${bytes.toString('base64')}`;
  const out = { file: path.basename(file), bytes: bytes.length };

  const t0 = Date.now();
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: NEMOTRON_SLUG, temperature: 0, max_tokens: 40, messages: [{ role: 'user', content: [{ type: 'image_url', image_url: { url: uri } }, { type: 'text', text: 'Image to check.' }] }] }),
      signal: AbortSignal.timeout(20000),
    });
    out.nemotron = { http: res.status, ms: Date.now() - t0 };
    if (res.ok) {
      const content = (await res.json())?.choices?.[0]?.message?.content;
      out.nemotron.reply = shape(content);
      out.nemotron.parsedByStrictParser = parseNemotronVerdict(content);
    }
  } catch (e) { out.nemotron = { error: e.name, ms: Date.now() - t0 }; }

  if (process.env.PROBE_GEMINI === '1' && process.env.GOOGLE_GEMINI_API_KEY) {
    const t1 = Date.now();
    try {
      const model = process.env.IMAGE_CHECK_GEMINI_MODEL || 'gemini-2.5-flash-lite';
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GOOGLE_GEMINI_API_KEY}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: mime, data: bytes.toString('base64') } }, { text: 'Content-safety review for a general-audience app. Answer "unsafe" if the image shows nudity, sexual content or a minor in a revealing context; otherwise "safe".' }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20, responseMimeType: 'application/json', responseSchema: { type: 'OBJECT', properties: { verdict: { type: 'STRING', enum: ['safe', 'unsafe'] } }, required: ['verdict'] }, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(20000),
      });
      out.gemini = { http: res.status, ms: Date.now() - t1 };
      if (res.ok) { const data = await res.json(); out.gemini.parsedByStrictParser = parseGeminiVerdict(data); out.gemini.usage = data?.usageMetadata ? { promptTokens: data.usageMetadata.promptTokenCount, outputTokens: data.usageMetadata.candidatesTokenCount } : undefined; }
    } catch (e) { out.gemini = { error: e.name, ms: Date.now() - t1 }; }
  }
  console.log(JSON.stringify(out, null, 2));
}
