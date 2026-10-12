// Blind pairwise LLM judging (two judges from families that are NOT under test). Resumable.
//   node tools/quality-eval/judge.mjs [--smoke] [--random=N]
import fs from 'node:fs';
import path from 'node:path';
import { JUDGES, BUDGET_USD } from './models.mjs';
import { ENTRIES } from './entries.mjs';
import { OUT, callJudge, charge, ledger, capLeft, readJson, writeJson, slug, sleep } from './lib.mjs';

const SMOKE = process.argv.includes('--smoke');
const RANDOM_PER_ENTRY = Number((process.argv.find((a) => a.startsWith('--random=')) || '--random=2').split('=')[1]);
const arg = (n, d = '') => (process.argv.find((a) => a.startsWith(`--${n}=`)) || `--${n}=${d}`).split('=').slice(1).join('=');
const LANG = arg('lang');                                   // 'he' | 'en' | '' (both)
const ONLY_MODELS = arg('models') ? arg('models').split(',') : null;   // finalists second pass: pairs among these only
const JUDGE_OVERRIDE = arg('judge');                        // e.g. a stronger judge model id
// Excluded from the ranking: incomplete / too slow / rate-limited / dead (raw records are kept)
const EXCLUDED = new Set(['google/gemma-4-31b-it:free', 'command-r-plus-08-2024']);
const BASELINE = 'gemini-2.5-flash';
const CONC = 6;

const SYSTEM = `You are two experts reading at once: (1) a veteran screenwriter and script doctor, and (2) a Hollywood development executive who reads hundreds of scripts a year.
The product turns a person's diary entry into a SHORT cinematic screenplay. Judge each script as a real script reader would: logline clarity, a hook in the first beat, scene economy, three-act shape even in a few pages, character voice and subtext, show-don't-tell, natural dialogue, emotional truth, visual action lines, correct screenplay formatting (sluglines, parentheticals, transitions), originality versus cliche, and whether a producer would keep reading.
Be demanding and specific, not flattering. Do NOT reward length for its own sake: a tight script beats a padded one. For Hebrew scripts also judge as a native Hebrew editor: grammar, gender agreement, register, natural phrasing, no unintended English words or literal translations.
You will see the original diary entry and two anonymous scripts, A and B. Score each 1-5 (1 = poor, 3 = competent, 5 = exceptional; use the whole range) on:
hook (hook and logline), structure, character_dialogue, subtext, visual, emotional_truth, faithfulness (to the diary entry: no invented facts that CONTRADICT it; inventing connective material is allowed), originality, hebrew (Hebrew scripts only, else null), format, producer ("would a producer keep reading").
EVIDENCE RULE: every score must be backed by a SHORT VERBATIM quote (max 8 words, copied exactly, in the script's own language) from that script. Name the weakest part of each script with a verbatim quote.
Then choose the overall winner ("A", "B" or "tie") as the script a producer would rather keep reading.
Be terse: no text outside the JSON. Reply with ONE JSON object and nothing else, in this shape:
{"A":{"scores":{"hook":n,"structure":n,"character_dialogue":n,"subtext":n,"visual":n,"emotional_truth":n,"faithfulness":n,"originality":n,"hebrew":n_or_null,"format":n,"producer":n},"evidence":{"hook":"quote","structure":"quote","character_dialogue":"quote","subtext":"quote","visual":"quote","emotional_truth":"quote","faithfulness":"quote","originality":"quote","hebrew":"quote_or_null","format":"quote","producer":"quote"},"weakest":{"quote":"quote","why":"max 20 words"}},"B":{...same...},"winner":"A|B|tie","reason":"one or two sentences"}`;

// ── load generated outputs (run 1 only is paired) ──
const gen = {};
for (const f of fs.readdirSync(path.join(OUT, 'gen'))) {
  if (f.startsWith('PROBE')) continue;
  const r = readJson(path.join(OUT, 'gen', f));
  if (r.ok && !r.rejectedByProd && r.text && !EXCLUDED.has(r.model) && (!LANG || r.lang === LANG) && (!ONLY_MODELS || ONLY_MODELS.includes(r.model))) (gen[r.entry] ||= {})[`${r.model}#${r.run}`] = r;
}
const stripImage = (t) => { const i = t.toLowerCase().indexOf('[image:'); return (i === -1 ? t : t.slice(0, i)).trim(); };

// seeded RNG so pairings are reproducible
let seed = 20261009; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);

// one output per (entry, model): run 1, else run 2 → a pair only exists where BOTH models have a valid output
const outsFor = (id) => { const m = {}; for (const r of Object.values(gen[id] || {})) if (!m[r.model] || r.run < m[r.model].run) m[r.model] = r; return Object.values(m); };
const ENTRY_POOL = ENTRIES.filter((e) => !LANG || e.lang === LANG);
const pairs = [];
for (const e of SMOKE ? ENTRY_POOL.slice(0, 1) : ENTRY_POOL) {
  const outs = outsFor(e.id);
  if (ONLY_MODELS) { for (let i = 0; i < outs.length; i++) for (let j = i + 1; j < outs.length; j++) pairs.push({ e, a: outs[i], b: outs[j], kind: 'finalist' }); continue; }
  const base = outs.find((r) => r.model === BASELINE);
  if (!base) continue;
  for (const o of outs) if (o.model !== BASELINE) pairs.push({ e, a: base, b: o, kind: 'baseline' });
}
if (!SMOKE && !ONLY_MODELS) for (const e of ENTRY_POOL) {
  const outs = outsFor(e.id).filter((r) => r.model !== BASELINE);
  const seen = new Set();
  for (let k = 0, tries = 0; k < RANDOM_PER_ENTRY && outs.length > 1 && tries < 30; tries++) {
    const x = outs[Math.floor(rnd() * outs.length)], y = outs[Math.floor(rnd() * outs.length)];
    const id = [x.model, y.model].sort().join('|');
    if (x.model === y.model || seen.has(id)) continue;
    seen.add(id); pairs.push({ e, a: x, b: y, kind: 'random' }); k++;
  }
}
const jobs = [];
const JUDGE_LIST = JUDGE_OVERRIDE ? [{ id: JUDGE_OVERRIDE, in: Number(arg('judge-in', 0)), out: Number(arg('judge-out', 0)) }] : JUDGES;
for (const p of pairs) for (const j of JUDGE_LIST) {
  const swap = rnd() < 0.5;   // position randomization, independent per judge
  jobs.push({ ...p, judge: j, first: swap ? p.b : p.a, second: swap ? p.a : p.b });
}
console.log(`pairs=${pairs.length} judge-calls=${jobs.length}`);

const fileFor = (j) => path.join(OUT, 'judge', `${SMOKE ? 'SMOKE_' : ''}${slug(j.judge.id)}__${j.e.id}__${slug(j.first.model)}__${slug(j.second.model)}.json`);
// pair identity independent of order, so a resume does not re-judge a swapped duplicate
const existingKeys = new Set(fs.readdirSync(path.join(OUT, 'judge')).map((f) => { const r = readJson(path.join(OUT, 'judge', f)); if (!r.parsed) return ''; return `${r.judge}|${r.entry}|${[r.modelA, r.modelB].sort().join('|')}`; }));

function parse(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < 0) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

const MAX_SPEND = Number(arg('max-spend', 1e9)); const startNotional = ledger.notional;
let done = 0, stopped = false;
async function run(job) {
  const key = `${job.judge.id}|${job.e.id}|${[job.first.model, job.second.model].sort().join('|')}`;
  if (existingKeys.has(key)) return;
  if (capLeft(BUDGET_USD) < 0.03 || ledger.notional - startNotional > MAX_SPEND - 0.05) { stopped = true; return; }
  const user = `ORIGINAL DIARY ENTRY (${job.e.lang === 'he' ? 'Hebrew' : 'English'}; requested genre: ${job.e.genre}):\n"""\n${job.e.text}\n"""\n\n===== SCRIPT A =====\n${stripImage(job.first.text)}\n\n===== SCRIPT B =====\n${stripImage(job.second.text)}\n\nReturn the JSON object now.`;
  let rec;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await callJudge(job.judge, SYSTEM, user, 7000);
      const cost = r.orCost ?? ((r.usage.in * job.judge.in + r.usage.out * job.judge.out) / 1e6);
      charge(job.judge.id, cost, cost);
      const j = parse(r.text);
      if (!j && attempt === 1) continue;
      rec = { judge: job.judge.id, entry: job.e.id, lang: job.e.lang, kind: job.kind, modelA: job.first.model, modelB: job.second.model, runA: job.first.run, runB: job.second.run, parsed: !!j, result: j, raw: j ? undefined : r.text.slice(0, 1500), usage: r.usage, cost };
      break;
    } catch (err) {
      if ((err.status === 429 || err.status >= 500) && attempt === 1) { await sleep(5000); continue; }
      rec = { judge: job.judge.id, entry: job.e.id, lang: job.e.lang, kind: job.kind, modelA: job.first.model, modelB: job.second.model, parsed: false, error: String(err.message).slice(0, 200) };
      break;
    }
  }
  writeJson(fileFor(job), rec); existingKeys.add(key); done++;
  console.log(`[${done}/${jobs.length}] ${job.judge.id} ${job.e.id} ${job.first.model} vs ${job.second.model} parsed=${rec.parsed} $${(rec.cost || 0).toFixed(4)} ledger=$${ledger.notional.toFixed(3)}`);
}
let idx = 0;
await Promise.all(Array.from({ length: CONC }, async () => { while (!stopped) { const j = jobs[idx++]; if (!j) return; await run(j); } }));
console.log(`DONE judge calls=${done} stopped-by-cap=${stopped} ledger notional $${ledger.notional.toFixed(3)} real $${ledger.real.toFixed(3)}`);
