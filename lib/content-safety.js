/**
 * Content-safety helpers shared by the script, storyboard and image routes (Google Play "Sexual Content" /
 * "AI-Generated Content" policy). Three small pieces:
 *   1. CONTENT_SAFETY_RULE        — one positive-prose rule appended to the script and storyboard instructions
 *   2. GEMINI_SAFETY_SETTINGS     — explicit `safetySettings` for every Gemini text call
 *   3. isContentRefusal()         — tells a provider's CONTENT REFUSAL apart from a plain technical failure, so the
 *                                   cascades stop instead of re-sending the same prompt to the next (less filtered) provider
 * The keyword blocklist lives in lib/content-blocklist.js.
 */

/**
 * Positive prose on purpose (see the flux-prompt skill): it says what to show, not a list of things to avoid, so the
 * image model is never handed the very nouns we want absent from the picture.
 */
export const CONTENT_SAFETY_RULE =
  'CONTENT SAFETY (applies to every line you write, including every visual description and the final [image: …] line): ' +
  'this is a general-audience product. Show every character fully clothed in modest, everyday or period-appropriate attire. ' +
  'Keep every scene non-sexual: express romance and intimacy through conversation, glances, gestures and warm lighting. ' +
  'Show only adult characters in the visuals; when the story involves a child, keep the child out of the frame and show the setting, ' +
  'an object or an adult\'s reaction instead. If the source material contains explicit or sexual content, rewrite that beat as a ' +
  'tasteful, non-sexual version of the same emotion.';

/**
 * Gemini safety thresholds for the text calls. Sexual content is held to the standard "medium and above" level; the other
 * categories stay at "high only" so horror/action/drama scripts (which are legitimate genres here) are not over-blocked.
 */
export const GEMINI_SAFETY_SETTINGS = [
  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
];

const GEMINI_BLOCK_REASONS = new Set(['SAFETY', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'IMAGE_PROHIBITED_CONTENT']);

/** A provider answered, but declined the content. Never retried on another provider. */
export class ContentRefusalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ContentRefusalError';
    this.contentRefusal = true;
  }
}

/**
 * Inspects a Gemini generateContent response body. Returns the block reason (e.g. 'SAFETY') when Gemini declined
 * the prompt or the candidate on safety grounds, otherwise null.
 */
export function geminiBlockReason(data) {
  const prompt = data?.promptFeedback?.blockReason;
  if (prompt && prompt !== 'BLOCK_REASON_UNSPECIFIED') return prompt;
  const finish = data?.candidates?.[0]?.finishReason;
  return finish && GEMINI_BLOCK_REASONS.has(finish) ? finish : null;
}

/**
 * Inspects an OpenRouter chat-completions image response that carried NO image. A model that declines returns a
 * `content_filter` / safety finish reason, a `refusal` field, or Gemini's native IMAGE_SAFETY-style reasons.
 */
export function openRouterRefusal(data) {
  const choice = data?.choices?.[0];
  if (!choice) return false;
  const reasons = [choice.finish_reason, choice.native_finish_reason].filter((r) => typeof r === 'string').map((r) => r.toUpperCase());
  if (reasons.some((r) => r === 'CONTENT_FILTER' || GEMINI_BLOCK_REASONS.has(r))) return true;
  return typeof choice.message?.refusal === 'string' && choice.message.refusal.length > 0;
}

// Wording a provider uses when an HTTP error is a policy decision. Deliberately NOT generic words such as "blocked",
// "not allowed" or "violation": Cloudflare's schema error (code 5006) says "properties … not allowed" and must stay
// a technical failure.
const REFUSAL_WORDING = /\b8007\b|nsfw|content[\s_-]?(?:policy|filter(?:ed)?|moderation|safety)|moderation|safety|prohibited|flagged|unsafe|inappropriate|sexual|explicit/i;

/**
 * True when a thrown provider error is a content refusal (safety filter / moderation), false for anything technical:
 * timeouts, network errors, 429, 5xx, schema errors, missing keys.
 * Provider errors are thrown as "<Name> <httpStatus>: <body slice>" (see CLAUDE.md), so the status is parsed from the text.
 */
export function isContentRefusal(err) {
  if (!err) return false;
  if (err.contentRefusal === true) return true;
  const message = String(err.message || '');
  const m = message.match(/\b([45]\d{2})\b/);
  const status = m ? parseInt(m[1], 10) : null;
  if (status === 429 || status === 408 || (status !== null && status >= 500)) return false;
  return REFUSAL_WORDING.test(message);
}
