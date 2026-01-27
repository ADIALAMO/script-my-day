import { generateScript } from '../../lib/story-service.js';
import Redis from 'ioredis';
// ייבוא המעבד החדש שיצרנו
import { sanitize, prepareForAI } from '../../utils/input-processor';

// --- הגדרה קריטית להרצה על Vercel: מאפשר זמן המתנה ל-AI ---
export const config = {
  maxDuration: 60, 
};
// חיבור ל-Redis - שמירה על הגדרות החיבור המקוריות למניעת קריסות
const kv = new Redis(process.env.REDIS_URL, {
  connectTimeout: 5000,
  maxRetriesPerRequest: 1,
});

const DAILY_LIMIT = 4;

export default async function handler(req, res) {
  // 1. אבטחת מתודה
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    // שליפת נתונים גולמיים מהבקשה
    const { journalEntry, genre, adminKeyBody, deviceId: bodyDeviceId } = req.body;
    
    // 2. אימות אדמין - שמרתי על הלוגיקה המקורית (Header + Body) כפי שביקשת, 
    // אבל הוספתי את ה-sanitize כדי למנוע תווים מוזרים במפתח
    const clientAdminKey = sanitize(req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || adminKeyBody || '');
    const serverAdminSecret = sanitize(process.env.ADMIN_SECRET || '');
    const isAdmin = serverAdminSecret !== '' && clientAdminKey === serverAdminSecret;

    // 3. מנגנון Blocking פונקציונלי (Redis) - נשאר ללא שינוי פונקציונלי
    if (!isAdmin) {
      const identifier = req.headers['x-device-id'] || 
                         bodyDeviceId ||
                         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 
                         req.socket.remoteAddress;
                       
      const today = new Date().toISOString().split('T')[0];
      const usageKey = `usage:${identifier}:${today}`;

      try {
        const currentUsageRaw = await kv.get(usageKey);
        const currentUsage = currentUsageRaw ? parseInt(currentUsageRaw) : 0;

        if (currentUsage >= DAILY_LIMIT) {
          return res.status(429).json({ 
            message: "🎬 המסך ירד להיום. המכסה היומית הסתיימה. נתראה בפרימיירה של מחר." 
          });
        }
        
        const newValue = await kv.incr(usageKey);
        if (newValue === 1) {
          await kv.expire(usageKey, 86400); 
        }
      } catch (redisError) {
        console.error("Redis unreachable:", redisError.message);
      }
    }

    // 4. עיבוד וניקוי תוכן (השימוש ב-InputProcessor)
    // אנו מנקים את הז'אנר ואת הערך הגולמי של היומן
    const cleanGenre = sanitize(genre) || 'drama';
    
    if (!journalEntry || journalEntry.trim().length < 5) {
      return res.status(400).json({ message: 'היומן קצר מדי או חסר.' });
    }

    // 5. הגנה על הפרומפט (Prompt Shield)
    // כאן אנו עוטפים את היומן בבלוקים המוגנים לפני השליחה ל-AI
    const safeJournalEntry = prepareForAI(journalEntry);

    // 6. הפעלת מנוע התסריטים המשודרג
    // אנחנו שולחים את safeJournalEntry (המוגן) ואת cleanGenre (הנקי)
    const result = await generateScript(safeJournalEntry, cleanGenre);
    
    if (!result.success) {
      return res.status(500).json({ message: result.error || 'נכשלה יצירת התסריט.' });
    }

    // 7. החזרת התוצאה לממשק
return res.status(200).json({ 
      success: true,
      script: result.output,
      model: result.model // מוסיף את שם המודל (Gemini/Cohere/Gemma)
    });
    
  } catch (error) {
    console.error("API ERROR:", error);
    return res.status(500).json({ message: 'תקלה פנימית בשרת. אנא נסה שוב מאוחר יותר.' });
  }
}