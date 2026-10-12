// Shared helpers for the script-quality benchmark. NEVER logs or writes key values.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildScriptPrompt } from '../../lib/agent.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const OUT = path.join(ROOT, 'tools/quality-eval/outputs');
export const PRIVATE = path.join(ROOT, 'docs-private');
fs.mkdirSync(path.join(OUT, 'gen'), { recursive: true });
fs.mkdirSync(path.join(OUT, 'judge'), { recursive: true });
fs.mkdirSync(PRIVATE, { recursive: true });

// ── env (process.env wins, then .env.local). Values stay in memory only. ──
const envFile = {};
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) envFile[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch {}
export const key = (k) => (process.env[k]?.trim() || envFile[k] || '').trim();

// ISOLATION: Google calls use ONLY EVAL_GOOGLE_API_KEY (a key/project separate from production's GOOGLE_GEMINI_API_KEY /
// GEMINI_API_KEY, so the benchmark can never burn the live app's quota). Fail closed: no fallback, and refuse a key that
// is identical to a production one.
export function requireEvalGoogleKey() {
  const k = key('EVAL_GOOGLE_API_KEY');
  if (!k) throw new Error('EVAL_GOOGLE_API_KEY is not set (.env.local). Google models are skipped: this tool never falls back to GOOGLE_GEMINI_API_KEY / GEMINI_API_KEY.');
  for (const prod of ['GOOGLE_GEMINI_API_KEY', 'GEMINI_API_KEY']) {
    if (key(prod) && key(prod) === k) throw new Error(`EVAL_GOOGLE_API_KEY is identical to ${prod}; use a separate key/project for the benchmark.`);
  }
  return k;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
export const writeJson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 1));

// ── cost ledger shared by generation and judging (persisted so a restart keeps the total) ──
const LEDGER = path.join(OUT, 'ledger.json');
export const ledger = fs.existsSync(LEDGER) ? readJson(LEDGER) : { real: 0, notional: 0, calls: 0, byModel: {} };
export function charge(model, real, notional) {
  ledger.real += real; ledger.notional += notional; ledger.calls += 1;
  const b = (ledger.byModel[model] ||= { real: 0, notional: 0, calls: 0 });
  b.real += real; b.notional += notional; b.calls += 1;
  writeJson(LEDGER, ledger);
}
// notional = what it would cost on a paid plan; the cap is enforced on notional (conservative, includes Google free-plan calls).
export const capLeft = (cap) => cap - ledger.notional;

// ── production prompt ──
export function buildPrompt(entry) {
  // generate-script.js passes sanitize(journalEntry), genre, gender → generateScript → buildScriptPrompt(..., 'medium', gender)
  return buildScriptPrompt(entry.text, entry.genre, 'medium', entry.gender);
}

// Reproduction of lib/story-service.js enforceLanguagePurity (not exported there).
export function enforceLanguagePurity(output, lang) {
  if (lang !== 'he' || !output) return output;
  return output
    .replace(/\*\*\s*THE\s+END\s*\*\*/gi, '**סוף**')
    .replace(/(^|\n)[ \t]*THE\s+END[ \t]*(?=\r?\n|$)/gi, '$1סוף');
}

// Reproduction of the Gemini-stage acceptance checks in raceGeminiModels.
export function geminiAccept(text, lang, model) {
  if (!text) return `${model} empty response`;
  if (text.trim().length < 500) return `${model} truncated (${text.trim().length} chars)`;
  const heb = (text.slice(0, 200).match(/[֐-׿]/g) || []).length;
  if (lang === 'he' && heb < 5) return `${model} language mismatch`;
  if (lang === 'en' && heb > 15) return `${model} language mismatch`;
  return null;
}

// ── format analysis: what the client (ScriptOutput.jsx) and the SYSTEM_PROMPT demand ──
export function analyzeFormat(raw, lang) {
  const text = raw || '';
  const m = text.toLowerCase().indexOf('[image:');
  const end = m === -1 ? -1 : text.indexOf(']', m);
  const imageOk = m !== -1 && end !== -1;                       // the client's parser needs a closed [image: …]
  const body = imageOk ? text.slice(0, m).trim() : text;
  // Tolerant of missing bold (** **) — the app renders either way; `boldHeadings` records strict compliance separately.
  const plain = body.replace(/\*/g, '');
  const sceneRe = lang === 'he' ? /(^|\n)\s*סצנה\s*\d+/g : /(^|\n)\s*SCENE\s*\d+/gi;
  const scenes = (plain.match(sceneRe) || []).length;
  const boldHeadings = (lang === 'he' ? /\*\*\s*סצנה\s*\d+/ : /\*\*\s*SCENE\s*\d+/i).test(body);
  const tail = plain.trim();
  const finalBeat = lang === 'he' ? /(^|\n)\s*סוף\s*\.?\s*$/.test(tail) : /(^|\n)\s*THE END\s*\.?\s*$/i.test(tail);
  const charsHeader = lang === 'he' ? /(^|\n)\s*דמויות\s*:/.test(plain) : /(^|\n)\s*CHARACTERS\s*:/i.test(plain);
  const openingHeader = lang === 'he' ? /(^|\n)\s*פתיחה\s*:/.test(plain) : /(^|\n)\s*OPENING\s*:/i.test(plain);
  const firstLine = (plain.split('\n').find((l) => l.trim()) || '').replace(/^(title|כותרת)\s*:\s*/i, '');
  const titlePrefix = /^\s*\**\s*(title|כותרת|הסרט)\s*:/i.test(body);
  const titleWords = firstLine.replace(/\*/g, '').trim().split(/\s+/).filter(Boolean).length;
  const heb = (body.match(/[֐-׿]/g) || []).length;
  // stray Latin words inside a Hebrew script (INT/EXT/DAY/NIGHT/FADE etc. allowed only as headings)
  const latinWords = lang === 'he' ? (body.match(/[A-Za-z]{3,}/g) || []).filter((w) => !/^(INT|EXT|DAY|NIGHT)$/i.test(w)).length : 0;
  const words = body.split(/\s+/).filter(Boolean).length;
  const issues = [];
  if (!imageOk) issues.push('no-closed-image-line');
  if (scenes < 5 || scenes > 8) issues.push(`scenes=${scenes}`);
  if (!finalBeat) issues.push('no-final-beat');
  if (!charsHeader) issues.push('no-characters-header');
  if (!openingHeader) issues.push('no-opening-header');
  if (titlePrefix) issues.push('title-prefix');
  if (!boldHeadings) issues.push('headings-not-bold');
  if (titleWords > 4) issues.push(`title-words=${titleWords}`);
  if (lang === 'en' && heb > 0) issues.push(`hebrew-chars-in-english=${heb}`);
  if (lang === 'he' && latinWords > 0) issues.push(`latin-words-in-hebrew=${latinWords}`);
  return { imageOk, boldHeadings, titlePrefix, scenes, sceneCountOk: scenes >= 5 && scenes <= 8, finalBeat, charsHeader, openingHeader, titleWords, latinWords, words,
    // formatOk = everything the app strictly relies on or the prompt marks MANDATORY
    formatOk: imageOk && scenes >= 5 && scenes <= 8 && finalBeat && charsHeader, issues };
}

// ── provider callers: return { text, usage:{in,out,think}, orCost?, status } or throw Error("<name> <status>: …") ──
async function postJson(url, headers, body, ceilingMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ceilingMs);
  try {
    const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ac.signal });
    const raw = await resp.text();
    let data; try { data = JSON.parse(raw); } catch { data = null; }
    return { ok: resp.ok, status: resp.status, data, raw: raw.slice(0, 300) };
  } finally { clearTimeout(t); }
}

export async function callModel(model, messages, lang, ceilingMs = 60000) {
  const k = model.provider === 'google' ? requireEvalGoogleKey() : key(model.keyEnv);
  if (!k) throw Object.assign(new Error(`${model.id} no key`), { status: 0 });
  if (model.provider === 'google') {
    const contents = messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
    const r = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model.id}:generateContent`, { 'x-goog-api-key': k },
      { contents, generationConfig: { temperature: 0.7, maxOutputTokens: 4000 } }, ceilingMs);
    if (!r.ok) throw Object.assign(new Error(`${model.id} HTTP ${r.status}: ${(r.data?.error?.message || r.raw).slice(0, 160)}`), { status: r.status });
    const u = r.data?.usageMetadata || {};
    return { text: r.data?.candidates?.[0]?.content?.parts?.[0]?.text || '', finish: r.data?.candidates?.[0]?.finishReason,
      usage: { in: u.promptTokenCount || 0, out: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0), think: u.thoughtsTokenCount || 0 } };
  }
  if (model.provider === 'cohere') {
    const r = await postJson('https://api.cohere.ai/v1/chat', { Authorization: `Bearer ${k}`, 'Request-Source': 'LifeScript-Studio' }, {
      model: model.id,
      message: messages[messages.length - 1].content,
      chat_history: messages.slice(0, -1).map((m) => ({ role: m.role === 'assistant' ? 'CHATBOT' : 'USER', message: m.content })),
      preamble: lang === 'he'
        ? 'You are a professional screenwriter. Return ONLY the screenplay text in Hebrew. No intro, no chat.'
        : 'You are a professional screenwriter. Return ONLY the screenplay text in English. No intro, no chat.',
    }, ceilingMs);
    if (!r.ok) throw Object.assign(new Error(`Cohere ${r.status}: ${(r.data?.message || r.raw).slice(0, 160)}`), { status: r.status });
    const b = r.data?.meta?.billed_units || r.data?.meta?.tokens || {};
    return { text: r.data?.text || '', usage: { in: b.input_tokens || 0, out: b.output_tokens || 0, think: 0 } };
  }
  // OpenRouter — request shape per stage (see story-service.js). `usage.include` only adds accounting to the response.
  const isGemma = model.id.startsWith('google/gemma-3');
  const isDeepseek = model.id.startsWith('deepseek');
  const msgs = isGemma ? messages.map((m) => ({ role: m.role === 'system' ? 'user' : m.role, content: m.role === 'system' ? `[INSTRUCTION]: ${m.content}` : m.content })) : messages;
  const headers = { Authorization: `Bearer ${k}`, 'HTTP-Referer': 'https://lifescript.app', 'X-Title': 'LifeScript Studio', ...(isGemma ? { 'OR-Identify': 'true' } : {}) };
  const r = await postJson('https://openrouter.ai/api/v1/chat/completions', headers, {
    model: model.id, messages: msgs, temperature: isDeepseek ? 0.9 : 0.8, max_tokens: model.maxOut, usage: { include: true },
  }, ceilingMs);
  if (!r.ok) throw Object.assign(new Error(`${model.id} ${r.status}: ${(r.data?.error?.message || r.raw).slice(0, 160)}`), { status: r.status });
  const u = r.data?.usage || {};
  return { text: r.data?.choices?.[0]?.message?.content || '', finish: r.data?.choices?.[0]?.finish_reason, orCost: typeof u.cost === 'number' ? u.cost : null,
    usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0, think: u.completion_tokens_details?.reasoning_tokens || 0 } };
}

// Generic OpenRouter chat for judges (paid key). Returns text + usage + real cost.
export async function callJudge(judge, system, user, maxTokens = 3500, ceilingMs = 120000) {
  const k = key('OPENROUTER_API_KEY');
  const r = await postJson('https://openrouter.ai/api/v1/chat/completions',
    { Authorization: `Bearer ${k}`, 'HTTP-Referer': 'https://lifescript.app', 'X-Title': 'LifeScript quality eval' },
    { model: judge.id, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0, max_tokens: maxTokens, usage: { include: true } }, ceilingMs);
  if (!r.ok) throw Object.assign(new Error(`${judge.id} ${r.status}: ${(r.data?.error?.message || r.raw).slice(0, 160)}`), { status: r.status });
  const u = r.data?.usage || {};
  return { text: r.data?.choices?.[0]?.message?.content || '', orCost: typeof u.cost === 'number' ? u.cost : null,
    usage: { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 } };
}

export const notional = (model, usage) => ((usage.in * model.in + usage.out * model.out) / 1e6);
export const slug = (s) => s.replace(/[^a-zA-Z0-9.-]+/g, '_');
