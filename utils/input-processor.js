import { HEBREW_RANGE } from '../constants/language.js';

/**
 * LifeScript Studio - Input Processor & Security Engine
 */

const InputProcessor = {
  sanitize: (str, maxLength = 2000) => {
    if (!str || typeof str !== 'string') return '';

    return str
      .trim()
      .replace(/<[^>]*>?/gm, '') // הסרת HTML
      .replace(/[<>]/g, '')      // הגנה נוספת מפני הזרקות קוד
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
