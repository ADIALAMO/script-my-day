import { generateScript } from '../../lib/story-service.js';
import Redis from 'ioredis';
// ייבוא המעבד החדש שיצרנו
import { sanitize, prepareForAI } from '../../utils/input-processor';

// --- הגדרה קריטית להרצה על Vercel: מאפשר זמן המתנה ל-AI ---
export const config = {
  maxDuration: 60, 
};

// חיבור ל-Redis באמצעות ה-URL מה-env (בדיוק כמו בפוסטר)
const kv = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1, 
  connectTimeout: 1000,    
  lazyConnect: true,       
  retryStrategy: () => null 
});

kv.on('error', (err) => console.log('📡 Redis Offline Mode (Local/Network)'));
const DAILY_LIMIT = 8;

export default async function handler(req, res) {
  // 1. אבטחת מתודה
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    // שליפת נתונים גולמיים מהבקשה
    const { journalEntry, genre, adminKeyBody, deviceId: bodyDeviceId } = req.body;
    
    // 2. אימות אדמין
    const clientAdminKey = sanitize(req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || adminKeyBody || '');
    const serverAdminSecret = sanitize(process.env.ADMIN_SECRET || '');
    const isAdmin = serverAdminSecret !== '' && clientAdminKey === serverAdminSecret;

    let usageKey = null;

    // 3. מנגנון Blocking פונקציונלי (Redis)
    if (!isAdmin) {
      const identifier = req.headers['x-device-id'] || 
                         bodyDeviceId ||
                         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 
                         req.socket.remoteAddress;
                       
      const today = new Date().toISOString().split('T')[0];
      // שימוש במפתח ייעודי לתסריטים כדי להפריד מהפוסטרים
      usageKey = `usage:script:${identifier}:${today}`;

     try {
        // שימוש ב-Race כדי לא להיתקע אם ה-DNS של Redis לא מגיב
        const currentUsage = await Promise.race([
          kv.get(usageKey),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 1000))
        ]);

        console.log(`📊 Redis Script Check: ${usageKey}, הערך: ${currentUsage}`);

        if (currentUsage && parseInt(currentUsage) >= DAILY_LIMIT) {
          return res.status(429).json({ 
            success: false,
            message: "🎬 המסך ירד להיום. מכסת התסריטים הסתיימה. נתראה בפרימיירה של מחר." 
          });
        }
      } catch (e) {
        // במקרה של שגיאת רשת/Redis - אנחנו מדלגים על החסימה ולא מפילים את השרת
        console.log("⚠️ Redis connection failed - skipping quota check");
      }
      // הסרנו את ה-disconnect כדי לשמור על חיבור יציב בזמן שה-AI רץ
    }

    // 4. עיבוד וניקוי תוכן
    const cleanGenre = sanitize(genre) || 'drama';
    if (!journalEntry || journalEntry.trim().length < 5) {
      return res.status(400).json({ message: 'היומן קצר מדי או חסר.' });
    }

    // 5. הגנה על הפרומפט (Prompt Shield)
    const safeJournalEntry = prepareForAI(journalEntry);

    // 6. הפעלת מנוע התסריטים המשודרג (השלב האיטי)
    const result = await generateScript(safeJournalEntry, cleanGenre);
    
    if (!result.success) {
      return res.status(500).json({ message: result.error || 'נכשלה יצירת התסריט.' });
    }

    // --- רישום המכסה רק לאחר הצלחה מוכחת ---
    if (!isAdmin && usageKey) {
      try {
        // המזהה כבר מחובר, פשוט מעדכנים
        const newVal = await kv.incr(usageKey);
        await kv.expire(usageKey, 86400);
        console.log(`✅ Script Quota updated. Current usage: ${newVal}`);
      } catch (err) {
        console.error("Quota update failed:", err.message);
      }
    }

    // 7. החזרת התוצאה לממשק
    return res.status(200).json({ 
      success: true,
      script: result.output,
      model: result.model 
    });
    
  } catch (error) {
    console.error("API ERROR:", error);
    try { await kv.disconnect(); } catch(e) {}
    return res.status(500).json({ message: 'תקלה פנימית בשרת. אנא נסה שוב מאוחר יותר.' });
  }
}