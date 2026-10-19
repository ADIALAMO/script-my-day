#!/usr/bin/env node
/**
 * ONE-OFF probe: which OpenRouter models used by the script cascade accept `provider.data_collection: "deny"`, which provider served the call, and what a REAL
 * script call to google/gemini-2.5-flash costs (tokens incl. reasoning, latency). Goes around the app's circuit / budget / Redis. Not run by tests or the app.
 *
 *   OPENROUTER_API_KEY=… node scripts/probe-script-routes.mjs
 *
 * Output: HTTP status, serving provider, latency, token counts, error CLASS per item. No key, no prompt, no script text is printed or written.
 * Cost: about 16 tiny calls (< $0.001) + 2 real script calls (about $0.01).
 */
if (!process.env.OPENROUTER_API_KEY) { console.error('OPENROUTER_API_KEY is not set'); process.exit(2); }
if (process.env.UPSTASH_REDIS_REST_URL) { console.error('Refusing to run with UPSTASH_REDIS_REST_URL set.'); process.exit(2); }
globalThis._redisClient = {};
const { buildScriptPrompt } = await import('../lib/agent.js');
const URL_ = 'https://openrouter.ai/api/v1/chat/completions';

async function call(model, messages, extra = {}, timeoutMs = 60000) {
  const t0 = Date.now();
  try {
    const r = await fetch(URL_, {
      method: 'POST', signal: AbortSignal.timeout(timeoutMs),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'X-Title': 'LifeScript probe' },
      body: JSON.stringify({ model, messages, ...extra }),
    });
    const j = await r.json().catch(() => ({}));
    const u = j.usage || {};
    return {
      http: r.status, ms: Date.now() - t0, provider: j.provider || '-', in: u.prompt_tokens ?? '-', out: u.completion_tokens ?? '-',
      reasoning: u.completion_tokens_details?.reasoning_tokens ?? 0, cost: u.cost ?? '-',
      ok: !!j.choices?.[0]?.message?.content, err: r.ok ? '' : String(j.error?.message || '').replace(/sk-[A-Za-z0-9_-]+/g, '…').slice(0, 110),
    };
  } catch (e) { return { http: 0, ms: Date.now() - t0, provider: '-', ok: false, err: `${e.name}` }; }
}
const line = (label, r) => console.log(`${label.padEnd(34)} http=${r.http} ok=${r.ok} provider=${r.provider} ${r.ms}ms tokens=${r.in}/${r.out}${r.reasoning ? `(reasoning ${r.reasoning})` : ''} cost=${r.cost}${r.err ? `  err="${r.err}"` : ''}`);

const tiny = [{ role: 'user', content: 'Reply with the single word OK.' }];
const MODELS = ['google/gemini-2.5-flash', 'google/gemini-2.5-flash-lite', 'google/gemma-3-27b-it', 'google/gemma-3-12b-it', 'deepseek/deepseek-chat', 'google/gemma-4-31b-it:free'];
console.log('== tiny call: with deny vs without');
for (const m of MODELS) {
  line(`${m} +deny`, await call(m, tiny, { max_tokens: 8, provider: { data_collection: 'deny' } }));
  line(`${m} (default)`, await call(m, tiny, { max_tokens: 8 }));
}
console.log('== REAL script call, google/gemini-2.5-flash, deny');
const samples = [['en', 'I walked the dog in the park this morning and met an old friend. We talked for an hour about nothing and I felt lighter after.'], ['he', 'הלכתי עם הכלב בפארק הבוקר ופגשתי חבר ותיק. דיברנו שעה על כלום ואחר כך הרגשתי קל יותר.']];
for (const [lang, text] of samples) {
  const { messages } = buildScriptPrompt(text, 'comedy', 'medium', 'neutral', '', 'Dana');
  const msgs = messages.map((m) => ({ role: m.role === 'system' ? 'system' : 'user', content: m.content }));
  line(`${lang} default reasoning`, await call('google/gemini-2.5-flash', msgs, { max_tokens: 4000, temperature: 0.7, provider: { data_collection: 'deny' } }, 90000));
  line(`${lang} reasoning off`, await call('google/gemini-2.5-flash', msgs, { max_tokens: 4000, temperature: 0.7, reasoning: { effort: 'none' }, provider: { data_collection: 'deny' } }, 90000));
}
