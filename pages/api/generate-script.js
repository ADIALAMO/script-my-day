import { generateScript } from '../../lib/story-service.js';
import Redis from 'ioredis';

// אתחול Redis עם הגדרות חיבור חזקות יותר
const kv = new Redis(process.env.REDIS_URL, {
  connectTimeout: 5000, // מחכה רק 5 שניות לחיבור
  maxRetriesPerRequest: 1, // לא מנסה לנצח - אם נכשל, נכשל מהר
  retryStrategy: (times) => {
    if (times > 1) return null; // מפסיק לנסות אחרי פעם אחת
    return 50;
  }
});

// למנוע מהטרמינל להתמלא בשגיאות "Unhandled error event"
kv.on('error', (err) => console.warn('Redis Connection Issue (Non-critical):', err.message));

const DAILY_LIMIT = 2;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const { journalEntry, genre } = req.body;
    const adminKey = req.headers['x-admin-key'];
    const isAdmin = adminKey === process.env.ADMIN_SECRET;
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const today = new Date().toISOString().split('T')[0];
    const usageKey = `usage:${userIp}:${today}`;

    // בדיקת מכסה - עם הגנה מפני קריסת ה-Redis
    if (!isAdmin) {
      try {
        const currentUsageRaw = await kv.get(usageKey);
        const currentUsage = currentUsageRaw ? parseInt(currentUsageRaw) : 0;

        if (currentUsage >= DAILY_LIMIT) {
          return res.status(429).json({ 
            error: 'QUOTA_EXCEEDED',
            message: `הגעת למכסה היומית (${DAILY_LIMIT} תסריטים). נחזור מחר!` 
          });
        }
      } catch (redisError) {
        console.error("Redis Error - Skipping check:", redisError.message);
        // אם ה-Redis לא עונה, אנחנו נותנים למשתמש להמשיך כדי שהאתר לא יישבר
      }
    }

    if (!journalEntry) return res.status(400).json({ message: 'Missing journal entry' });

    // יצירת התסריט
    const result = await generateScript(journalEntry, genre || 'drama');

    if (!result.success) throw new Error(result.error);

    // עדכון המכסה
    if (!isAdmin) {
      try {
        await kv.incr(usageKey);
        await kv.expire(usageKey, 86400);
      } catch (e) {
        console.warn("Failed to update quota in Redis");
      }
    }

    return res.status(200).json({ script: result.output });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'תקלה טכנית באולפנים.' });
  }
}