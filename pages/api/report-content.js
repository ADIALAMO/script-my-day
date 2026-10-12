/**
 * POST /api/report-content — "Report" button for generated posters, comic panels and reels.
 *
 *   body: { kind: 'poster'|'panel'|'reel', reason: 'sexual'|'violent'|'other', refs: [{ url } | { hash } | { gallery: 'poster:<id>'|'reel:<id>' }]  (1–8) }
 *
 * No free text, no image bytes, nothing personal is accepted or stored: a ref is either an object URL under our own R2 public
 * URL (panels/ or posters/ only) or the SHA-256 of the image bytes. The reporter is counted by a one-way HMAC (lib/report.js).
 * The owner's report hides the image at once; anyone else needs two distinct reporters. Hiding = the object moves to the
 * private quarantine bucket, the image proxy answers 410 and upload-panel refuses the same bytes.
 * A { gallery } ref is a static showcase item (lib/gallery-report.js): the client hides it locally and the owner is alerted with the file path.
 */
import { CODES } from '../../lib/messages.js';
import { enforceRateLimit } from '../../lib/rate-limit.js';
import { getSessionAndTier } from '../../lib/auth.js';
import { isAdminRequest, extractIdentifier } from '../../lib/api-utils.js';
import { reporterSegment } from '../../lib/upload-image.js';
import { getToken } from 'next-auth/jwt';
import { REPORT_KINDS, REPORT_REASONS, MAX_REFS, parseRef, registerReport } from '../../lib/report.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ message: 'Method Not Allowed' });

  // Before any parsing or Redis work. The limiter is keyed by the same one-way reporter id used for counting (the JWT is only
  // decoded, no Redis), so not even the short-lived rate-limit counter holds a raw IP or user id for this route.
  let who = extractIdentifier(req);
  try { const token = await getToken({ req, secret: process.env.NEXTAUTH_SECRET }); if (token?.uid) who = `u:${token.uid}`; } catch { /* guest */ }
  if (await enforceRateLimit(req, res, 'report-content', { identifier: `rp:${reporterSegment(who)}` })) return;

  const { kind, reason, refs } = req.body ?? {};
  if (!REPORT_KINDS.includes(kind) || !REPORT_REASONS.includes(reason) || !Array.isArray(refs) || refs.length < 1 || refs.length > MAX_REFS) {
    return res.status(400).json({ success: false, code: CODES.REPORT_INVALID });
  }
  const targets = refs.map(parseRef);
  if (targets.every((t) => t === null)) return res.status(400).json({ success: false, code: CODES.REPORT_INVALID });

  try {
    const identifier = isAdminRequest(req) ? 'admin' : (await getSessionAndTier(req, res)).identifier;

    // De-duplicate refs inside one request (a reel lists each frame once even if the client repeats one).
    const seen = new Set();
    const results = [];
    for (const t of targets) {
      if (!t) { results.push({ ok: false }); continue; }
      const id = t.kind === 'key' ? t.key : t.kind === 'gallery' ? `g:${t.id}` : `h:${t.hash}`;
      if (seen.has(id)) { results.push({ ok: true, hidden: false, already: true }); continue; }
      seen.add(id);
      const r = await registerReport(t, { identifier, reportKind: kind, reason });
      results.push(r.ok ? { ok: true, hidden: r.hidden, already: r.already } : { ok: false });
    }
    if (!results.some((r) => r.ok)) return res.status(400).json({ success: false, code: CODES.REPORT_INVALID });
    return res.status(200).json({ success: true, results });
  } catch (e) {
    console.error('report-content error:', e.message);
    return res.status(503).json({ success: false, code: CODES.SERVER_ERROR });
  }
}
