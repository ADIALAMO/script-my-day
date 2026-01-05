import { generateScript } from '../../lib/story-service.js';
import Redis from 'ioredis';

// חיבור ל-Redis - שמירה על הגדרות החיבור המקוריות למניעת קריסות
const kv = new Redis(process.env.REDIS_URL, {
  connectTimeout: 5000,
  maxRetriesPerRequest: 1,
});

const DAILY_LIMIT = 2;

export default async function handler(req, res) {
  // 1. אבטחת מתודה - פונקציה חיונית
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const { journalEntry, genre, adminKeyBody, deviceId: bodyDeviceId } = req.body;
    
    // 2. אימות אדמין - בדיקה כפולה (Header + Body) כפי שהיה במקור
    const clientAdminKey = (req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || adminKeyBody || '').toString().trim();
    const serverAdminSecret = (process.env.ADMIN_SECRET || '').toString().trim();
    const isAdmin = serverAdminSecret !== '' && clientAdminKey === serverAdminSecret;

    // 3. מנגנון Blocking פונקציונלי (חיוני!)
    if (!isAdmin) {
      // זיהוי לפי מכשיר (Device ID) הוא המזהה החזק ביותר שלנו
      const identifier = req.headers['x-device-id'] || 
                         bodyDeviceId ||
                         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 
                         req.socket.remoteAddress;
                       
      const today = new Date().toISOString().split('T')[0];
      const usageKey = `usage:${identifier}:${today}`;

      try {
        const currentUsageRaw = await kv.get(usageKey);
        const currentUsage = currentUsageRaw ? parseInt(currentUsageRaw) : 0;

        // בדיקת חסימה
        if (currentUsage >= DAILY_LIMIT) {
          return res.status(429).json({ 
            message: "🎬 המסך ירד להיום. המכסה היומית הסתיימה. נתראה בפרימיירה של מחר." 
          });
        }
        
        // עדכון מונה השימוש - פונקציה חיונית לעבודה עם Redis
        const newValue = await kv.incr(usageKey);
        
        // הגדרת תפוגה רק ביצירה הראשונה (שיפור ביצועים)
        if (newValue === 1) {
          await kv.expire(usageKey, 86400); 
        }
        
      } catch (redisError) {
        // מנגנון Fail-safe: אם Redis נופל, המשתמש לא נחסם
        console.error("Redis unreachable:", redisError.message);
      }
    }

    // 4. בדיקת תקינות תוכן
    if (!journalEntry || journalEntry.trim().length < 5) {
      return res.status(400).json({ message: 'היומן קצר מדי או חסר.' });
    }

    // 5. הפעלת מנוע התסריטים המשודרג
    // שים לב: הלוגיקה של השפה הועברה לתוך story-service למניעת באגים
    const result = await generateScript(journalEntry, genre || 'drama');
    
    if (!result.success) {
      return res.status(500).json({ message: result.error || 'נכשלה יצירת התסריט.' });
    }

    // 6. החזרת התוצאה לממשק
    return res.status(200).json({ script: result.output });

  } catch (error) {
    console.error("API ERROR:", error);
    return res.status(500).json({ message: 'תקלה פנימית בשרת. אנא נסה שוב מאוחר יותר.' });
  }
}