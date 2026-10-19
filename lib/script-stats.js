/**
 * Which stage actually served each script, so the paid budget can be tuned from real numbers. One Redis hash per UTC day:
 *   stats:script:stage:<YYYY-MM-DD>  { <stage>: n, "paid:<what the paid engine did>": n, paid_in: tokens, paid_out: tokens }
 * stage = paid-gemini | gemini-quality | gemini-fast | gemma | cohere | deepseek | free-model | refused | failed
 * paid:<x> = served | skipped:budget | skipped:circuit | skipped:time | skipped:unverifiable | failed:<http> | failed:timeout | failed:network | refused | empty | off
 * Counts and token totals only — never a script, a journal text, a key or an identifier. Kept 60 days. Best-effort: never throws, never blocks a request.
 */
import redis from './redis.js';

export const STAGE_KEY_PREFIX = 'stats:script:stage:';
const KEEP_SECONDS = 60 * 86400;
const dayStamp = (d = new Date()) => d.toISOString().split('T')[0];

export function stageOf(result) {
  if (result?.success) return String(result.stage || 'unknown');
  return result?.refused ? 'refused' : 'failed';
}

export async function recordScriptStage(result, client = redis) {
  try {
    const key = `${STAGE_KEY_PREFIX}${dayStamp()}`;
    const pipe = client.pipeline();
    pipe.hincrby(key, stageOf(result), 1);
    const paid = result?.trace?.paid;
    if (paid) pipe.hincrby(key, `paid:${paid}`, 1);
    const t = result?.trace?.tokens;
    if (t) { pipe.hincrby(key, 'paid_in', t.in || 0); pipe.hincrby(key, 'paid_out', t.out || 0); }
    pipe.expire(key, KEEP_SECONDS);
    await pipe.exec();
  } catch (e) {
    console.warn(`⚠️ Script stage stats skipped (Redis): ${e.message}`);
  }
}

/** last `days` UTC days, newest first: [{ day, counts: {field: n} }] (days with no data are left out) */
export async function readScriptStages(days = 14, client = redis, now = new Date()) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const day = dayStamp(new Date(now.getTime() - i * 86400000));
    try {
      const h = await client.hgetall(`${STAGE_KEY_PREFIX}${day}`);
      if (h && Object.keys(h).length) out.push({ day, counts: Object.fromEntries(Object.entries(h).map(([k, v]) => [k, Number(v) || 0])) });
    } catch { /* skip the day */ }
  }
  return out;
}
