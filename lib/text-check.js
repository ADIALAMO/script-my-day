/**
 * Output check for GENERATED TEXT (scripts and storyboards) — the text counterpart of lib/image-check.js.
 *   1. the keyword blocklist (lib/content-blocklist.js) on the whole output, every genre, free and local;
 *   2. the paid Gemini Flash-Lite JSON classifier (through OpenRouter, data_collection "deny") on EVERY genre, under its own budget
 *      (DAILY_TEXT_CHECK_BUDGET) and its own circuit (`check_text`).
 * What happens when the classifier cannot answer (down, circuit open, daily cap spent, no time) depends on the genre:
 *   ROMANCE / HORROR   fail-CLOSED → verdict 'unavailable' (the route returns CONTENT_CHECK_UNAVAILABLE and releases the quota);
 *   every other genre  fail-OPEN on the classifier only → the text is returned on the blocklist result alone ('safe', degraded: true) and a counter
 *                      is bumped (`stats:textcheck:degraded:<day>`, never any text or key) so the degradation is visible.
 * Result: { verdict: 'safe' | 'blocked' | 'unsafe' | 'unavailable', stage, degraded? }.
 *   blocked      the blocklist matched (the route regenerates once, then refuses)
 *   unsafe       the classifier said so (same handling as `blocked`)
 *   unavailable  the classifier was required (romance / horror) and could not answer → CONTENT_CHECK_UNAVAILABLE, quota released
 *                (`credit: true` when the OpenRouter credit ran out: the route answers SERVICE_UNAVAILABLE instead)
 */
import redis from './redis.js';
import { checkContent } from './content-blocklist.js';
import { needsTextClassifier } from './content-safety.js';
import { runFallbackJson, parseFallbackVerdict } from './image-check.js';
import { nextMidnightUTC } from './api-utils.js';

export const TEXT_PROMPT =
  'Content-safety review of a screenplay or comic script for a general-audience app. Answer "unsafe" if the text contains explicit sexual ' +
  'content or a sexual description of bodies, nudity described sexually, ANY sexual content involving a minor, or graphic gore, torture or ' +
  'mutilation described in detail. Romance expressed through feelings, dialogue, kisses or a closed door is "safe"; horror built on fear, ' +
  'atmosphere and implied violence is "safe". Otherwise answer "safe".';

export const VERDICT_SCHEMA = { type: 'object', properties: { verdict: { type: 'string', enum: ['safe', 'unsafe'] } }, required: ['verdict'], additionalProperties: false };

/** Longest text sent to the classifier (a 5–8 scene script is ~2,500 tokens; this is a ceiling, not a target). */
const MAX_CLASSIFIER_CHARS = 24000;

/** the exact message content sent to the classifier (exported so the real-route probe sends byte-for-byte what production sends) */
export const classifierContent = (text) => [{ type: 'text', text: `${TEXT_PROMPT}\n\n=== TEXT START ===\n${String(text).slice(0, MAX_CLASSIFIER_CHARS)}\n=== TEXT END ===` }];

/**
 * @param {string} text   the generated output (script, or the storyboard's scene/visual/dialogue text joined)
 * @param {{ genre?: string, budgetMs?: number }} [opts]
 */
export async function checkTextOutput(text, { genre, budgetMs = 8000 } = {}) {
  const t = typeof text === 'string' ? text : '';
  if (!t.trim()) return { verdict: 'unsafe', stage: 'empty' };
  const hit = checkContent(t);
  if (hit.blocked) return { verdict: 'blocked', stage: `blocklist:${hit.category}` };

  // The classifier runs for every genre. Only romance / horror MUST have its answer; elsewhere an unavailable classifier degrades to the blocklist.
  const mustClassify = needsTextClassifier(genre);
  const degrade = async (why, credit = false) => {
    if (mustClassify) return { verdict: 'unavailable', stage: why, ...(credit ? { credit: true } : {}) };
    await countDegraded(why);
    return { verdict: 'safe', stage: `blocklist (classifier ${why})`, degraded: true };
  };

  if (budgetMs < 2500) return degrade('no-time');
  const r = await runFallbackJson({
    content: classifierContent(t),
    schemaName: 'safety_verdict',
    schema: VERDICT_SCHEMA,
    timeoutMs: Math.min(8000, budgetMs),
    purpose: 'text',            // its OWN daily budget (DAILY_TEXT_CHECK_BUDGET)
    circuitKey: 'check_text',   // its OWN circuit: a failing text classifier never pauses the image output checks or the minor screen
  });
  if (r.kind !== 'ok') return degrade(`classifier:${r.why}`, r.credit === true);
  const v = parseFallbackVerdict(r.data);
  if (v === 'safe') return { verdict: 'safe', stage: 'classifier' };
  // 'unsafe' AND an unreadable reply both hold the text back (the model is the only judge asked, and unknown is never "safe")
  return { verdict: 'unsafe', stage: v === 'unsafe' ? 'classifier:unsafe' : 'classifier:unreadable' };
}

/** counts a degraded (blocklist-only) result for non-risk genres: a number per UTC day and the reason class, never any text or key */
async function countDegraded(why) {
  console.warn(`⚠️ text check degraded to blocklist-only (${String(why).split(':')[0]} / ${String(why).split(':')[1] ?? ''})`);
  try {
    const day = new Date().toISOString().split('T')[0];
    const key = `stats:textcheck:degraded:${day}`;
    const pipe = redis.pipeline();
    pipe.incr(key); pipe.expireat(key, nextMidnightUTC() + 30 * 86400);
    await pipe.exec();
  } catch { /* visibility only */ }
}

/** Joins the human-readable text of a storyboard (scene, visual, dialogue) for the checks. */
export function storyboardText(panels) {
  return (Array.isArray(panels) ? panels : []).map((p) => [p?.scene, p?.visual, p?.dialogue].filter((x) => typeof x === 'string').join('\n')).join('\n\n');
}
