/**
 * Best-effort screen for a selfie that CLEARLY shows a young child ("Star Yourself" is 18+).
 *
 * This is NOT age verification and must never be described as such: a vision model cannot establish anyone's age or identity. It only
 * rejects when the model says the person clearly appears to be a child. "unsure", an unreadable reply, a refusal, a technical failure,
 * an open circuit or a spent daily budget all ALLOW the photo (the explicit 18+ confirmation and the consent remain the rule).
 * It is told not to identify anyone. One paid fallback call per upload (≈ $0.0001), under DAILY_CHECK_BUDGET.
 */
import { runFallbackJson } from './image-check.js';
import { openRouterRefusal } from './content-safety.js';

export const AGE_PROMPT =
  'Look at the person in this photo and answer ONLY with apparent_age: "minor" if the person clearly appears to be a child or young teenager, ' +
  '"adult" if the person clearly appears to be an adult, or "unsure" if you cannot tell or there is no clear single face. ' +
  'Do not identify the person and do not describe them.';

export const AGE_SCHEMA = { type: 'object', properties: { apparent_age: { type: 'string', enum: ['adult', 'minor', 'unsure'] } }, required: ['apparent_age'], additionalProperties: false };

/** the exact message content sent to the screen (exported so the real-route probe sends byte-for-byte what production sends) */
export const ageContent = (imageDataUri) => [{ type: 'image_url', image_url: { url: imageDataUri } }, { type: 'text', text: AGE_PROMPT }];

/** 'adult' | 'minor' | 'unsure' | 'unknown' — exact {"apparent_age": …} only; a refusal is "unsure", never "minor". */
export function parseAgeVerdict(data) {
  if (openRouterRefusal(data)) return 'unsure';
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') return 'unknown';
  let obj;
  try { obj = JSON.parse(text); } catch { return 'unknown'; }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || Object.keys(obj).length !== 1) return 'unknown';
  return ['adult', 'minor', 'unsure'].includes(obj.apparent_age) ? obj.apparent_age : 'unknown';
}

/**
 * @param {string} imageDataUri
 * @returns {Promise<{ reject: boolean, result: 'minor'|'adult'|'unsure'|'unknown'|'skipped' }>}
 */
export async function screenApparentMinor(imageDataUri) {
  if (typeof imageDataUri !== 'string' || !imageDataUri.startsWith('data:image/')) return { reject: false, result: 'skipped' };
  const r = await runFallbackJson({
    content: ageContent(imageDataUri),
    schemaName: 'apparent_age',
    schema: AGE_SCHEMA,
    timeoutMs: 8000,
    maxTokens: 64,
    purpose: 'minor',            // its OWN daily budget (DAILY_MINOR_CHECK_BUDGET): exhausting it never affects the image or text checks, and vice versa
    circuitKey: 'check_minor',   // its OWN circuit: a failing face-photo screen must never pause the image output checks (check_gemini)
  });
  if (r.kind !== 'ok') return { reject: false, result: 'skipped' };
  const v = parseAgeVerdict(r.data);
  return { reject: v === 'minor', result: v };
}
