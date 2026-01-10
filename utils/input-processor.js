/**
 * LifeScript Studio - Input Processor & Security Engine
 * מיועד לניקוי קלט משתמש, אבטחת פרומפטים ופורמטינג אחיד
 */

const InputProcessor = {
  /**
   * מנקה ומכין מחרוזת לשימוש במערכת
   * @param {string} str - מחרוזת הקלט
   * @param {number} maxLength - אורך מקסימלי (ברירת מחדל 2000 תווים)
   */
  sanitize: (str, maxLength = 2000) => {
    if (!str || typeof str !== 'string') return '';

    return str
      .toString()
      .trim()
      // הסרת תגיות HTML למניעת הזרקות ל-Frontend
      .replace(/<[^>]*>?/gm, '')
      // ניקוי רווחים כפולים וירידות שורה מוגזמות
      .replace(/\s\s+/g, ' ')
      // חיתוך לפי האורך המוגדר
      .slice(0, maxLength);
  },

  /**
   * מגן על הפרומפט מפני הזרקות (Prompt Injection)
   * עוטף את הטקסט בתווים מיוחדים ומחזיר פורמט בטוח לסוכן
   */
  prepareForAI: (journalEntry) => {
    const cleanEntry = InputProcessor.sanitize(journalEntry);
    
    // טכניקה הוליוודית: אנחנו מבודדים את קלט המשתמש בתוך "בלוק נתונים"
    // זה עוזר ל-LLM להבין שזה המידע ולא הפקודה
    return `### USER_JOURNAL_DATA_START ###
${cleanEntry}
### USER_JOURNAL_DATA_END ###`;
  }
};

export const sanitize = InputProcessor.sanitize;
export const prepareForAI = InputProcessor.prepareForAI;
export default InputProcessor;