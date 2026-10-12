/**
 * GET /api/cron/sweep-hidden — daily Vercel cron (vercel.json). Finds reported ("hidden") images whose object is still in the PUBLIC bucket and
 * moves them to the private quarantine bucket (lib/report-sweep.js → lib/quarantine.js). Move only, never delete. Sends one Telegram digest
 * when there is something to report.
 *
 * Auth: Vercel sends `Authorization: Bearer <CRON_SECRET>` when the CRON_SECRET environment variable exists. Without CRON_SECRET (or with a wrong
 * header) the route answers 401 and does nothing — fail-closed, it is never open to the public.
 */
import { createHash, timingSafeEqual } from 'crypto';
import redis from '../../../lib/redis.js';
import { scanHiddenKeys, sweepHidden } from '../../../lib/report-sweep.js';
import { headPublicObject, quarantineObject, quarantineConfigured } from '../../../lib/quarantine.js';
import { alertOnce } from '../../../lib/alert-throttle.js';
import { escapeMarkdownV1 } from '../../../lib/telegram.js';

export const maxDuration = 60;

const MAX_KEYS = 1000;
const DEADLINE_MS = 45_000;

function authorised(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = String(req.headers?.authorization || '');
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ message: 'Method Not Allowed' });
  if (!authorised(req)) return res.status(401).json({ message: 'Unauthorized' });

  try {
    const keys = await scanHiddenKeys(redis, MAX_KEYS);
    const result = await sweepHidden({
      keys,
      headPublic: async (key) => (await headPublicObject(key)).exists,
      quarantine: (key) => quarantineObject(key),
      apply: true,
      deadlineMs: DEADLINE_MS,
    });

    // Yesterday's report volume for the digest (counter written by lib/report.js; absent = 0).
    let reportsToday = 0;
    try { reportsToday = parseInt(await redis.get(`stats:report:${new Date().toISOString().split('T')[0]}`), 10) || 0; } catch { /* digest only */ }

    const stuck = result.stillPublic.length - result.moved;
    if (result.moved || stuck || result.failed.length || result.notConfigured || result.timedOut) {
      const day = new Date().toISOString().split('T')[0];
      const lines = [
        '🧹 *Report sweep*',
        `Hidden items checked: ${result.examined}${result.timedOut ? ' (stopped at the time limit — the rest next run)' : ''} · reports today so far: ${reportsToday}`,
        `Were still public: ${result.stillPublic.length} · moved to quarantine now: ${result.moved}`,
      ];
      if (result.notConfigured || (!quarantineConfigured() && stuck)) lines.push('⚠️ R2_QUARANTINE_BUCKET_NAME is NOT set: hidden objects remain public until it is configured (scripts/takedown-object.mjs sweep --apply).');
      if (result.failed.length) lines.push(`⚠️ ${result.failed.length} object(s) could not be moved (retried tomorrow). First key: \`${escapeMarkdownV1(result.failed[0]).replace(/\\/g, '')}\``);
      await alertOnce(`report-sweep:${day}`, lines.join('\n'), { windowSec: 20 * 3600 });
    }
    console.log(`🧹 sweep-hidden: examined=${result.examined} stillPublic=${result.stillPublic.length} moved=${result.moved} failed=${result.failed.length} notConfigured=${result.notConfigured} timedOut=${result.timedOut}`);
    // Counts only — keys are never returned.
    return res.status(200).json({ success: true, examined: result.examined, stillPublic: result.stillPublic.length, moved: result.moved, failed: result.failed.length, notConfigured: result.notConfigured, timedOut: result.timedOut });
  } catch (e) {
    console.error('sweep-hidden error:', e.message);
    return res.status(500).json({ success: false });
  }
}
