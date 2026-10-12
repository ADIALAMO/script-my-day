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
 * @returns {{ kind: 'key', key: string } | { kind: 'hash', hash: string } | null}
 */
export function parseRef(ref) {
  if (!ref || typeof ref !== 'object') return null;
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
    const key = `report:alerts:${new Date().toISOString().slice(0, 13)}`;
    const n = await redis.incr(key);
    if (n === 1) await redis.expire(key, 2 * 3600);
    return n <= 30;
  } catch { return true; }
}

async function sendReportAlert({ kind, reason, contentId, reporters, owner, hidden, quarantine, provider }) {
  if (!(await alertBudgetOk())) { console.warn('🚩 report alert suppressed: hourly alert cap reached'); return; }
  const lines = [
    `🚩 *Content report*`,
    `Kind: ${escapeMarkdownV1(kind)} · Reason: ${escapeMarkdownV1(reason)}`,
    `Key: \`${String(contentId).replace(/[`\\]/g, '')}\``,
    `Reporters: ${Number(reporters)} · Owner: ${owner ? 'yes' : 'no'} · Hidden: ${hidden ? 'yes' : 'no'}`,
  ];
  if (provider) lines.push(`Provider: ${escapeMarkdownV1(provider)}`);
  if (quarantine === 'moved') lines.push('Quarantined in the private bucket.');
  else if (quarantine === 'not-configured') lines.push('⚠️ Quarantine bucket NOT configured: the object is STILL PUBLIC — take it down manually (scripts/takedown-object.mjs).');
  else if (quarantine === 'failed') lines.push('⚠️ Quarantine FAILED: the object may still be public — take it down manually.');
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

  // Owner: from the key segment when the key is known; a hash-only report (bytes generated this session, not uploaded) is the creator's.
  const owner = key ? isOwnerOfKey(identifier, key) : true;

  const whoKey = `report:who:${contentId}`;
  const added = await redis.sadd(whoKey, reporterSegment(identifier));
  await redis.expire(whoKey, WHO_TTL_SEC);
  const reporters = await redis.scard(whoKey);
  if (!added) return { ok: true, hidden: false, already: true };

  await bumpStats(reason);

  const hide = reporters >= (owner ? OWNER_THRESHOLD : OTHER_THRESHOLD);
  let quarantine = null;
  if (hide) {
    const payload = JSON.stringify({ at: Math.floor(Date.now() / 1000), via: owner ? 'owner' : 'threshold', n: reporters });
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

  await sendReportAlert({ kind: reportKind, reason, contentId, reporters, owner, hidden: hide, quarantine, provider });
  return { ok: true, hidden: hide, already: false };
}
