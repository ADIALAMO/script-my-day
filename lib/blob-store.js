/**
 * Object storage for user character images — Cloudflare R2.
 *
 * Wired to the SAME R2 bucket/credentials the posters & panels already use
 * (see pages/api/upload-panel.js). Character assets live under the `characters/`
 * prefix alongside the existing `panels/` and `posters/` prefixes.
 *
 * Why a blob store and not Redis: selfies/character sheets are hundreds of KB of
 * binary. Redis is for small hot state (the quota counters); image bytes live here,
 * lib/identity.js keeps only the URL pointer.
 *
 * Env (already present — no new setup):
 *   CLOUDFLARE_ACCOUNT_ID   account id → R2 S3 endpoint
 *   R2_ACCESS_KEY_ID        access key
 *   R2_SECRET_ACCESS_KEY    secret key
 *   R2_BUCKET_NAME          bucket
 *   R2_PUBLIC_URL           public base URL for reads
 */
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

// R2 client singleton — reuses the connection pool across warm invocations.
// Mirrors the setup in pages/api/upload-panel.js.
let _s3 = null;
function getS3() {
  if (!_s3) {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
    if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID not configured.');
    if (!process.env.R2_ACCESS_KEY_ID) throw new Error('R2_ACCESS_KEY_ID not configured.');
    if (!process.env.R2_SECRET_ACCESS_KEY) throw new Error('R2_SECRET_ACCESS_KEY not configured.');
    _s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId:     process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3;
}

/** True when R2 has everything it needs (creds + bucket + public URL). */
export function blobConfigured() {
  return Boolean(
    process.env.CLOUDFLARE_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME &&
    process.env.R2_PUBLIC_URL
  );
}

/**
 * Uploads raw bytes to R2 and returns a public URL.
 * @param {string} key         object key, e.g. "characters/u123-raw-1700.jpg"
 * @param {Buffer} bytes       image bytes
 * @param {string} contentType MIME type
 */
export async function putImage(key, bytes, contentType = 'image/jpeg') {
  const bucket    = process.env.R2_BUCKET_NAME;
  const publicUrl = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');

  await getS3().send(new PutObjectCommand({
    Bucket:       bucket,
    Key:          key,
    Body:         bytes,
    ContentType:  contentType,
    // Character assets are immutable once generated — aggressive CDN caching is safe.
    CacheControl: 'public, max-age=31536000, immutable',
  }));

  return `${publicUrl}/${key}`;
}

/** Decodes a "data:image/...;base64,..." URI into { bytes, contentType }. */
export function decodeDataUri(dataUri) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUri || '');
  if (!m) throw new Error('Not a base64 image data URI');
  return { bytes: Buffer.from(m[2], 'base64'), contentType: m[1] };
}
