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
    if (!str || str.trim().length < 2) return 'drama';
    const text = str.toLowerCase();
    
    // מפת משקולות והקשרים רחבה - עברית ואנגלית
    const markers = {
      romance: {
        words: ['אהבה', 'לב', 'זוגיות', 'נשיקה', 'דייט', 'חתונה', 'פרחים', 'מבט', 'מרגש', 'ביחד', 'געגוע', 'חיבוק', 'מקסים', 'יפה', 'נשמה', 'love', 'heart', 'romance', 'date', 'wedding', 'kiss', 'together', 'sweet', 'beautiful', 'crush', 'miss', 'hug', 'soul', 'flowers'],
        weight: 1.2 // עדיפות קלה לתמות רומנטיות ביומן
      },
      sciFi: {
        words: ['חלל', 'עתיד', 'רובוט', 'טכנולוגיה', 'כוכב', 'ספינה', 'לייזר', 'מכונה', 'זמן', 'גלקסיה', 'ניסוי', 'מדעי', 'מוזר', 'space', 'robot', 'future', 'alien', 'technology', 'star', 'ship', 'laser', 'machine', 'time', 'galaxy', 'science', 'planet', 'universe'],
        weight: 0.9
      },
      horror: {
        words: ['פחד', 'אימה', 'מפחיד', 'דם', 'מוות', 'חושך', 'סיוט', 'צללים', 'צעקה', 'לבד', 'רוח', 'קבר', 'מסתורי', 'מתח', 'fear', 'horror', 'scary', 'blood', 'death', 'dark', 'ghost', 'monster', 'nightmare', 'shadow', 'scream', 'alone', 'spirit', 'mystery', 'tense'],
        weight: 1.3
      },
      comedy: {
        words: ['מצחיק', 'חחח', 'בדיחה', 'צחוק', 'הומור', 'הזוי', 'פאדיחה', 'שטויות', 'חיוך', 'נהניתי', 'כיף', 'טירוף', 'funny', 'lol', 'joke', 'laugh', 'humor', 'crazy', 'silly', 'smile', 'enjoyed', 'fun', 'madness', 'ridiculous', 'hilarious'],
        weight: 0.85 // משקל נמוך יותר כדי שקומדיה תהיה "תבלין" ולא תשתלט בקלות
      },
      action: {
        words: ['מרדף', 'יריות', 'מלחמה', 'מהיר', 'קרב', 'משטרה', 'פיצוץ', 'נשק', 'ריצה', 'משימה', 'סכנה', 'חזק', 'אומץ', 'chase', 'shooting', 'war', 'fast', 'action', 'fight', 'police', 'explosion', 'weapon', 'running', 'mission', 'danger', 'strong', 'brave', 'power'],
        weight: 1.0
      },
      drama: {
        words: ['עצב', 'בכי', 'משפחה', 'זכרון', 'כאב', 'חיים', 'שינוי', 'קשה', 'אמת', 'לבד', 'פרידה', 'שיחה', 'בדידות', 'sad', 'crying', 'family', 'memory', 'pain', 'life', 'change', 'hard', 'truth', 'alone', 'breakup', 'talk', 'lonely', 'tears', 'deep'],
        weight: 1.1
      }
    };

    let scores = { sciFi: 0, horror: 0, comedy: 0, romance: 0, action: 0, drama: 0 };
    
    // חישוב ניקוד חכם הכולל ספירת מופעים מרובים ומשקולות
    Object.keys(markers).forEach(genre => {
      markers[genre].words.forEach(word => {
        // מחפש כמה פעמים המילה מופיעה בטקסט (Global search)
        const regex = new RegExp(`\\b${word}\\b|${word}`, 'gi');
        const matches = text.match(regex);
        if (matches) {
          // ניקוד = מספר מופעים * משקל הז'אנר
          scores[genre] += matches.length * markers[genre].weight;
        }
      });
    });

    // מציאת הז'אנר עם הניקוד הגבוה ביותר
    const topGenre = Object.keys(scores).reduce((a, b) => scores[a] > scores[b] ? a : b);
    
    // מחזירים את הז'אנר המוביל רק אם הציון שלו משמעותי, אחרת דרמה (כבסיס סיפורי)
    return scores[topGenre] >= 0.8 ? topGenre : 'drama';
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