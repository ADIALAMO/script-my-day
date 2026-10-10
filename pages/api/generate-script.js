import { generateScript } from '../../lib/story-service.js';
import redis from '../../lib/redis.js';
import { sanitize } from '../../utils/input-processor';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { reserveScriptQuota, releaseScriptQuota } from '../../lib/script-quota.js';
import { reserveGuestScriptBudget, releaseGuestScriptBudget } from '../../lib/guest-budget.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';

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

    // ── Rate limiting (sliding window, before quota gate) ─────────────────────
    // Rejects automated burst attacks before they can race through the quota
    // counter. Admin requests bypass this (isAdminRequest check is inside).
    if (await enforceRateLimit(req, res, 'generate-script')) return;

    // ── Parse body ────────────────────────────────────────────────────────────
    const { journalEntry, genre, gender } = req.body;

    const isAdmin = isAdminRequest(req);
    let tier = 'admin';
    let identifier = 'admin';

    if (!isAdmin) {
      const ctx = await getSessionAndTier(req, res);
      tier = ctx.tier;
      identifier = ctx.identifier;
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

    // ── Quota gate ────────────────────────────────────────────────────────────
    // Reserved atomically (INCR then compare) once the input is valid; given back below if no
    // script is produced. Free/Pro daily values live in config/limits.js. Redis trouble fails open.
    let reservation = null;
    let guestBudgetReserved = false;
    if (!isAdmin) {
      try {
        const q = await reserveScriptQuota(tier, identifier);
        if (!q.ok) {
          // Guests get a sign-up nudge; Pro gets its own messages (daily / monthly) with no upgrade pitch.
          const code = tier === 'anonymous' ? CODES.QUOTA_SCRIPT_GUEST
                     : tier === 'pro'       ? (q.scope === 'month' ? CODES.QUOTA_SCRIPT_PRO_MONTH : CODES.QUOTA_SCRIPT_PRO)
                     :                        CODES.QUOTA_SCRIPT;
          return res.status(429).json({
            success: false,
            code,
            limit: q.limit,
            resetsAt: q.resetsAt,
            message: q.scope === 'month' ? 'Monthly script quota reached.' : 'Daily script quota reached. Come back tomorrow.',
          });
        }
        reservation = q;
        // Guests also draw on a GLOBAL daily budget (all guests together). Signed-in users never do.
        if (tier === 'anonymous') {
          const g = await reserveGuestScriptBudget();
          if (!g.ok) {
            await releaseScriptQuota(reservation); // the guest keeps their own per-IP slot
            return res.status(429).json({
              success: false,
              code: CODES.GUEST_CAPACITY_REACHED,
              resetsAt: g.resetsAt,
              message: 'Guest capacity reached for today. Sign in to continue.',
            });
          }
          guestBudgetReserved = g.reserved;
        }
      } catch (e) {
        console.warn(`⚠️ Script quota reservation skipped (Redis unavailable): ${e.message}`);
      }
    }

    // ── AI generation ─────────────────────────────────────────────────────────
    let result;
    try {
      result = await generateScript(safeJournalEntry, cleanGenre, cleanGender);
    } catch (e) {
      await releaseScriptQuota(reservation);
      if (guestBudgetReserved) await releaseGuestScriptBudget();
      throw e;
    }

    if (!result.success) {
      await releaseScriptQuota(reservation); // nothing was produced → no script spent
      if (guestBudgetReserved) await releaseGuestScriptBudget();
      console.error('❌ generateScript failed:', result.error);
      return res.status(500).json({
        success: false,
        code: CODES.SCRIPT_FAIL,
        message: 'Script generation failed.',
      });
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
      message: 'Internal server error.',
    });
  }
}
