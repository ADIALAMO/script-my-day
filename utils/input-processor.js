import { HEBREW_RANGE } from '../constants/language.js';

/**
 * LifeScript Studio - Input Processor & Security Engine
 */

const TAG_RE = /<\/?[a-zA-Z!?][^>]*>/g;
const MAX_PASSES = 5;

const InputProcessor = {
  sanitize: (str, maxLength = 2000) => {
    if (!str || typeof str !== 'string') return '';

    // Strip real HTML tags only (<b>, </p>, <!-- -->, <?x?>). The old pattern
    // /<[^>]*>?/ made the closing ">" optional, so a lone "<" ("I <3 you")
    // deleted everything after it. A lone "<" or ">" is plain text and stays:
    // output is rendered by React (escaped), sent as Markdown, or fed to an LLM —
    // never inserted as HTML (the print view escapes separately).
    //
    // A single pass can be defeated by nesting ("<<script>script>" -> "<script>"),
    // so repeat until stable. Bounded: if input is still changing after
    // MAX_PASSES (pathological nesting), drop every "<" so no tag can survive.
    let out = str.trim();
    for (let i = 0; i < MAX_PASSES; i++) {
      const next = out.replace(TAG_RE, '');
      if (next === out) break;
      out = next;
    }
    if (TAG_RE.test(out)) out = out.replace(/</g, '');
    TAG_RE.lastIndex = 0;

    return out
      .replace(/\s\s+/g, ' ')   // ניקוי רווחים כפולים
      .slice(0, maxLength);
  },

  // Uses spread+filter with the shared HEBREW_RANGE constant (no /g flag needed).
  isHebrew: (str) => {
    if (!str) return true;
    const hebrewChars = [...str].filter(c => HEBREW_RANGE.test(c)).length;
    const englishChars = (str.match(/[a-zA-Z]/g) || []).length;
    return hebrewChars >= englishChars;
  },
};

export const { sanitize, isHebrew } = InputProcessor;
export default InputProcessor;
