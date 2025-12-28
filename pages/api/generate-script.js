import { generateScript } from '../../lib/story-service.js';
import Redis from 'ioredis';

// אתחול Redis נשאר בדיוק כפי שהיה
const kv = new Redis(process.env.REDIS_URL, {
  connectTimeout: 5000,
  maxRetriesPerRequest: 1,
});

const DAILY_LIMIT = 2;

export default async function handler(req, res) {
  // 1. בדיקת מתודה - נשמר
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    // 2. פירוק הבקשה - הוספתי את adminKeyBody כגיבוי למובייל
    const { journalEntry, genre, adminKeyBody } = req.body;
    
    // 3. משיכת המפתח - הוספתי בדיקה משולשת (Headers ו-Body)
    const clientAdminKey = req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || adminKeyBody || '';
    const serverAdminSecret = process.env.ADMIN_SECRET || '';
    
    // 4. השוואה נקייה (שימוש ב-trim למניעת רווחים מיותרים במובייל)
    const isAdmin = serverAdminSecret !== '' && clientAdminKey.toString().trim() === serverAdminSecret.toString().trim();

    // לוגים לדיבוג - נשאר זהה
    console.log('--- Production Admin Check ---');
    console.log('Browser Key Provided:', !!clientAdminKey);
    console.log('Match Status:', isAdmin);

    // 5. לוגיקת המכסה - לא נגעה, נשארת פעילה בדיוק באותה צורה
    if (!isAdmin) {
      const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
      const today = new Date().toISOString().split('T')[0];
      const usageKey = `usage:${userIp}:${today}`;

      try {
        const currentUsageRaw = await kv.get(usageKey);
        const currentUsage = currentUsageRaw ? parseInt(currentUsageRaw) : 0;

        if (currentUsage >= DAILY_LIMIT) {
          return res.status(429).json({ 
            message: `הגעת למכסה היומית (${DAILY_LIMIT}). נא הכנס קוד מנהל.` 
          });
        }
      } catch (redisError) {
        console.error("Redis unreachable, bypassing quota...");
      }
    }

    // 6. בדיקת קלט - נשמר
    if (!journalEntry) return res.status(400).json({ message: 'Missing journal entry' });

    // 7. הפונקציה הקריטית - יצירת התסריט (לא נגעה בכלל)
    const result = await generateScript(journalEntry, genre || 'drama');
    if (!result.success) throw new Error(result.error);

    // 8. עדכון מכסה - נשמר (רק אם אינו אדמין)
    if (!isAdmin) {
      try {
        const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const today = new Date().toISOString().split('T')[0];
        const usageKey = `usage:${userIp}:${today}`;
        await kv.incr(usageKey);
        await kv.expire(usageKey, 86400);
      } catch (e) {}
    }

    // 9. החזרת התוצאה - נשמר
    return res.status(200).json({ script: result.output });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ message: 'תקלה בייצור התסריט.' });
  }
}