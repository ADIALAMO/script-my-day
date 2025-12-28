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
    const { journalEntry, genre } = req.body;
    
    // משיכת המפתח מהדפדפן
    const clientAdminKey = req.headers['x-admin-key'] || '';
    // משיכת המפתח מהשרת (מה שהגדרת בוורסל או ב-env.)
    const serverAdminSecret = process.env.ADMIN_SECRET || '';
    
    // השוואה נקייה - ללא ערכים "קשיחים" בקוד
    const isAdmin = serverAdminSecret !== '' && clientAdminKey === serverAdminSecret;

    // לוג לדיבוג בטרמינל (תוכל לראות את ההתאמה בזמן אמת)
    console.log('--- Production Admin Check ---');
    console.log('Browser Key:', clientAdminKey);
    console.log('Server Secret:', serverAdminSecret ? 'DEFINED' : 'MISSING');
    console.log('Match:', isAdmin);

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

    if (!journalEntry) return res.status(400).json({ message: 'Missing journal entry' });

    const result = await generateScript(journalEntry, genre || 'drama');
    if (!result.success) throw new Error(result.error);

    // עדכון מכסה רק אם המשתמש אינו אדמין
    if (!isAdmin) {
      try {
        const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        const today = new Date().toISOString().split('T')[0];
        const usageKey = `usage:${userIp}:${today}`;
        await kv.incr(usageKey);
        await kv.expire(usageKey, 86400);
      } catch (e) {}
    }

    return res.status(200).json({ script: result.output });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ message: 'תקלה בייצור התסריט.' });
  }
}