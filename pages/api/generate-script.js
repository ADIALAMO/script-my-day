import { generateScript } from '../../lib/story-service.js';
import redis from '../../lib/redis.js';
import { sanitize } from '../../utils/input-processor';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, extractIdentifier, isAdminRequest } from '../../lib/api-utils.js';

// Must be a top-level export — NOT nested inside config — for Vercel to honour it.
export const maxDuration = 60;

const DAILY_LIMIT = 3;
const REQUIRED_KEYS = ['GOOGLE_GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'COHERE_API_KEY'];

export default async function handler(req, res) {
  // Single outer try/catch so nothing — not even the env audit or quota gate — can
  // produce an uncaught exception that makes Vercel return a bare HTML 500.
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method Not Allowed' });
    }

    // ── Env-var audit (visible in Vercel → Project → Logs) ──────────────────
    const keyAudit = REQUIRED_KEYS.reduce((acc, k) => {
      acc[k] = process.env[k]?.trim() ? 'SET' : 'MISSING';
      return acc;
    }, {});
    console.log('🔑 Key audit:', JSON.stringify(keyAudit));

    const missingKeys = REQUIRED_KEYS.filter(k => !process.env[k]?.trim());
    if (missingKeys.length === REQUIRED_KEYS.length) {
      console.error('❌ No AI provider keys configured in environment:', missingKeys);
      return res.status(500).json({
        success: false,
        message: 'Server misconfiguration: no AI provider keys set.',
        missingKeys,
      });
    }
    if (missingKeys.length > 0) {
      console.warn('⚠️ Some provider keys missing — those stages will be skipped:', missingKeys);
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const { journalEntry, genre, deviceId: bodyDeviceId } = req.body;

    const isAdmin = isAdminRequest(req);
    let usageKey = null;

    // ── Quota gate ────────────────────────────────────────────────────────────
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
    }

    // ── Input validation ──────────────────────────────────────────────────────
    const cleanGenre = sanitize(genre) || 'drama';
    if (!journalEntry || journalEntry.trim().length < 5) {
      return res.status(400).json({
        success: false,
        code: CODES.INPUT_TOO_SHORT,
        message: 'Journal entry too short.',
      });
    }

    const safeJournalEntry = sanitize(journalEntry);

    // ── AI generation ─────────────────────────────────────────────────────────
    console.log('🎬 Starting generateScript...');
    const result = await generateScript(safeJournalEntry, cleanGenre);

    if (!result.success) {
      console.error('❌ generateScript failed:', result.error);
      return res.status(500).json({
        success: false,
        code: CODES.SCRIPT_FAIL,
        message: result.error || 'Script generation failed.',
      });
    }

    // ── Quota increment (atomic pipeline) ─────────────────────────────────────
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

    return res.status(200).json({
      success: true,
      script: result.output,
      model: result.model,
    });

  } catch (error) {
    // Log the full error so it appears verbatim in Vercel → Project → Logs.
    console.error('🔴 SERVER CRASH ——————————————————————————');
    console.error('Name   :', error.name);
    console.error('Message:', error.message);
    console.error('Stack  :', error.stack);
    console.error('————————————————————————————————————————————');

    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: error.message || 'Internal server error.',
      errorType: error.name,
    });
  }
}
