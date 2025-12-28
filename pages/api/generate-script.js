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
    // שליפת הנתונים כולל deviceId מה-Body כגיבוי
    const { journalEntry, genre, adminKeyBody, deviceId: bodyDeviceId } = req.body;
    
    // 1. זיהוי אדמין
    const clientAdminKey = (req.headers['x-admin-key'] || req.headers['X-Admin-Key'] || adminKeyBody || '').toString().trim();
    const serverAdminSecret = (process.env.ADMIN_SECRET || '').toString().trim();
    const isAdmin = serverAdminSecret !== '' && clientAdminKey === serverAdminSecret;

    // 2. לוגיקת המכסה - זיהוי לפי מכשיר (Device ID)
    if (!isAdmin) {
      // תיעדוף למזהה המכשיר שהגדרנו ב-Frontend
      // סדר עדיפויות: Header -> Body -> IP (כמוצא אחרון בלבד)
      const identifier = req.headers['x-device-id'] || 
                         bodyDeviceId ||
                         (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 
                         req.socket.remoteAddress;
                       
      const today = new Date().toISOString().split('T')[0];
      
      // המפתח ב-Redis מבוסס עכשיו על המכשיר הקבוע!
      const usageKey = `usage:${identifier}:${today}`;

      try {
        const currentUsageRaw = await kv.get(usageKey);
        const currentUsage = currentUsageRaw ? parseInt(currentUsageRaw) : 0;

        if (currentUsage >= DAILY_LIMIT) {
          return res.status(429).json({ 
            message: "🎬 המסך ירד להיום. האורות באולפן כבו והמכסה היומית הסתיימה. נתראה בפרימיירה של מחר." 
          });
        }
        
        // עדכון המכסה ב-Redis
        const newValue = await kv.incr(usageKey);
        
        // הגדרת תפוגה של 24 שעות (86400 שניות) רק ביצירה הראשונה
        if (newValue === 1) {
          await kv.expire(usageKey, 86400); 
        }
        
        console.log(`Usage tracked for Device/ID: ${identifier} | Count: ${newValue}`);
        
      } catch (redisError) {
        console.error("Redis unreachable, relying on good faith:", redisError.message);
      }
    }

    // 3. יצירת התסריט
    if (!journalEntry) return res.status(400).json({ message: 'Missing journal entry' });

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