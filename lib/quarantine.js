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
export async function quarantineObject(key) {
  const qb = quarantineBucket();
  if (!qb) return { status: 'not-configured' };
  const pub = process.env.R2_BUCKET_NAME;
  const s3 = getS3();
  try {
    await s3.send(new CopyObjectCommand({ Bucket: qb, Key: key, CopySource: copySource(pub, key), MetadataDirective: 'COPY' }));
  } catch (e) {
    return { status: 'failed', error: `copy: ${e.message}` };
  }
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: pub, Key: key }));
  } catch (e) {
    // The copy exists but the public original could not be removed: still reachable → report it as failed so it is retried / handled manually.
    return { status: 'failed', error: `delete original: ${e.message}` };
  }
  return { status: 'moved' };
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
