// Parsing + schemas for the storyboard LLM output (pure, no I/O — unit-tested in tests/storyboard-parse.test.js).
//
// Models are asked for a JSON array of panels, but in practice they return: the bare array; the array inside ``` fences; an object wrapper
// {"panels":[...]} (what OpenRouter's json_schema mode needs, since a strict schema root must be an object); prose around the array; or an array
// CUT OFF mid-way by the token cap. The last case used to fail every strategy and cost a full model call; now the complete objects before the
// cut are kept (>= MIN_SALVAGE panels) so a truncation is an instant success.

export const MIN_SALVAGE = 4;
export const MAX_PANELS = 7;

const hasVisual = (p) => !!p && typeof p === 'object' && typeof p.visual === 'string' && p.visual.trim().length > 0;
const asPanels = (v) => (Array.isArray(v) && v.length ? v : null);

function fromParsed(p) {
  if (Array.isArray(p)) return asPanels(p);
  if (p && typeof p === 'object') {
    if (Array.isArray(p.panels)) return asPanels(p.panels);
    // some models name the field differently ({"frames":[...]}): accept any array of objects
    for (const v of Object.values(p)) {
      if (Array.isArray(v) && v.length && v.every((x) => x && typeof x === 'object')) return v;
    }
  }
  return null;
}

/** complete top-level objects of the array that starts at/after `from` (string- and escape-aware); an unterminated last object is dropped */
export function completeObjects(text, from = 0) {
  const out = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') { inStr = true; continue; }
    if (c === '{') { if (depth === 0) start = i; depth += 1; }
    else if (c === '}') {
      if (depth === 0) continue;
      depth -= 1;
      if (depth === 0 && start !== -1) {
        try { out.push(JSON.parse(text.slice(start, i + 1))); } catch { /* skip a malformed object, keep scanning */ }
        start = -1;
      }
    } else if (c === ']' && depth === 0 && out.length) break; // the array ended normally
  }
  return out;
}

/** -> { panels, how } | null.  how: 'direct' | 'fenced' | 'slice' | 'salvaged' */
export function parseStoryboard(rawText, { minSalvage = MIN_SALVAGE } = {}) {
  if (typeof rawText !== 'string') return null;
  const text = rawText.trim();
  if (!text) return null;
  try { const p = fromParsed(JSON.parse(text)); if (p) return { panels: p, how: 'direct' }; } catch { /* next strategy */ }
  const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
  try { const p = fromParsed(JSON.parse(stripped)); if (p) return { panels: p, how: 'fenced' }; } catch { /* next strategy */ }
  const first = text.indexOf('[');
  const last = text.lastIndexOf(']');
  if (first !== -1 && last > first) {
    try { const p = fromParsed(JSON.parse(text.slice(first, last + 1))); if (p) return { panels: p, how: 'slice' }; } catch { /* next strategy */ }
  }
  // truncated output: keep the complete objects of the panels array
  const m = /"panels"\s*:\s*\[/.exec(text);
  const arrayStart = m ? m.index + m[0].length : first;
  if (arrayStart !== -1) {
    const kept = completeObjects(text, arrayStart).filter(hasVisual);
    if (kept.length >= minSalvage) return { panels: kept.slice(0, MAX_PANELS), how: 'salvaged' };
  }
  return null;
}

/** backwards-compatible: the panels array or null */
export function extractPanels(rawText) {
  const r = parseStoryboard(rawText);
  if (!r) {
    console.warn('⚠️ extractPanels: all JSON parse strategies failed — model returned unparseable output');
    return null;
  }
  return r.panels;
}

// ── Structured-output schemas ───────────────────────────────────────────────

const PANEL_PROPS = {
  panel: 'INTEGER', scene: 'STRING', visual: 'STRING', dialogue: 'STRING', hero: 'BOOLEAN',
};

/** Gemini generationConfig.responseSchema (a bare array is allowed there) */
export const GEMINI_RESPONSE_SCHEMA = {
  type: 'ARRAY',
  minItems: 5,
  maxItems: MAX_PANELS,
  items: {
    type: 'OBJECT',
    properties: Object.fromEntries(Object.entries(PANEL_PROPS).map(([k, t]) => [k, { type: t }])),
    required: ['panel', 'scene', 'visual', 'dialogue', 'hero'],
  },
};

/** OpenRouter response_format: a strict json_schema needs an OBJECT root, hence the {panels:[...]} wrapper (parseStoryboard accepts it) */
export const OPENROUTER_RESPONSE_FORMAT = {
  type: 'json_schema',
  json_schema: {
    name: 'storyboard',
    strict: true,
    schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        panels: {
          type: 'array',
          minItems: 5,
          maxItems: MAX_PANELS,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              panel: { type: 'integer' }, scene: { type: 'string' }, visual: { type: 'string' }, dialogue: { type: 'string' }, hero: { type: 'boolean' },
            },
            required: ['panel', 'scene', 'visual', 'dialogue', 'hero'],
          },
        },
      },
      required: ['panels'],
    },
  },
};
