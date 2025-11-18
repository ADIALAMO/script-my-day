/**
 * יוצר תסריט קומיקס/דרמה מקצועי לפי טקסט משתמש וז'אנר
 * @param {string} userText - הטקסט המקורי של המשתמש
 * @param {string} genre - הז'אנר הנבחר (דרמה, קומדיה, מדע בדיוני וכו')
 * @returns {{
 *   panels: Array<{
 *     number: number,
 *     title: string,
 *     scene: string,
 *     description: string,
 *     thoughts?: string,
 *     dialogue?: string[]
 *   }>
 * }}
 */
function createComicScriptPanels(userText, genre) {
  // פיצול הטקסט לאירועים עיקריים (פשוט: לפי פעלים/משפטים)
  const events = userText
    .split(/(?<=[.!?])\s+|(?<=,)\s+/)
    .map(e => e.trim())
    .filter(e => e.length > 0);

  // יצירת פאנלים
  const panels = events.map((event, idx) => {
    // דוגמה פשוטה: אפשר להעמיק עם ניתוח רגשות, דמויות, סביבה וכו'
    return {
      number: idx + 1,
      title: `Panel ${idx + 1}`,
      scene: `סצנה ${idx + 1} (${genre}):`,
      description: `תיאור ויזואלי: ${event}`,
      thoughts: genre === 'דרמה' ? 'הדמות חווה רגע אישי משמעותי.' : 'הדמות מגיבה לאירוע.',
      dialogue: []
    };
  });

  return { panels };
}

// דוגמה לשימוש:
// const userText = "קמתי בבוקר, עשיתי מדיטציה, עשיתי קפה וסיגריה, התחלתי להתאמן, אחרי זה יצאתי לעשות סיבוב בעיר, פגשתי מישהו שלא רציתי לראות, חייכתי והמשכתי ללכת, פגשתי חבר ותיק, ישבנו דיברנו שתינו בירה, המלצרית התחילה איתי, לקחתי את המספר שלה בלי יותר מדי שאלות, ישבנו עוד קצת והלכתי הביתה.";
// const genre = "דרמה";
// console.log(createComicScriptPanels(userText, genre));

module.exports = { createComicScriptPanels };
