/**
 * In-app "Report" for generated images (Google Play AI-Generated Content policy). Pure helpers + the Redis/R2 logic used by
 * pages/api/report-content.js. Nothing here stores image bytes, text, IPs or user ids.
 *
 *   contentId   the R2 object key (url reports) or "h:<sha256 of the image bytes>" (hash reports for an image not uploaded yet)
 *   who         report:who:<contentId>      SET of pseudonymous reporter ids (HMAC, lib/upload-image.js reporterSegment), 90 d
 *   hidden      report:hidden:<contentId>   JSON {at, via, n}, 400 d — the image proxy answers 410, upload-panel refuses the bytes
 *   objkey      objkey:<sha256>             the R2 key an uploaded image got (written by upload-panel) so a hash report finds it
 *
 * Hide rule: the OWNER's report hides immediately (the owner is normally the only person who ever sees the image); anyone else
 * needs 2 DISTINCT reporters. Owner = the reporter's owner segment equals the one inside the object key.
 */
import redis from './redis.js';
import { resolveAllowedUrl } from './proxy-url.js';
import { keyFromPublicUrl } from './blob-store.js';
import { ownerSegment, reporterSegment } from './upload-image.js';
import { headPublicObject, quarantineObject } from './quarantine.js';
import { alertOnce } from './alert-throttle.js';
import { escapeMarkdownV1 } from './telegram.js';
import { nextMidnightUTC } from './api-utils.js';
import { resolveGalleryRef } from './gallery-report.js';

export const REPORT_KINDS = ['poster', 'panel', 'reel'];
export const REPORT_REASONS = ['sexual', 'violent', 'other'];
export const MAX_REFS = 8;
export const WHO_TTL_SEC = 90 * 24 * 60 * 60;
export const HIDDEN_TTL_SEC = 400 * 24 * 60 * 60;
export const OWNER_THRESHOLD = 1;
export const OTHER_THRESHOLD = 2;

const NEW_KEY = /^(panels|posters)\/([0-9a-f]{32})\/[0-9a-f-]{36}\.(png|jpg|webp)$/;
const LEGACY_KEY = /^(panels|posters)\/[A-Za-z0-9_-]{1,100}\.(png|jpg|webp)$/;
const HASH = /^[0-9a-f]{64}$/;

/** true for an object key a user may report: generated panels/posters only (never characters/, never traversal) */
export function isReportableKey(key) {
  return typeof key === 'string' && key.length <= 200 && (NEW_KEY.test(key) || LEGACY_KEY.test(key));
}
export const isValidHash = (h) => typeof h === 'string' && HASH.test(h);

/** owner segment inside a current-format key, or null (legacy keys carry none) */
export function keyOwnerSegment(key) {
  const m = NEW_KEY.exec(key || '');
  return m ? m[2] : null;
}

/** true when `identifier` (session / guest identifier) is the one that generated the object `key` */
export function isOwnerOfKey(identifier, key) {
  const seg = keyOwnerSegment(key);
  return Boolean(seg) && seg === ownerSegment(identifier);
}

/**
 * Turns one client ref into a normalised target, or null when it is not reportable.
 * @returns {{ kind: 'key', key: string } | { kind: 'hash', hash: string } | { kind: 'gallery', id: string, paths: string[] } | null}
 */
export function parseRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
  if (ref.gallery !== undefined && ref.url === undefined && ref.hash === undefined) {   // static gallery item: a lookup key only, the path comes from our own list
    const g = resolveGalleryRef(ref.gallery);
    return g ? { kind: 'gallery', id: g.id, paths: g.paths } : null;
  }
  if (typeof ref.url === 'string') {
    const base = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
    if (!base || !resolveAllowedUrl(ref.url, base)) return null;
    let key = keyFromPublicUrl(ref.url.split(/[?#]/)[0]);
    if (key) { try { key = decodeURIComponent(key); } catch { return null; } }
    return isReportableKey(key) ? { kind: 'key', key } : null;
  }
  if (isValidHash(ref.hash)) return { kind: 'hash', hash: ref.hash };
  return null;
}

const dayStamp = () => new Date().toISOString().split('T')[0];

async function bumpStats(reason) {
  try {
    const day = `stats:report:${dayStamp()}`;
    const pipe = redis.pipeline();
    pipe.incr(day); pipe.expireat(day, nextMidnightUTC() + 30 * 86400);
    pipe.incr('stats:report:total');
    pipe.incr(`stats:report:reason:${reason}`);
    await pipe.exec();
  } catch { /* best effort */ }
}

/** global cap on report alerts so a flood of reports cannot saturate the Telegram chat (30 per hour) */
async function alertBudgetOk() {
  try {
    const hour = new Date().toISOString().slice(0, 13);
    const key = `report:alerts:${hour}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 2 * 3600);
    if (n === 31) {
      // The FIRST report over the cap sends ONE count alert, so a flood is visible instead of silent. Reports still hide and quarantine normally;
      // the details are in Redis (report:hidden:*, stats:report:<day>) and in the daily sweep digest.
      await alertOnce(`report-flood:${hour}`, `🚩 *Report volume high:* more than 30 reports in the hour starting ${hour}:00 UTC. Individual alerts are suppressed for the rest of this hour (every report is still processed). See the daily sweep digest.`, { windowSec: 2 * 3600 });
    }
    return n <= 30;
  } catch { return true; }
}

/**
 * Race fix for hash reports: a report made while the image was only in the browser hides the bytes (`report:hidden:h:<hash>`); if the upload
 * had ALREADY stored the object by then, upload-panel calls this right after it wrote `objkey:` — it hides + quarantines that object and alerts.
 * @returns {Promise<'moved'|'not-configured'|'failed'>}
 */
export async function takedownAfterUpload(key, hash) {
  let meta = {};
  try { const raw = await redis.get(`report:hidden:h:${hash}`); meta = typeof raw === 'string' ? JSON.parse(raw) : (raw || {}); } catch { /* keep defaults */ }
  const payload = JSON.stringify({ at: Math.floor(Date.now() / 1000), via: 'upload-race', n: meta.n ?? 1, reason: meta.reason ?? 'other', kind: meta.kind ?? 'panel' });
  await redis.set(`report:hidden:${key}`, payload, { ex: HIDDEN_TTL_SEC });
  const q = await quarantineObject(key);
  if (q.status === 'failed') console.error(`🚩 quarantine after upload race failed for ${key}: ${q.error}`);
  await sendReportAlert({ kind: meta.kind ?? 'panel', reason: meta.reason ?? 'other', contentId: key, reporters: meta.n ?? 1, owner: true, hidden: true, quarantine: q.status });
  return q.status;
}

async function sendReportAlert({ kind, reason, contentId, reporters, owner, hidden, quarantine, provider, legacy = false }) {
  if (!(await alertBudgetOk())) { console.warn('🚩 report alert suppressed: hourly alert cap reached'); return; }
  const lines = [
    `🚩 *Content report*`,
    `Kind: ${escapeMarkdownV1(kind)} · Reason: ${escapeMarkdownV1(reason)}`,
    `Key: \`${String(contentId).replace(/[`\\]/g, '')}\``,
    `Reporters: ${Number(reporters)} · Owner: ${legacy ? 'legacy key (counted as owner)' : owner ? 'yes' : 'no'} · Hidden: ${hidden ? 'yes' : 'no'}`,
  ];
  if (provider) lines.push(`Provider: ${escapeMarkdownV1(provider)}`);
  if (quarantine === 'moved') lines.push('Quarantined in the private bucket.');
  else if (quarantine === 'not-configured') lines.push('⚠️ Quarantine bucket NOT configured: the object is STILL PUBLIC — take it down manually (scripts/takedown-object.mjs).');
  else if (quarantine === 'failed') lines.push('⚠️ Quarantine FAILED after 3 tries: the object may still be public — the daily sweep retries it (or run scripts/takedown-object.mjs sweep --apply).');
  else if (quarantine === 'pending-upload') lines.push('Not uploaded yet: the same bytes will be refused at upload.');
  await alertOnce(`report:${String(contentId).slice(-40)}`, lines.join('\n'), { windowSec: 24 * 60 * 60 });
}

/**
 * Registers one report. Returns { ok:false, invalid:true } for a ref that cannot be reported, otherwise
 * { ok:true, hidden, already } (already = this reporter had reported it before; nothing was counted twice).
 * Throws on a Redis failure — the route answers with a retryable error.
 *
 * @param {{kind:'key',key:string}|{kind:'hash',hash:string}} target
 * @param {{identifier:string, reportKind:string, reason:string}} ctx
 */
export async function registerReport(target, { identifier, reportKind, reason }) {
  if (target.kind === 'gallery') return registerGalleryReport(target, { identifier, reportKind, reason });
  let key = target.kind === 'key' ? target.key : null;
  let hash = target.kind === 'hash' ? target.hash : null;

  if (hash && !key) {
    key = (await redis.get(`objkey:${hash}`)) || null;                 // uploaded since: report the stored object
    if (key && !isReportableKey(key)) key = null;
    if (!key && (await redis.get(`imgok:${hash}`)) === null) return { ok: false, invalid: true };   // never generated here (or marker expired, never uploaded)
  }

  const contentId = key || `h:${hash}`;
  const hiddenKey = `report:hidden:${contentId}`;

  // Already hidden → idempotent (and the object may already be gone from the public bucket, so skip the HEAD).
  if (await redis.get(hiddenKey)) return { ok: true, hidden: true, already: true };

  let provider = null;
  if (key) {
    const head = await headPublicObject(key).catch(() => null);        // an R2 hiccup must not lose the report
    if (head && !head.exists) return { ok: false, invalid: true };
    provider = head?.metadata?.provider ?? null;
  }

  // Owner: from the key segment when the key is known. Two cases count as the owner without a match: a hash-only report (bytes generated this
  // session, not uploaded yet) and a LEGACY key (panels/<session>_NN.png from before keys carried an owner segment) — those carry no owner at all,
  // so without this rule a lone owner could never hide one of their old images. Both are still bounded by the per-reporter rate limit.
  const legacyKey = Boolean(key) && !keyOwnerSegment(key);
  const owner = key ? (legacyKey || isOwnerOfKey(identifier, key)) : true;

  const whoKey = `report:who:${contentId}`;
  const added = await redis.sadd(whoKey, reporterSegment(identifier));
  await redis.expire(whoKey, WHO_TTL_SEC);
  const reporters = await redis.scard(whoKey);
  if (!added) return { ok: true, hidden: false, already: true };

  await bumpStats(reason);

  const hide = reporters >= (owner ? OWNER_THRESHOLD : OTHER_THRESHOLD);
  let quarantine = null;
  if (hide) {
    const payload = JSON.stringify({ at: Math.floor(Date.now() / 1000), via: legacyKey ? 'legacy-owner' : owner ? 'owner' : 'threshold', n: reporters, reason, kind: reportKind });
    // SET NX elects exactly one request to perform the takedown when several reports race.
    const won = await redis.set(hiddenKey, payload, { nx: true, ex: HIDDEN_TTL_SEC });
    if (won !== null && won !== undefined) {
      if (hash) await redis.set(`report:hidden:h:${hash}`, payload, { ex: HIDDEN_TTL_SEC });   // bytes can no longer be uploaded
      if (key) {
        const q = await quarantineObject(key);
        quarantine = q.status;
        if (q.status === 'failed') console.error(`🚩 quarantine failed for ${key}: ${q.error}`);
      } else {
        quarantine = 'pending-upload';
      }
    } else {
      return { ok: true, hidden: true, already: false };
    }
  }

  await sendReportAlert({ kind: reportKind, reason, contentId, reporters, owner, hidden: hide, quarantine, provider, legacy: legacyKey });
  return { ok: true, hidden: hide, already: false };
}

/**
 * A report on a static gallery item. Nothing is stored about the item (no hidden mark, no list, no threshold): the client hides it on that device and the
 * owner gets an alert with the file path on EVERY report from a different reporter (the same reporter repeating within a day alerts once; the hourly
 * alert cap of the other reports applies). The path comes from our own showcase list, never from the request.
 */
async function registerGalleryReport(target, { identifier, reportKind, reason }) {
  await bumpStats(reason);
  if (await alertBudgetOk()) {
    const lines = [
      '🚩 *Gallery report*',
      `Kind: ${escapeMarkdownV1(reportKind)} · Reason: ${escapeMarkdownV1(reason)}`,
      `Item: \`${target.id}\``,
      ...target.paths.map((p) => `File: \`public${p.replace(/[`\\]/g, '')}\``),
      'Hidden only on the reporter\'s device; the file stays public until removed (git rm + deploy).',
    ];
    await alertOnce(`report-gallery:${target.id}:${reporterSegment(identifier)}`, lines.join('\n'), { windowSec: 24 * 60 * 60 });
  }
  return { ok: true, hidden: false, already: false, local: true };
}
