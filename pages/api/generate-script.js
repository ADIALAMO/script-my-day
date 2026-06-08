import { generateScript } from '../../lib/story-service.js';
import redis from '../../lib/redis.js';
import { sanitize } from '../../utils/input-processor';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { limitFor } from '../../lib/quota.js';

// Must be a top-level export — NOT nested inside config — for Vercel to honour it.
export const maxDuration = 60;

const REQUIRED_KEYS = ['GOOGLE_GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'COHERE_API_KEY'];

export default async function handler(req, res) {
  // Single outer try/catch so nothing — not even the env audit or quota gate — can
  // produce an uncaught exception that makes Vercel return a bare HTML 500.
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ message: 'Method Not Allowed' });
    }

    const missingKeys = REQUIRED_KEYS.filter(k => !process.env[k]?.trim());
    if (missingKeys.length === REQUIRED_KEYS.length) {
      console.error('generate-script: no AI provider keys configured');
      return res.status(500).json({
        success: false,
        message: 'Server misconfiguration: no AI provider keys set.',
      });
    }

    // ── Parse body ────────────────────────────────────────────────────────────
    const { journalEntry, genre, gender } = req.body;

    const isAdmin = isAdminRequest(req);
    let usageKey  = null;
    let dailyLimit = 0;

    // ── Quota gate ────────────────────────────────────────────────────────────
    if (!isAdmin) {
      const { tier, identifier } = await getSessionAndTier(req, res);
      dailyLimit = limitFor(tier, 'script');
      const today = new Date().toISOString().split('T')[0];
      usageKey    = `usage:script:${identifier}:${today}`;

      try {
        const currentUsage = await redis.get(usageKey);
        const used = parseInt(currentUsage, 10) || 0;
        if (dailyLimit !== Infinity && used >= dailyLimit) {
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

    // Never trust the client blindly — coerce to the only three values we speak.
    const cleanGender = ['male', 'female', 'neutral'].includes(gender) ? gender : 'neutral';

    // ── AI generation ─────────────────────────────────────────────────────────
    const result = await generateScript(safeJournalEntry, cleanGenre, cleanGender);

    if (!result.success) {
      console.error('❌ generateScript failed:', result.error);
      return res.status(500).json({
        success: false,
        code: CODES.SCRIPT_FAIL,
        message: result.error || 'Script generation failed.',
      });
    }

    // ── Quota increment (atomic pipeline) ─────────────────────────────────────
    if (!isAdmin && usageKey && dailyLimit !== Infinity) {
      try {
        const pipeline = redis.pipeline();
        pipeline.incr(usageKey);
        pipeline.expireat(usageKey, nextMidnightUTC());
        await pipeline.exec();
      } catch (err) {
        console.warn(`⚠️ Script quota increment skipped (Redis unavailable): ${err.message}`);
      }
    }

    // ── Global activity counters (all tiers) — powers /api/admin/stats ─────────
    // Outside the quota guard so Pro/admin creations are counted too. Daily key
    // expires at midnight UTC; the :total key is cumulative. Best-effort.
    try {
      const today = new Date().toISOString().split('T')[0];
      const dayKey = `stats:script:global:${today}`;
      const pipeline = redis.pipeline();
      pipeline.incr(dayKey);
      pipeline.expireat(dayKey, nextMidnightUTC());
      pipeline.incr('stats:script:total');
      await pipeline.exec();
    } catch (err) {
      console.warn(`⚠️ Script stats counter skipped (Redis unavailable): ${err.message}`);
    }

    return res.status(200).json({
      success: true,
      script: result.output,
      model: result.model,
    });

  } catch (error) {
    console.error('generate-script unhandled error:', error.message, error.stack);

    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: error.message || 'Internal server error.',
      errorType: error.name,
    });
  }
}
