// Models under test — mirrors lib/story-service.js (verified 2026-10-09 against the code and the live
// OpenRouter /api/v1/models list). Prices are USD per 1M tokens.
//   verified: 'google-pricing-page' | 'cohere-pricing-page' | 'openrouter-live-list' | 'UNVERIFIED'
// `calls` = how many entries (balanced he/en) × 2 runs. `prodTimeoutMs` = the timeout production uses for this model.
// `expOut` = ASSUMED typical output tokens (incl. Gemini thinking) for the expected-cost line; `maxOut` = the
// production max_tokens cap (Gemini counts thinking inside maxOutputTokens), used for the worst-case line.
export const PRICE_SOURCES = {
  google: 'https://ai.google.dev/gemini-api/docs/pricing',
  cohere: 'https://cohere.com/pricing',
  openrouter: 'https://openrouter.ai/api/v1/models',
};

export const MODELS = [
  { id: 'gemini-2.5-flash',              label: 'Gemini 2.5 Flash',        provider: 'google',     keyEnv: 'EVAL_GOOGLE_API_KEY', stage: '1 quality (first)', in: 0.30, out: 2.50, verified: 'google-pricing-page', prodTimeoutMs: 32000, maxOut: 4000, expOut: 3500, entries: 24 },
  { id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash (preview)',provider: 'google',     keyEnv: 'EVAL_GOOGLE_API_KEY', stage: '1 quality (hedge)', in: 0.50, out: 3.00, verified: 'google-pricing-page', prodTimeoutMs: 32000, maxOut: 4000, expOut: 3000, entries: 24 },
  { id: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash-Lite',   provider: 'google',     keyEnv: 'EVAL_GOOGLE_API_KEY', stage: '1 fast',            in: 0.25, out: 1.50, verified: 'google-pricing-page', prodTimeoutMs: 12000, maxOut: 4000, expOut: 2200, entries: 24 },
  { id: 'gemini-2.5-flash-lite',         label: 'Gemini 2.5 Flash-Lite',   provider: 'google',     keyEnv: 'EVAL_GOOGLE_API_KEY', stage: '1 fast',            in: 0.10, out: 0.40, verified: 'google-pricing-page', prodTimeoutMs: 12000, maxOut: 4000, expOut: 2000, entries: 24 },
  { id: 'gemini-flash-latest',           label: 'Gemini flash-latest (alias)', provider: 'google',  keyEnv: 'EVAL_GOOGLE_API_KEY', stage: '1 fast',            in: 0.50, out: 3.00, verified: 'UNVERIFIED (alias; assumed = 3-flash)', prodTimeoutMs: 12000, maxOut: 4000, expOut: 3000, entries: 8 },
  { id: 'google/gemma-3-27b-it',         label: 'Gemma 3 27B (OR)',        provider: 'openrouter', keyEnv: 'OPENROUTER_API_KEY',    stage: '2',                 in: 0.08, out: 0.45, verified: 'openrouter-live-list', prodTimeoutMs: 10000, maxOut: 2500, expOut: 1800, entries: 24 },
  { id: 'google/gemma-3-12b-it',         label: 'Gemma 3 12B (OR)',        provider: 'openrouter', keyEnv: 'OPENROUTER_API_KEY',    stage: '2',                 in: 0.05, out: 0.15, verified: 'openrouter-live-list', prodTimeoutMs: 10000, maxOut: 2500, expOut: 1800, entries: 24 },
  { id: 'command-r-plus-08-2024',        label: 'Cohere Command R+',       provider: 'cohere',     keyEnv: 'COHERE_API_KEY',        stage: '3',                 in: 2.50, out: 10.0, verified: 'cohere-pricing-page (production key; trial key = free, unknown)', prodTimeoutMs: 8000, maxOut: 4000, expOut: 1800, entries: 4 },
  { id: 'deepseek/deepseek-chat',        label: 'DeepSeek V3 (OR)',        provider: 'openrouter', keyEnv: 'OPENROUTER_API_KEY',    stage: '4',                 in: 0.32, out: 0.89, verified: 'openrouter-live-list (code/inventory said 0.2574/1.0287 — drifted)', prodTimeoutMs: 8000, maxOut: 3000, expOut: 1800, entries: 24 },
  { id: 'google/gemma-4-31b-it:free',    label: 'Gemma 4 31B :free (OR)',  provider: 'openrouter', keyEnv: 'OPENROUTER_FREE_KEY',   stage: '5',                 in: 0, out: 0, verified: 'openrouter-live-list ($0)', prodTimeoutMs: 12000, maxOut: 2500, expOut: 1800, entries: 24, free: true },
];

// Listed in code but absent from the live OpenRouter list → probed with ONE free call each, then dropped.
export const PROBE_MODELS = [
  { id: 'meta-llama/llama-3.3-70b-instruct:free', keyEnv: 'OPENROUTER_FREE_KEY' },
  { id: 'qwen/qwen3-next-80b-a3b-instruct:free',  keyEnv: 'OPENROUTER_FREE_KEY' },
];

// Judges: two models from families NOT under test (so nobody judges their own output), both via OpenRouter, paid.
export const JUDGES = [
  { id: 'anthropic/claude-haiku-5.5', in: 0.10, out: 0.50, verified: 'openrouter-live-list' },
  { id: 'openai/gpt-6-luna',          in: 0.10, out: 0.50, verified: 'openrouter-live-list' },
];

export const BUDGET_USD = 3.0;
export const GEN_CAP_USD = 2.2;       // generation stops here so judging always has room
export const INPUT_TOKENS = { he: 3600, en: 2900 };   // ASSUMED prompt size (measured 9.8-10.3k chars + entry)
export const HE_OUT_FACTOR = 1.3;     // ASSUMED: Hebrew costs more output tokens than English
