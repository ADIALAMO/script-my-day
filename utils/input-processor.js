/**
 * LifeScript Studio - Input Processor & Security Engine (Advanced Version)
 */

const InputProcessor = {
  /**
   * מנקה קלט תוך שמירה על מבנה טקסטואלי חיוני
   */
  sanitize: (str, maxLength = 2000) => {
    if (!str || typeof str !== 'string') return '';

    return str
      .trim()
      .replace(/<[^>]*>?/gm, '') // הסרת HTML
      .replace(/[<>]/g, '')      // הגנה נוספת מפני הזרקות קוד
      .replace(/\s\s+/g, ' ')    // ניקוי רווחים כפולים
      .slice(0, maxLength);
  },

  /**
   * זיהוי שפה חכם - בודק דומיננטיות של תווים
   */
  isHebrew: (str) => {
    if (!str) return true; // ברירת מחדל לעברית
    const hebrewChars = (str.match(/[\u0590-\u05FF]/g) || []).length;
    const englishChars = (str.match(/[a-zA-Z]/g) || []).length;
    return hebrewChars >= englishChars;
  },

  /**
   * Sentiment & Genre Engine 2.0
   * שיפור: הוספת משקלים ומילות מפתח רחבות יותר
   */
  detectSuggestedGenre: (str) => {
    if (!str) return 'drama';
    const text = str.toLowerCase();
    
    const markers = {
      sciFi: ['חלל', 'עתיד', 'רובוט', 'טכנולוגיה', 'כוכב', 'space', 'robot', 'future', 'alien', 'ספינה'],
      horror: ['פחד', 'אימה', 'מפחיד', 'דם', 'מוות', 'חושך', 'ghost', 'dark', 'monster', 'מתח'],
      comedy: ['מצחיק', 'חחח', 'בדיחה', 'צחוק', 'funny', 'joke', 'laugh', 'הומור'],
      romance: ['אהבה', 'לב', 'זוגיות', 'נשיקה', 'love', 'heart', 'romance', 'דייט', 'חתונה'],
      action: ['מרדף', 'יריות', 'מלחמה', 'מהיר', 'fast', 'action', 'fight', 'משטרה', 'פיצוץ'],
      drama: ['עצב', 'בכי', 'משפחה', 'זכרון', 'כאב', 'sad', 'family', 'memory', 'pain', 'חיים']
    };

    // חישוב ניקוד לכל ז'אנר (כדי למצוא את הדומיננטי ביותר)
    let scores = { sciFi: 0, horror: 0, comedy: 0, romance: 0, action: 0, drama: 0 };
    
    for (const [genre, keywords] of Object.entries(markers)) {
      keywords.forEach(keyword => {
        if (text.includes(keyword)) scores[genre]++;
      });
    }

    // מציאת הז'אנר עם הניקוד הגבוה ביותר
    const topGenre = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
    
    return scores[topGenre] > 0 ? topGenre : 'drama'; // אם אין זיהוי, ברירת מחדל לדרמה
  },

  /**
   * הכנה מאובטחת לסוכן ה-AI
   */
  prepareForAI: (journalEntry) => {
    const cleanEntry = InputProcessor.sanitize(journalEntry);
    return `### USER_JOURNAL_DATA_START ###\n${cleanEntry}\n### USER_JOURNAL_DATA_END ###`;
  }
};

export const { sanitize, prepareForAI, isHebrew, detectSuggestedGenre } = InputProcessor;
export default InputProcessor;