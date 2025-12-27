// pages/api/generate-script.js
import { generateScript } from '../../lib/story-service.js';

// אובייקט לשמירת המכסה בזיכרון השרת
const usageStore = {}; 

// המכסה המעודכנת לשלב הפיתוח: 2 תסריטים ביום למשתמש
const DAILY_LIMIT = 2; 

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    const { journalEntry, genre } = req.body;
    
    // 1. זיהוי מנהל (Admin Bypass)
    const adminKey = req.headers['x-admin-key'];
    const isAdmin = adminKey === process.env.ADMIN_SECRET;

    // 2. בדיקת מכסה למשתמשים רגילים
    if (!isAdmin) {
      const userIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const today = new Date().toISOString().split('T')[0];
      const usageKey = `${userIp}-${today}`;

      if (!usageStore[usageKey]) {
        usageStore[usageKey] = 0;
      }

      if (usageStore[usageKey] >= DAILY_LIMIT) {
        return res.status(429).json({ 
          error: 'QUOTA_EXCEEDED',
          message: 'הגעת למכסה היומית (2 תסריטים). נחזור מחר עם כוחות מחודשים!' 
        });
      }

      // קידום המונה רק אחרי שווידאנו שיש טקסט (כדי לא לבזבז ניסיון על טעות)
      if (journalEntry && journalEntry.trim().length > 0) {
        usageStore[usageKey]++;
      }
    }

    if (!journalEntry) {
      return res.status(400).json({ message: 'Missing journal entry' });
    }

    // 3. קריאה לשירות יצירת התסריט (OpenRouter)
    const result = await generateScript(journalEntry, genre || 'drama');

    if (!result.success) {
      // טיפול במכסה של ה-Provider עצמו
      if (result.error?.includes('429') || result.error?.includes('balance')) {
        return res.status(503).json({ 
          error: 'PROVIDER_LIMIT',
          message: 'מנוע היצירה עמוס כרגע (מכסת API) בטיפול ההפקה! ' 
        });
      }
      throw new Error(result.error);
    }

    return res.status(200).json({ script: result.output });

  } catch (error) {
    console.error("API Error:", error);
    return res.status(500).json({ 
      error: 'SERVER_ERROR',
      message: 'תקלה טכנית באולפנים. נסה שוב בעוד רגע.' 
    });
  }
}