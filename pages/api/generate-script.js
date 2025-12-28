import { generateScript } from '../../lib/story-service.js';
import Redis from 'ioredis';

const kv = new Redis(process.env.REDIS_URL, {
  connectTimeout: 5000,
  maxRetriesPerRequest: 1,
});

const DAILY_LIMIT = 2;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const { journalEntry, genre, adminKeyBody } = req.body;
    
    // משיכת המפתח ובדיקת אדמין (כולל המרה ל-String וניקוי רווחים למובייל)
    const clientAdminKey = (req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || adminKeyBody || '').toString().trim();
    const serverAdminSecret = (process.env.ADMIN_SECRET || '').toString().trim();
    
    const isAdmin = serverAdminSecret !== '' && clientAdminKey === serverAdminSecret;

    console.log('--- Production Admin Check ---');
    console.log('Match Status:', isAdmin);

    // לוגיקת המכסה - עכשיו היא חוסמת ומעדכנת מיד
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
        
        // רישום הבקשה ב-Redis מיד כדי למנוע "מירוץ" בזמן שהשרת נרדם
        await kv.incr(usageKey);
        await kv.expire(usageKey, 86400);
      } catch (redisError) {
        console.error("Redis error:", redisError.message);
      }
    }

    if (!journalEntry) return res.status(400).json({ message: 'Missing journal entry' });

    // יצירת התסריט (ללא שינוי בפונקציה)
    const result = await generateScript(journalEntry, genre || 'drama');
    
    if (!result.success) {
      return res.status(500).json({ message: result.error || 'Failed to generate script' });
    }

    return res.status(200).json({ script: result.output });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ message: 'תקלה בייצור התסריט.' });
  }
}