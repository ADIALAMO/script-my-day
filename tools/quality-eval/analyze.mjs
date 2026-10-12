// Aggregates generation + judge records into outputs/summary-<lang>.json (+ prints tables). No API calls.
//   node tools/quality-eval/analyze.mjs --lang=he
import fs from 'node:fs';
import path from 'node:path';
import { MODELS } from './models.mjs';
import { ENTRIES } from './entries.mjs';
import { OUT, ROOT, readJson, writeJson, analyzeFormat } from './lib.mjs';

const LANG = (process.argv.find((a) => a.startsWith('--lang=')) || '--lang=he').split('=')[1];
// Verdicts below are results of the October 2026 benchmark run (outputs are kept locally); they are not recomputed here.
const EXCLUDED = { 'google/gemma-4-31b-it:free': 'incomplete — rate-limited (429) on OpenRouter free pool; excluded from ranking',
  'command-r-plus-08-2024': 'too slow — 6 of 8 calls exceeded the 60 s benchmark ceiling, far above any production stage timeout; excluded from ranking' };
const DEAD = ['meta-llama/llama-3.3-70b-instruct:free', 'qwen/qwen3-next-80b-a3b-instruct:free'];

// ── the app's REAL parser, extracted from components/ScriptOutput.jsx at runtime ──
const src = fs.readFileSync(path.join(ROOT, 'components/ScriptOutput.jsx'), 'utf8');
const effStart = src.indexOf("const processed = script.replace");
const effEnd = src.indexOf('resetPoster();', effStart);
const parseBody = src.slice(effStart, effEnd);
const parseScript = new Function('script', 'setCleanScript', 'setVisualPrompt', parseBody);
const titleSrc = src.match(/const getCinematicTitle = \(text\) => \{[\s\S]*?\n\};/)[0];
const getCinematicTitle = new Function(`${titleSrc}; return getCinematicTitle;`)();
function renders(text) {
  let clean = '', visual = '';
  parseScript(text, (v) => (clean = v), (v) => (visual = v));
  const title = getCinematicTitle(clean);
  const imageFound = visual !== 'Cinematic masterpiece, dramatic lighting';
  const leak = /USER_JOURNAL|UNTRUSTED_DATA|\[image/i.test(clean);
  const titleWords = title.split(/\s+/).filter(Boolean).length;
  return { ok: imageFound && !leak && clean.length >= 500 && titleWords >= 1 && titleWords <= 6, imageFound, leak, title, titleWords };
}

// ── stats helpers ──
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
const pct = (a, p) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); const i = (s.length - 1) * p; const lo = Math.floor(i); return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo); };
const pearson = (x, y) => { const mx = mean(x), my = mean(y); let n = 0, dx = 0, dy = 0; for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2; } return n / Math.sqrt(dx * dy); };
const rank = (a) => { const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]); const r = Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
const spearman = (x, y) => pearson(rank(x), rank(y));
function kappa(pairs) { // pairs of [labelJ1, labelJ2]
  const cats = [...new Set(pairs.flat())]; const n = pairs.length; if (!n) return NaN;
  const po = pairs.filter(([a, b]) => a === b).length / n;
  const pe = cats.reduce((s, c) => s + (pairs.filter((p) => p[0] === c).length / n) * (pairs.filter((p) => p[1] === c).length / n), 0);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}
let seed = 7; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const bootCI = (vals) => { if (vals.length < 3) return [NaN, NaN]; const bs = []; for (let b = 0; b < 2000; b++) bs.push(mean(vals.map(() => vals[Math.floor(rnd() * vals.length)]))); return [pct(bs, 0.025), pct(bs, 0.975)]; };

// ── load generation ──
const gen = fs.readdirSync(path.join(OUT, 'gen')).filter((f) => !f.startsWith('PROBE')).map((f) => readJson(path.join(OUT, 'gen', f))).filter((r) => r.lang === LANG);
const probes = fs.readdirSync(path.join(OUT, 'gen')).filter((f) => f.startsWith('PROBE')).map((f) => readJson(path.join(OUT, 'gen', f)));
const entriesOf = (m) => { const sub = [...ENTRIES.filter((e) => e.lang === 'he').slice(0, m.entries / 2), ...ENTRIES.filter((e) => e.lang === 'en').slice(0, m.entries / 2)]; return sub.filter((e) => e.lang === LANG); };

const summary = { lang: LANG, models: {}, pairs: [], judges: {}, probes, dead: DEAD, excluded: EXCLUDED };
const wordsOf = {}; // `${entry}|${model}` → words of the output used in judging (run1 else run2)
const textOf = {};
for (const m of MODELS) {
  const exp = entriesOf(m).length * 2;
  const recs = gen.filter((r) => r.model === m.id);
  const valid = recs.filter((r) => r.ok && !r.rejectedByProd);
  const fails = recs.filter((r) => !r.ok);
  const f = valid.map((r) => ({ r, fmt: analyzeFormat(r.text, LANG), rend: renders(r.text) }));
  for (const x of f) { const k = `${x.r.entry}|${m.id}`; if (!wordsOf[k] || x.r.run < wordsOf[k].run) { wordsOf[k] = { run: x.r.run, w: x.fmt.words }; } }
  const lat = valid.map((r) => r.latencyMs);
  // consistency over entries where both runs are valid
  const byE = {}; for (const x of f) (byE[x.r.entry] ||= []).push(x);
  const both = Object.values(byE).filter((a) => a.length === 2);
  const cons = {
    n: both.length,
    wordsRelDiff: mean(both.map(([a, b]) => Math.abs(a.fmt.words - b.fmt.words) / ((a.fmt.words + b.fmt.words) / 2))),
    sameSceneCount: mean(both.map(([a, b]) => (a.fmt.scenes === b.fmt.scenes ? 1 : 0))),
    sameFormatVerdict: mean(both.map(([a, b]) => (a.fmt.formatOk === b.fmt.formatOk ? 1 : 0))),
  };
  summary.models[m.id] = {
    label: m.label, provider: m.provider, stage: m.stage, free: !!m.free, excluded: EXCLUDED[m.id] || null,
    expected: exp, attempted: recs.length, valid: valid.length,
    fail429: fails.filter((r) => Number(r.status) === 429).length, failTimeout: fails.filter((r) => r.status === 'timeout').length,
    failOther: fails.filter((r) => Number(r.status) !== 429 && r.status !== 'timeout').length,
    rejectedByProd: recs.filter((r) => r.ok && r.rejectedByProd).length,
    formatOkPct: mean(f.map((x) => (x.fmt.formatOk ? 1 : 0))) * 100,
    renderOkPct: mean(f.map((x) => (x.rend.ok ? 1 : 0))) * 100,
    sceneCountOkPct: mean(f.map((x) => (x.fmt.sceneCountOk ? 1 : 0))) * 100,
    boldHeadingsPct: mean(f.map((x) => (x.fmt.boldHeadings ? 1 : 0))) * 100,
    strayLatinPct: LANG === 'he' ? mean(f.map((x) => (x.fmt.latinWords > 0 ? 1 : 0))) * 100 : NaN,
    avgWords: mean(f.map((x) => x.fmt.words)),
    latencyP50: pct(lat, 0.5), latencyP90: pct(lat, 0.9), latencyP95: pct(lat, 0.95), latencyMax: Math.max(...lat, 0),
    withinProdTimeoutPct: mean(valid.map((r) => (r.withinProdTimeout ? 1 : 0))) * 100, prodTimeoutMs: m.prodTimeoutMs,
    costRealPerScript: mean(valid.map((r) => r.costReal)), costNotionalPerScript: mean(valid.map((r) => r.costNotional)),
    avgThinkTokens: mean(valid.map((r) => r.usage.think || 0)), avgOutTokens: mean(valid.map((r) => r.usage.out)),
    consistency: cons,
  };
}

// ── judges ──
const J = fs.readdirSync(path.join(OUT, 'judge')).map((f) => readJson(path.join(OUT, 'judge', f))).filter((r) => r.lang === LANG);
const CRIT = ['hook', 'structure', 'character_dialogue', 'subtext', 'visual', 'emotional_truth', 'faithfulness', 'originality', 'hebrew', 'format', 'producer'];
const norm = (s) => String(s || '').replace(/[*_\s]+/g, ' ').replace(/[“”"״]/g, '"').trim();
const genText = {}; for (const r of gen) if (r.ok) genText[`${r.entry}|${r.model}|${r.run}`] = norm(r.text);
const instances = []; // one per (judge, pair, side)
const votes = [];     // one per (judge, pair)
for (const r of J) {
  if (!r.parsed || !r.result?.A || !r.result?.B) continue;
  const sides = { A: r.modelA, B: r.modelB }; const runs = { A: r.runA, B: r.runB };
  for (const s of ['A', 'B']) {
    const res = r.result[s]; const sc = res.scores || {}; const nums = CRIT.filter((c) => typeof sc[c] === 'number' && !(c === 'hebrew' && LANG !== 'he'));
    const text = genText[`${r.entry}|${sides[s]}|${runs[s]}`] || [1, 2].map((k) => genText[`${r.entry}|${sides[s]}|${k}`]).find(Boolean) || '';
    let ev = 0, evOk = 0; for (const c of nums) { const q = norm(res.evidence?.[c]); if (q && q !== 'null') { ev++; if (text.includes(q)) evOk++; } }
    const w = wordsOf[`${r.entry}|${sides[s]}`]?.w;
    instances.push({ judge: r.judge, entry: r.entry, model: sides[s], scores: sc, overall: mean(nums.map((c) => sc[c])), producer: sc.producer, words: w, ev, evOk, kind: r.kind });
  }
  const win = r.result.winner === 'A' ? r.modelA : r.result.winner === 'B' ? r.modelB : 'tie';
  votes.push({ judge: r.judge, entry: r.entry, m1: [r.modelA, r.modelB].sort()[0], m2: [r.modelA, r.modelB].sort()[1], win, kind: r.kind, posWin: r.result.winner, modelA: r.modelA, modelB: r.modelB });
}
const judgeIds = [...new Set(J.map((r) => r.judge))];
summary.judgeCalls = { total: J.length, parsed: J.filter((r) => r.parsed).length };
for (const jid of judgeIds) {
  const inst = instances.filter((i) => i.judge === jid);
  const lenX = inst.filter((i) => i.words), vs = votes.filter((v) => v.judge === jid);
  const decisive = vs.filter((v) => v.win !== 'tie');
  const longerWins = decisive.filter((v) => { const a = wordsOf[`${v.entry}|${v.modelA}`]?.w, b = wordsOf[`${v.entry}|${v.modelB}`]?.w; if (a == null || b == null || a === b) return false; return (v.win === v.modelA) === (a > b); }).length;
  const comparable = decisive.filter((v) => { const a = wordsOf[`${v.entry}|${v.modelA}`]?.w, b = wordsOf[`${v.entry}|${v.modelB}`]?.w; return a != null && b != null && a !== b; }).length;
  summary.judges[jid] = {
    instances: inst.length, votes: vs.length,
    meanOverall: mean(inst.map((i) => i.overall)), meanProducer: mean(inst.map((i) => i.producer)),
    pearsonLenOverall: pearson(lenX.map((i) => i.words), lenX.map((i) => i.overall)), spearmanLenOverall: spearman(lenX.map((i) => i.words), lenX.map((i) => i.overall)),
    pearsonLenProducer: pearson(lenX.map((i) => i.words), lenX.map((i) => i.producer)),
    longerScriptWinsPct: comparable ? (longerWins / comparable) * 100 : NaN, comparableVotes: comparable,
    positionAWinsPct: mean(vs.filter((v) => v.posWin !== 'tie').map((v) => (v.posWin === 'A' ? 1 : 0))) * 100,
    tiePct: mean(vs.map((v) => (v.win === 'tie' ? 1 : 0))) * 100,
    evidenceValidPct: inst.reduce((s, i) => s + i.evOk, 0) / Math.max(1, inst.reduce((s, i) => s + i.ev, 0)) * 100,
  };
}
// agreement between the first two judges (the primary pair) on identical (entry, model-pair)
const prim = judgeIds.filter((j) => /haiku|luna/.test(j));
if (prim.length === 2) {
  const idx = {}; for (const v of votes) (idx[`${v.entry}|${v.m1}|${v.m2}`] ||= {})[v.judge] = v.win;
  const both = Object.values(idx).filter((o) => o[prim[0]] && o[prim[1]]);
  const labs = both.map((o) => [o[prim[0]], o[prim[1]]]);
  // for kappa use identity-free labels: 'm1' / 'm2' / 'tie' would need canonical order; compute on model-name labels (same set per pair)
  const kmap = Object.entries(idx).filter(([, o]) => o[prim[0]] && o[prim[1]]).map(([k, o]) => { const [, m1] = k.split('|'); const f = (w) => (w === 'tie' ? 'tie' : w === m1 ? 'first' : 'second'); return [f(o[prim[0]]), f(o[prim[1]])]; });
  const scoreP = {}; for (const i of instances.filter((x) => prim.includes(x.judge))) (scoreP[`${i.entry}|${i.model}`] ||= {})[i.judge] = [];
  const perOut = {}; for (const i of instances.filter((x) => prim.includes(x.judge))) ((perOut[`${i.entry}|${i.model}`] ||= {})[i.judge] ||= []).push(i.overall);
  const pairsO = Object.values(perOut).filter((o) => o[prim[0]] && o[prim[1]]).map((o) => [mean(o[prim[0]]), mean(o[prim[1]])]);
  summary.agreement = { judges: prim, n: both.length, rawAgreementPct: mean(labs.map(([a, b]) => (a === b ? 1 : 0))) * 100, kappa: kappa(kmap),
    nonTieAgreementPct: mean(labs.filter(([a, b]) => a !== 'tie' && b !== 'tie').map(([a, b]) => (a === b ? 1 : 0))) * 100,
    scoreSpearman: spearman(pairsO.map((p) => p[0]), pairsO.map((p) => p[1])), scoreN: pairsO.length,
    flagLow: kappa(kmap) < 0.4 };
}
// per model: avg judge score per criterion / overall, and per-judge
for (const [id, m] of Object.entries(summary.models)) {
  const mi = instances.filter((i) => i.model === id && prim.includes(i.judge));
  m.judge = { n: mi.length, overall: mean(mi.map((i) => i.overall)), producer: mean(mi.map((i) => i.producer)),
    perJudge: Object.fromEntries(prim.map((j) => [j, mean(mi.filter((i) => i.judge === j).map((i) => i.overall))])),
    perCriterion: Object.fromEntries(CRIT.map((c) => [c, mean(mi.map((i) => i.scores[c]).filter((x) => typeof x === 'number'))])) };
  const vs = votes.filter((v) => prim.includes(v.judge) && (v.m1 === id || v.m2 === id));
  m.record = { votes: vs.length, wins: vs.filter((v) => v.win === id).length, ties: vs.filter((v) => v.win === 'tie').length, losses: vs.filter((v) => v.win !== id && v.win !== 'tie').length };
  m.winRate = m.record.votes ? (m.record.wins + 0.5 * m.record.ties) / m.record.votes : NaN;
}
// pairwise table with n
const pk = {}; for (const v of votes.filter((x) => prim.includes(x.judge))) { const k = `${v.m1}|${v.m2}`; const o = (pk[k] ||= { m1: v.m1, m2: v.m2, entries: new Set(), votes: 0, w1: 0, w2: 0, tie: 0 }); o.entries.add(v.entry); o.votes++; if (v.win === 'tie') o.tie++; else if (v.win === v.m1) o.w1++; else o.w2++; }
summary.pairs = Object.values(pk).map((o) => ({ ...o, entries: o.entries.size })).sort((a, b) => b.entries - a.entries);
// bootstrap CI of win rate vs baseline per model (resample entries)
for (const [id, m] of Object.entries(summary.models)) {
  if (id === 'gemini-2.5-flash') continue;
  const byE = {}; for (const v of votes.filter((x) => prim.includes(x.judge) && x.kind === 'baseline' && (x.m1 === id || x.m2 === id))) (byE[v.entry] ||= []).push(v.win === id ? 1 : v.win === 'tie' ? 0.5 : 0);
  const per = Object.values(byE).map(mean); m.vsBaseline = { entries: per.length, winRate: mean(per), ci95: bootCI(per) };
}
writeJson(path.join(OUT, `summary-${LANG}.json`), summary);
console.log(JSON.stringify({ judges: summary.judges, agreement: summary.agreement, judgeCalls: summary.judgeCalls }, null, 1));
for (const [id, m] of Object.entries(summary.models)) console.log(id.padEnd(32), `valid ${m.valid}/${m.expected} (429:${m.fail429} to:${m.failTimeout} other:${m.failOther} rej:${m.rejectedByProd})`, `fmt ${m.formatOkPct.toFixed(0)}% render ${m.renderOkPct.toFixed(0)}% p50 ${(m.latencyP50 / 1000).toFixed(1)}s p90 ${(m.latencyP90 / 1000).toFixed(1)}s inProdTO ${m.withinProdTimeoutPct.toFixed(0)}%`, `judge ${m.judge.overall?.toFixed(2)} (n${m.judge.n}) win ${(m.winRate * 100).toFixed(0)}% vsBase ${m.vsBaseline ? (m.vsBaseline.winRate * 100).toFixed(0) + '% n' + m.vsBaseline.entries : '-'}`);
