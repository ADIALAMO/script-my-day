// Paid generation run. Resumable: existing outputs/gen/*.json are skipped.
//   node tools/quality-eval/generate.mjs [--smoke]      (--smoke: 1 entry, 1 run, every model)
import fs from 'node:fs';
import path from 'node:path';
import { MODELS, PROBE_MODELS, GEN_CAP_USD } from './models.mjs';
import { ENTRIES } from './entries.mjs';
import { OUT, readJson, requireEvalGoogleKey, buildPrompt, callModel, charge, ledger, capLeft, geminiAccept, enforceLanguagePurity, analyzeFormat, notional, slug, sleep, writeJson } from './lib.mjs';

const SMOKE = process.argv.includes('--smoke');
const RETRY_QUOTA = process.argv.includes('--retry-quota-errors');   // re-run ONLY records whose stored error is HTTP 429
const RUNS = SMOKE ? 1 : 2;
const CONC = { google: 3, openrouter: 4, cohere: 1, free: 1 };
const FREE_GAP_MS = 4000; // OpenRouter :free = 20 req/min

const subset = (m) => SMOKE ? [ENTRIES[0], ENTRIES[12]]
  : [...ENTRIES.filter((e) => e.lang === 'he').slice(0, m.entries / 2), ...ENTRIES.filter((e) => e.lang === 'en').slice(0, m.entries / 2)];

// Task order: entry-major, then run, then model → a cap-induced stop leaves a balanced grid.
const tasks = [];
const order = ENTRIES.map((e) => e.id);
for (const entryId of order) for (let run = 1; run <= RUNS; run++) for (const m of MODELS) {
  const e = subset(m).find((x) => x.id === entryId);
  if (e) tasks.push({ m, e, run, lane: m.free ? 'free' : m.provider });
}

const fileFor = (m, e, run) => path.join(OUT, 'gen', `${slug(m.id)}__${e.id}__r${run}.json`);
let MODELS_SKIP_GOOGLE = false;
let stopped = false, done = 0, skipped = 0;

async function runTask({ m, e, run }) {
  const f = fileFor(m, e, run);
  if (m.provider === 'google' && MODELS_SKIP_GOOGLE) { skipped++; return; }
  if (fs.existsSync(f)) {
    const old = RETRY_QUOTA ? readJson(f) : null;
    if (!(old && !old.ok && Number(old.status) === 429)) { skipped++; return; }   // finished or non-429 failure → keep as is
  } else if (RETRY_QUOTA) { skipped++; return; }                                  // retry mode never creates new cells
  const worst = notional(m, { in: 4000, out: m.maxOut });
  if (capLeft(GEN_CAP_USD) < worst + 0.02) { stopped = true; return; }
  const { messages, lang } = buildPrompt(e);
  let attempt = 0, rec;
  for (;;) {
    attempt++;
    const t0 = performance.now();
    try {
      const r = await callModel(m, messages, lang);
      const latencyMs = Math.round(performance.now() - t0);
      const text = enforceLanguagePurity(r.text, lang);
      // production acceptance: Gemini stage validates length+language; other stages only need non-empty text
      const rejected = m.provider === 'google' ? geminiAccept(r.text, lang, m.id) : (r.text ? null : `${m.id} empty`);
      const notionalCost = notional(m, r.usage);
      const real = m.provider === 'google' ? 0 : (r.orCost ?? notionalCost);
      charge(m.id, real, r.orCost ?? notionalCost);
      rec = { model: m.id, entry: e.id, lang, run, ok: true, rejectedByProd: rejected, withinProdTimeout: latencyMs <= m.prodTimeoutMs,
        latencyMs, usage: r.usage, finish: r.finish, costReal: real, costNotional: r.orCost ?? notionalCost, retries: attempt - 1,
        fmt: analyzeFormat(text, lang), text, ts: new Date().toISOString() };
      break;
    } catch (err) {
      const latencyMs = Math.round(performance.now() - t0);
      const st = err.status ?? (err.name === 'AbortError' ? 'timeout' : 0);
      const maxTry = m.free ? 6 : 3;
      if ((st === 429 || st === 503 || st === 500) && attempt <= maxTry) { await sleep((m.free ? 15000 : 8000) * attempt); continue; }
      rec = { model: m.id, entry: e.id, lang, run, ok: false, error: String(err.message).slice(0, 300), status: st, latencyMs, retries: attempt - 1, ts: new Date().toISOString() };
      break;
    }
  }
  writeJson(f, rec); done++;
  const flag = rec.ok ? (rec.rejectedByProd ? `REJECTED(${rec.rejectedByProd})` : 'ok') : `ERR ${rec.status}`;
  console.log(`[${done}] ${m.id} ${e.id} r${run} ${flag} ${rec.latencyMs}ms  ledger=$${ledger.notional.toFixed(3)} (real $${ledger.real.toFixed(3)})`);
}

async function lane(name, list) {
  let i = 0, lastFree = 0;
  await Promise.all(Array.from({ length: CONC[name] }, async () => {
    while (!stopped) {
      const t = list[i++]; if (!t) return;
      if (name === 'free') { const w = lastFree + FREE_GAP_MS - Date.now(); lastFree = Math.max(Date.now(), lastFree + FREE_GAP_MS); if (w > 0) await sleep(w); }
      await runTask(t);
    }
  }));
}

// Probes first (free): is each listed-but-missing model still alive, and how long does a dead one take to fail?
async function probes() {
  for (const p of PROBE_MODELS) {
    const f = path.join(OUT, 'gen', `PROBE__${slug(p.id)}.json`);
    if (fs.existsSync(f)) continue;
    const { messages } = buildPrompt(ENTRIES[0]);
    const t0 = performance.now();
    let rec;
    try {
      const r = await callModel({ ...p, provider: 'openrouter', maxOut: 2500 }, messages, 'he', 20000);
      rec = { model: p.id, alive: !!r.text, latencyMs: Math.round(performance.now() - t0), chars: r.text.length };
    } catch (err) { rec = { model: p.id, alive: false, status: err.status ?? 0, error: String(err.message).slice(0, 200), latencyMs: Math.round(performance.now() - t0) }; }
    writeJson(f, rec); console.log('PROBE', rec.model, rec.alive ? 'ALIVE' : `dead (${rec.status}) ${rec.latencyMs}ms`);
    await sleep(FREE_GAP_MS);
  }
}

if (RETRY_QUOTA) console.log('retry mode: only 429-failed records are re-run; the cap and ledger are unchanged');
if (tasks.some((t) => t.m.provider === 'google') && !(RETRY_QUOTA && !fs.readdirSync(path.join(OUT, 'gen')).length)) {
  try { requireEvalGoogleKey(); } catch (err) { console.error('FAIL-CLOSED:', err.message); MODELS_SKIP_GOOGLE = true; }
}
if (!RETRY_QUOTA) await probes();
const by = (n) => tasks.filter((t) => t.lane === n);
await Promise.all(['google', 'openrouter', 'cohere', 'free'].map((n) => lane(n, by(n))));
console.log(`\nDONE: ${done} new, ${skipped} skipped, stopped-by-cap=${stopped}. Ledger: notional $${ledger.notional.toFixed(3)}, real $${ledger.real.toFixed(3)}, calls ${ledger.calls}`);
