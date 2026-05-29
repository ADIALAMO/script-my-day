import { generateScript } from '../../lib/story-service.js';
import redis from '../../lib/redis.js';
import { sanitize } from '../../utils/input-processor';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, extractIdentifier, isAdminRequest } from '../../lib/api-utils.js';

export const config = { maxDuration: 60 };

const DAILY_LIMIT = 3;

export default async function handler(req, res) {
  // 1. אבטחת מתודה
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  try {
    // שליפת נתונים גולמיים מהבקשה
    const { journalEntry, genre, deviceId: bodyDeviceId } = req.body;

    // 2. Admin check
    const isAdmin = isAdminRequest(req);

    let usageKey = null;

    // 3. Quota gate
    if (!isAdmin) {
      const identifier = extractIdentifier(req, bodyDeviceId);
      const today      = new Date().toISOString().split('T')[0];
      usageKey         = `usage:script:${identifier}:${today}`;

      try {
        const currentUsage = await redis.get(usageKey);
        console.log(`📊 Script quota: ${usageKey} → ${currentUsage ?? 0}/${DAILY_LIMIT}`);
        if (currentUsage && parseInt(currentUsage, 10) >= DAILY_LIMIT) {
          return res.status(429).json({
            success: false,
            code: CODES.QUOTA_SCRIPT,
            message: 'Daily script quota reached. Come back tomorrow.',
          });
        }
      } catch (e) {
        console.warn(`⚠️ Script quota check skipped (Redis unavailable): ${e.message}`);
      }
      // הסרנו את ה-disconnect כדי לשמור על חיבור יציב בזמן שה-AI רץ
    }

    // 4. עיבוד וניקוי תוכן
    const cleanGenre = sanitize(genre) || 'drama';
    if (!journalEntry || journalEntry.trim().length < 5) {
      return res.status(400).json({ success: false, code: CODES.INPUT_TOO_SHORT, message: 'Journal entry too short.' });
    }

    // 5. ניקוי הקלט — העטיפה בסמני הזרקה מתבצעת ב-buildScriptPrompt בלבד (מניעת double-wrap)
    const safeJournalEntry = sanitize(journalEntry);

    // 6. הפעלת מנוע התסריטים המשודרג (השלב האיטי)
    const result = await generateScript(safeJournalEntry, cleanGenre);
    
    if (!result.success) {
      return res.status(500).json({ success: false, code: CODES.SCRIPT_FAIL, message: result.error || 'Script generation failed.' });
    }

    // --- רישום המכסה רק לאחר הצלחה מוכחת (atomic pipeline: incr + expire בפקודה אחת) ---
    if (!isAdmin && usageKey) {
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(usageKey);
        pipeline.expireat(usageKey, nextMidnightUTC());
        const [newVal] = await pipeline.exec();
        console.log(`✅ Script quota: ${newVal}/${DAILY_LIMIT} used`);
      } catch (err) {
        console.warn(`⚠️ Script quota increment skipped (Redis unavailable): ${err.message}`);
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
    return res.status(500).json({ success: false, code: CODES.SERVER_ERROR, message: 'Internal server error.' });
  }
}