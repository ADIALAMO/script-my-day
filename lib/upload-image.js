/**
 * Validation + key generation for image uploads to R2 (pages/api/upload-panel.js).
 *
 * The client's data URI and key are NEVER trusted: the stored type comes from
 * the file's own magic bytes, and the object key is generated server-side so a
 * caller can neither pick a path nor overwrite an existing object.
 */
import { createHash, randomBytes } from 'crypto';

// Decoded-size cap. A 1024px FLUX PNG is well under 2 MB; the route's 4 MB body
// limit (base64 ≈ 3 MB binary) is the outer bound.
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/**
 * Identifies png / jpeg / webp from magic bytes. Returns { mime, ext } or null.
 * Deliberately excludes SVG and anything else that can carry script.
 */
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/**
 * Parses "data:<anything>;base64,<payload>" and returns the decoded bytes, or
 * null when it isn't a base64 data URI. The claimed MIME type is ignored.
 */
export function decodeDataUriBytes(dataUri) {
  const m = /^data:[^;,]*;base64,(.+)$/s.exec(dataUri || '');
  if (!m) return null;
  return Buffer.from(m[1], 'base64');
}

/**
 * Server-generated object key: <kind>/<hash of identifier>/<ms>_<random>.<ext>
 * The identifier is hashed so no user id / IP lands in a public URL.
 */
export function buildObjectKey(kind, identifier, ext) {
  const owner = createHash('sha256').update(String(identifier || 'anon')).digest('hex').slice(0, 16);
  return `${kind}/${owner}/${Date.now()}_${randomBytes(8).toString('hex')}.${ext}`;
}
