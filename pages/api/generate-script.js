import { generateScript } from '../../lib/story-service.js';
import Redis from 'ioredis';

const kv = new Redis(process.env.REDIS_URL, {
  connectTimeout: 5000,
  maxRetriesPerRequest: 1,
  retryStrategy: (times) => (times > 1 ? null : 50)
});

kv.on('error', (err) => console.warn('Redis Connection Issue (Non-critical):', err.message));

const DAILY_LIMIT = 2;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  try {
    const { journalEntry, genre } = req.body;
    
    // זיהוי אדמין חסין טעויות (Case-insensitive headers)
    const adminKey = req.headers['x-admin-key'] || req.headers['X-Admin-Key'];
    const serverSecret = process.env.ADMIN_SECRET;
    const isAdmin = serverSecret && adminKey === serverSecret;
    
    const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const today = new Date().toISOString().split('T')[0];
    const usageKey = `usage:${userIp}:${today}`;

    // בדיקת מכסה למשתמשים רגילים
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
        console.error("Redis Check Skipped:", redisError.message);
      }
    }

    if (!journalEntry) return res.status(400).json({ message: 'Missing journal entry' });

    // יצירת התסריט דרך השירות הקיים
    const result = await generateScript(journalEntry, genre || 'drama');

    if (!result.success) throw new Error(result.error);

    // עדכון המכסה ב-Redis רק אם אינו אדמין
    if (!isAdmin) {
      try {
        await kv.incr(usageKey);
        await kv.expire(usageKey, 86400);
      } catch (e) {
        console.warn("Failed to update quota");
      }
    }

    return res.status(200).json({ script: result.output });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ error: 'SERVER_ERROR', message: 'תקלה טכנית באולפנים.' });
  }
}