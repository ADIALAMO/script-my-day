/**
 * Quarantine for reported images — a SEPARATE, PRIVATE R2 bucket (env R2_QUARANTINE_BUCKET_NAME).
 *
 * Why a second bucket: R2 access control is per bucket, not per object. A `quarantine/` prefix inside the public bucket would
 * stay readable at R2_PUBLIC_URL for anyone who knows the key. The quarantine bucket must have NO public access (no r2.dev URL,
 * no custom domain) and a 30-day lifecycle rule — both configured by hand in Cloudflare.
 *
 * Fail-safe: when R2_QUARANTINE_BUCKET_NAME is not set NOTHING is deleted or copied (status 'not-configured'); the caller still
 * hides the item in Redis and tells the owner the object is still public and needs a manual takedown.
 * A failed copy NEVER deletes the original.
 */
import { CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getS3 } from './blob-store.js';
import { safeErrInfo } from './safe-error.js';
import { isModeratedKey } from './object-scope.js';
import { parseLegacyRaw } from './leftover-raw.js';

export const quarantineBucket = () => process.env.R2_QUARANTINE_BUCKET_NAME?.trim() || null;
export const quarantineConfigured = () => Boolean(quarantineBucket());

const copySource = (bucket, key) => `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

/** { exists, metadata } of an object in the PUBLIC bucket. exists:false on a 404; throws on any other error. */
export async function headPublicObject(key) {
  try {
    const out = await getS3().send(new HeadObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: key }));
    return { exists: true, metadata: out?.Metadata ?? {} };
  } catch (e) {
    if (e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404 || e?.Code === 'NoSuchKey') return { exists: false, metadata: {} };
    throw e;
  }
}

/**
 * Moves one object from the public bucket into the private quarantine bucket (copy, then delete the original).
 * @returns {Promise<{status:'moved'|'not-configured'|'failed', error?:string}>}
 */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** runs `fn` up to `attempts` times with a short pause between tries; returns { ok } or { ok:false, error } */
async function withRetries(fn, attempts, backoffMs) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { await fn(); return { ok: true, attempts: i + 1 }; } catch (e) { last = e; }
    if (i < attempts - 1) await sleep(backoffMs[Math.min(i, backoffMs.length - 1)]);
  }
  return { ok: false, error: last?.message || String(last), attempts, ...safeErrInfo(last) };
}

/**
 * Moves one object from the public bucket into the private quarantine bucket (copy, then delete the original). The copy and the delete are
 * each retried inline (3 tries, short pauses) so a transient R2 hiccup does not leave a reported image public; the original is NEVER deleted
 * unless a copy succeeded. The daily sweep (pages/api/cron/sweep-hidden.js) retries anything still failing.
 * @returns {Promise<{status:'moved'|'not-configured'|'failed', error?:string, attempts?:number}>}
 */
export async function quarantineObject(key, opts = {}) {
  // Defence in depth for EVERY caller (report, sweep cron, scripts): only generated panels / posters and current-format Star Yourself objects
  // (characters/<owner>/<uuid>-raw|sheet.<ext>, lib/object-scope.js) can ever be moved — nothing else in the bucket, never a traversal-looking key.
  return moveToQuarantine(key, isModeratedKey, opts);
}

/**
 * The one-off clean-up of LEGACY raw selfies (characters/<id>-raw-<stamp>.jpg, the key embeds a user id): the same copy-then-delete move, but ONLY for a key
 * that is exactly that shape. Used by scripts/quarantine-legacy-raw-selfies.mjs after it verified the sheet and the pointer. The app itself never calls it.
 */
export async function quarantineLegacyRaw(key, opts = {}) {
  return moveToQuarantine(key, (k) => parseLegacyRaw(k) !== null, opts);
}

async function moveToQuarantine(key, inScope, { attempts = 3, backoffMs = [200, 600] } = {}) {
  if (!inScope(key)) return { status: 'failed', error: 'key is not a moderated object', stage: 'key-guard', cls: 'OutOfScope', http: null };
  const qb = quarantineBucket();
  if (!qb) return { status: 'not-configured' };
  const pub = process.env.R2_BUCKET_NAME;
  const s3 = getS3();
  const copy = await withRetries(() => s3.send(new CopyObjectCommand({ Bucket: qb, Key: key, CopySource: copySource(pub, key), MetadataDirective: 'COPY' })), attempts, backoffMs);
  if (!copy.ok) return { status: 'failed', error: `copy: ${copy.error}`, attempts: copy.attempts, stage: 'copy', cls: copy.cls, http: copy.http };
  const del = await withRetries(() => s3.send(new DeleteObjectCommand({ Bucket: pub, Key: key })), attempts, backoffMs);
  // The copy exists but the public original could not be removed: still reachable → 'failed' so the sweep / a human finishes it.
  if (!del.ok) return { status: 'failed', error: `delete original: ${del.error}`, attempts: del.attempts, stage: 'delete-original', cls: del.cls, http: del.http };
  return { status: 'moved', attempts: copy.attempts };
}

/** Moves one object back from quarantine into the public bucket (used by scripts/restore-reported.mjs). */
export async function restoreObject(key) {
  const qb = quarantineBucket();
  if (!qb) throw new Error('R2_QUARANTINE_BUCKET_NAME is not set');
  const pub = process.env.R2_BUCKET_NAME;
  const s3 = getS3();
  await s3.send(new CopyObjectCommand({ Bucket: pub, Key: key, CopySource: copySource(qb, key), MetadataDirective: 'COPY' }));
  await s3.send(new DeleteObjectCommand({ Bucket: qb, Key: key }));
}
