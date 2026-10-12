// DRY RUN — prints the plan and cost estimate. Makes NO network calls and prints NO key values.
//   node tools/quality-eval/dry-run.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELS, PROBE_MODELS, JUDGES, PRICE_SOURCES, BUDGET_USD, GEN_CAP_USD, INPUT_TOKENS, HE_OUT_FACTOR } from './models.mjs';
import { ENTRIES } from './entries.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const envText = fs.existsSync(path.join(root, '.env.local')) ? fs.readFileSync(path.join(root, '.env.local'), 'utf8') : '';
const hasKey = (k) => !!process.env[k]?.trim() || new RegExp(`^${k}=.+`, 'm').test(envText);

const RUNS = 2;
const JUDGE_IN = 6500, JUDGE_OUT = 1200, JUDGE_OUT_WORST = 3500;   // ASSUMED per judge call
const RANDOM_PAIRS_PER_ENTRY = 2;

const he = ENTRIES.filter(e => e.lang === 'he').length, en = ENTRIES.length - he;
console.log(`Entries: ${ENTRIES.length} (${he} he / ${en} en), runs per (model, entry): ${RUNS}\n`);

let genCalls = 0, genExp = 0, genWorst = 0;
const rows = [];
for (const m of MODELS) {
  const sub = [...ENTRIES.filter(e => e.lang === 'he').slice(0, m.entries / 2), ...ENTRIES.filter(e => e.lang === 'en').slice(0, m.entries / 2)];
  let exp = 0, worst = 0;
  for (const e of sub) {
    const inTok = INPUT_TOKENS[e.lang], f = e.lang === 'he' ? HE_OUT_FACTOR : 1;
    exp   += RUNS * (inTok * m.in + Math.min(m.maxOut, m.expOut * f) * m.out) / 1e6;
    worst += RUNS * (inTok * m.in + m.maxOut * m.out) / 1e6;
  }
  const n = sub.length * RUNS;
  genCalls += n; genExp += exp; genWorst += worst;
  rows.push({ m, n, exp, worst });
}

console.log('GENERATION — production prompt (lib/agent.js buildScriptPrompt) + each stage\'s own request params:');
console.log('model | provider/key | free? | calls | est. cost (expected / worst-case) | price in/out per 1M | price source');
for (const { m, n, exp, worst } of rows) {
  const free = m.free ? 'FREE (OpenRouter :free key)' : m.provider === 'google' ? 'free-or-paid depends on your Google plan (UNKNOWN) — budgeted as PAID' : m.provider === 'cohere' ? 'paid if production key, free if trial (UNKNOWN) — budgeted as PAID' : 'PAID (OpenRouter credits)';
  const route = m.provider === 'google' ? 'Google direct (EVAL_GOOGLE_API_KEY)' : m.provider === 'cohere' ? 'Cohere direct' : `OpenRouter (${m.keyEnv})`;
  console.log(`- ${m.id} | ${route} | stage ${m.stage} | ${free} | ${n} calls | $${exp.toFixed(3)} / $${worst.toFixed(3)} | $${m.in}/$${m.out} | ${m.verified}`);
}
console.log(`- probes (free, 1 call each): ${PROBE_MODELS.map(p => p.id).join(', ')} — listed in code but missing from the live OpenRouter list`);
genCalls += PROBE_MODELS.length;

// ── Judging ──
const full = MODELS.filter(m => m.entries === 24 && m.id !== 'gemini-2.5-flash').length;
const basePairs = ENTRIES.length * full + MODELS.find(m => m.id === 'gemini-flash-latest').entries + MODELS.find(m => m.id === 'command-r-plus-08-2024').entries;
const pairs = basePairs + ENTRIES.length * RANDOM_PAIRS_PER_ENTRY;
const judgeCalls = pairs * JUDGES.length;
const jcost = (out) => judgeCalls * JUDGES.reduce((s, j) => s + (JUDGE_IN * j.in + out * j.out) / 1e6, 0) / JUDGES.length;
const jExp = jcost(JUDGE_OUT), jWorst = jcost(JUDGE_OUT_WORST);

console.log(`\nJUDGING — blind pairwise, order randomized, ${pairs} pairs (baseline gemini-2.5-flash vs every model on run-1 outputs: ${basePairs}; plus ${RANDOM_PAIRS_PER_ENTRY} random other pairs/entry) x ${JUDGES.length} judges = ${judgeCalls} calls`);
for (const j of JUDGES) console.log(`- judge ${j.id} via OpenRouter (paid) | $${j.in}/$${j.out} per 1M | ${j.verified} — not a model under test, so no model judges its own output`);
console.log(`  est. judging cost: $${jExp.toFixed(3)} expected / $${jWorst.toFixed(3)} worst-case (assumes ~${JUDGE_IN} in / ~${JUDGE_OUT} out tokens per call; ASSUMPTION)`);

console.log('\nTOTAL');
console.log(`- API calls: ${genCalls} generation + ${judgeCalls} judging = ${genCalls + judgeCalls}`);
console.log(`- Estimated cost: $${(genExp + jExp).toFixed(2)} expected, $${(genWorst + jWorst).toFixed(2)} worst-case (every call hitting its token cap; all Google/Cohere calls priced as PAID)`);
console.log(`- HARD CAP $${BUDGET_USD.toFixed(2)}: the runner keeps a ledger from the ACTUAL usage in each response (OpenRouter returns real cost), generation halts at $${GEN_CAP_USD.toFixed(2)} (entry-major order, so a partial stop stays balanced) and the whole run aborts if the running total would exceed the cap.`);
if (genWorst + jWorst > BUDGET_USD) console.log(`- NOTE: worst-case exceeds the cap, and the expected figure is close to it - the ledger/stop rule is what guarantees the cap; judging (fewer random pairs) is trimmed first if generation costs more than expected.`);

console.log('\nKEYS (presence only, values never printed):');
for (const k of ['EVAL_GOOGLE_API_KEY', 'OPENROUTER_API_KEY', 'OPENROUTER_FREE_KEY', 'COHERE_API_KEY']) console.log(`- ${k}: ${hasKey(k) ? 'present' : 'MISSING'}`);
console.log('\nPrice sources:', Object.entries(PRICE_SOURCES).map(([k, v]) => `${k}: ${v}`).join(' | '));
