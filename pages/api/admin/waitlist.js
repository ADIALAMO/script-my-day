import redis from '../../../lib/redis.js';
import { requireAdmin } from '../../../lib/admin-auth.js';
import { safeErrInfo, formatSafeErr } from '../../../lib/safe-error.js';
import { toCsv } from '../../../lib/csv.js';
import { WAITLIST_KEY_PREFIX, normalizeEmail, rowFromValue, compareRows } from '../../../lib/waitlist.js';

/**
 * GET /api/admin/waitlist?limit=&offset=&q=&format=json|csv        ADMIN ONLY (401 no session / 403 not an admin; the admin key only as a HEADER)
 *
 * Lists the Pro waitlist (v1 records AND legacy bare timestamps), newest first, rows without a date last. Never returns the Redis key, only record fields.
 * JSON: a page of { email, createdAt, locale, source, signedIn } (no userId). CSV: the whole filtered list, with the userId column.
 * Every answer — errors included — is private (no-store). Nothing from a row is ever logged.
 */
const SCAN_COUNT = 500;
const MGET_BATCH = 200;
const MAX_KEYS = 20_000;       // far above any realistic list; `truncated` says so when hit
const MAX_LIMIT = 200;
const CSV_COLUMNS = ['email', 'createdAt', 'locale', 'source', 'userId', 'consentVersion'];

function privateHeaders(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, max-age=0, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function loadAll() {
  const keys = []; let cursor = '0'; let truncated = false;
  do {
    const [next, batch] = await redis.scan(cursor, { match: `${WAITLIST_KEY_PREFIX}*`, count: SCAN_COUNT });
    for (const k of batch || []) { if (keys.length >= MAX_KEYS) { truncated = true; break; } keys.push(String(k)); }
    cursor = String(next);
  } while (cursor !== '0' && !truncated);
  const rows = []; let unreadable = 0;
  for (let i = 0; i < keys.length; i += MGET_BATCH) {
    const slice = keys.slice(i, i + MGET_BATCH);
    const values = await redis.mget(...slice);
    slice.forEach((key, j) => {
      const email = key.slice(WAITLIST_KEY_PREFIX.length);
      const row = normalizeEmail(email) === email ? rowFromValue(email, values[j]) : null;
      if (row) rows.push(row); else unreadable += 1;
    });
  }
  rows.sort(compareRows);
  return { rows, unreadable, truncated };
}

export default async function handler(req, res) {
  privateHeaders(res);
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });
  if (!(await requireAdmin(req, res))) return;

  const q = typeof req.query?.q === 'string' ? req.query.q.trim().toLowerCase().slice(0, 100) : '';
  const format = req.query?.format === 'csv' ? 'csv' : 'json';
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(req.query?.limit, 10) || 50));
  const offset = Math.max(0, parseInt(req.query?.offset, 10) || 0);

  let data;
  try { data = await loadAll(); }
  catch (e) {
    console.error(`Admin waitlist failed (${formatSafeErr(safeErrInfo(e))})`);
    return res.status(500).json({ error: 'Could not load the waitlist.' });
  }
  const { rows, unreadable, truncated } = data;
  const filtered = q ? rows.filter((r) => r.email.includes(q)) : rows;

  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="waitlist-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.status(200).send(toCsv(CSV_COLUMNS, filtered));
  }

  const page = filtered.slice(offset, offset + limit).map((r) => ({ email: r.email, createdAt: r.createdAt, locale: r.locale, source: r.source, signedIn: !!r.userId }));
  return res.status(200).json({
    total: rows.length,
    filtered: filtered.length,
    legacy: rows.filter((r) => r.source === 'legacy-waitlist').length,
    signedIn: rows.filter((r) => r.userId).length,
    unreadable,
    truncated,
    limit,
    offset,
    hasMore: offset + limit < filtered.length,
    entries: page,
  });
}
