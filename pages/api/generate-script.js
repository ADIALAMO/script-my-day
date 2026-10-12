import { generateScript } from '../../lib/story-service.js';
import redis from '../../lib/redis.js';
import { sanitize } from '../../utils/input-processor';
import { CODES } from '../../lib/messages.js';
import { nextMidnightUTC, isAdminRequest } from '../../lib/api-utils.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { reserveScriptQuota, releaseScriptQuota } from '../../lib/script-quota.js';
import { reserveGuestScriptBudget, releaseGuestScriptBudget } from '../../lib/guest-budget.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { checkContent } from '../../lib/content-blocklist.js';
import { checkTextOutput } from '../../lib/text-check.js';
import { REGENERATION_SAFETY_LINE } from '../../lib/content-safety.js';

// Must be a top-level export — NOT nested inside config — for Vercel to honour it.
export const maxDuration = 60;

// The route is killed at 60 s (and a killed function never releases the reserved quota): the output check and the ONE regeneration run inside
// this budget, and a regeneration is only started when enough of it is left.
const ROUTE_BUDGET_MS = 57000;
const REGEN_MIN_LEFT_MS = 22000;

const REQUIRED_KEYS = ['GOOGLE_GEMINI_API_KEY', 'OPENROUTER_API_KEY', 'COHERE_API_KEY'];

export default async function handler(req, res) {
  const startedAt = Date.now();
  const left = () => ROUTE_BUDGET_MS - (Date.now() - startedAt);
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

    // Keyword blocklist (lib/content-blocklist.js) — before any quota is reserved, so a hit costs the user nothing.
    // Only the category is logged, never the text.
    const screened = checkContent(`${safeJournalEntry}\n${cleanGenre}`);
    if (screened.blocked) {
      console.warn(`🛑 generate-script: input blocked by content blocklist (category=${screened.category})`);
      return res.status(400).json({ success: false, code: CODES.CONTENT_BLOCKED, message: 'Content not allowed.' });
    }

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
      if (result.refused) {
        console.warn('🛑 generateScript: a provider refused the content — request ended');
        return res.status(422).json({ success: false, code: CODES.CONTENT_REFUSED, message: 'Content refused.' });
      }
      console.error('❌ generateScript failed:', result.error);
      return res.status(500).json({
        success: false,
        code: CODES.SCRIPT_FAIL,
        message: 'Script generation failed.',
      });
    }

    // ── OUTPUT CHECK (lib/text-check.js) ───────────────────────────────────────
    // Every script passes the output blocklist; ROMANCE and HORROR also pass the paid classifier (fail-closed). A held-back output gets ONE
    // automatic regeneration with an extra safety line; if that is held back too the user gets CONTENT_REFUSED. When the classifier is required
    // and cannot answer, nothing is returned (CONTENT_CHECK_UNAVAILABLE). In every refusal the quota slot is given back.
    const giveBack = async () => { await releaseScriptQuota(reservation); if (guestBudgetReserved) await releaseGuestScriptBudget(); };
    const refuse = async (why) => {
      console.warn(`🛑 generate-script: output held back (${why})`);
      await giveBack();
      return res.status(422).json({ success: false, code: CODES.CONTENT_REFUSED, message: 'Content refused.' });
    };
    const unavailable = async () => {
      await giveBack();
      return res.status(503).json({ success: false, code: CODES.CONTENT_CHECK_UNAVAILABLE, message: 'Safety check unavailable.' });
    };
    // Anything unexpected inside the output check (a thrown error) must never leak the reserved quota slot: give it back and say the check is unavailable.
    try {
      let check = await checkTextOutput(result.output, { genre: cleanGenre, budgetMs: left() });
      if (check.verdict === 'unavailable') return unavailable();
      if (check.verdict !== 'safe') {
        if (left() < REGEN_MIN_LEFT_MS) return refuse(`${check.stage}, no time to regenerate`);
        console.warn(`🛑 generate-script: output held back (${check.stage}) — regenerating once`);
        let again;
        try {
          again = await generateScript(safeJournalEntry, cleanGenre, cleanGender, { extraSafety: REGENERATION_SAFETY_LINE, budgetMs: left() - 9000 });
        } catch { again = { success: false }; }
        if (!again.success) return refuse('regeneration failed');
        check = await checkTextOutput(again.output, { genre: cleanGenre, budgetMs: left() });
        if (check.verdict === 'unavailable') return unavailable();
        if (check.verdict !== 'safe') return refuse(`${check.stage} (after regeneration)`);
        result = again;
      }
    } catch (e) {
      console.error('generate-script: output check failed unexpectedly:', e.message);
      return unavailable();
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
