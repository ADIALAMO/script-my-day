/**
 * Validation + key generation for image uploads to R2 (pages/api/upload-panel.js).
 *
 * The client's data URI and key are NEVER trusted: the stored type comes from
 * the file's own magic bytes, and the object key is generated server-side so a
 * caller can neither pick a path nor overwrite an existing object.
 */
import { createHash, createHmac, randomUUID } from 'crypto';

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
 * Owner segment of an object key: HMAC-SHA256(OBJECT_KEY_SECRET, identifier), 128 bits, hex.
 * Keyed on purpose: a plain hash of an IPv4 address (the guest identifier) can be reversed by brute force, an HMAC
 * cannot without the secret. It stays DETERMINISTIC so that scripts/delete-user-data.js can list a user's objects
 * by prefix. Production without the secret fails CLOSED (clear error); dev/test fall back to a fixed dev secret.
 */
export function objectKeySecretConfigured() {
  return Boolean(process.env.OBJECT_KEY_SECRET) || process.env.NODE_ENV !== 'production';
}
function objectKeySecret() {
  const secret = process.env.OBJECT_KEY_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('OBJECT_KEY_SECRET is not configured — refusing to build R2 object keys (set it in the environment).');
  }
  return 'dev-only-object-key-secret';
}
export function ownerSegment(identifier) {
  return createHmac('sha256', objectKeySecret()).update(`owner:${String(identifier || 'anon')}`).digest('hex').slice(0, 32);
}
/**
 * Pseudonymous reporter id for the report feature (lib/report.js): HMAC-SHA256(OBJECT_KEY_SECRET, "report:" + identifier), 128 bits.
 * One-way and deterministic (so the same reporter counts once per content item); the raw IP / user id is never stored.
 * The "report:" label keeps it unrelated to the owner segment of object keys.
 */
export function reporterSegment(identifier) {
  return createHmac('sha256', objectKeySecret()).update(`report:${String(identifier || 'anon')}`).digest('hex').slice(0, 32);
}
/**
 * Pseudonymous creator id for the "active creators" count (lib/creator-stats.js): HMAC-SHA256(OBJECT_KEY_SECRET, "creator:" + identifier), 128 bits.
 * One-way and STABLE across days (a 7- / 30-day distinct count needs the same person to hash the same way); it goes only into a HyperLogLog, which keeps
 * register maxima and cannot be listed. The "creator:" label keeps it unrelated to the owner and reporter segments.
 */
export function creatorSegment(identifier) {
  return createHmac('sha256', objectKeySecret()).update(`creator:${String(identifier || 'anon')}`).digest('hex').slice(0, 32);
}
/** The segment used before OBJECT_KEY_SECRET existed (sha256 prefix). Kept ONLY so the deletion tool finds old objects. */
export function legacyOwnerSegment(identifier) {
  return createHash('sha256').update(String(identifier || 'anon')).digest('hex').slice(0, 16);
}

/**
 * Server-generated object key: <kind>/<HMAC owner>/<random UUID>.<ext> — no user id / IP, and an unguessable 122-bit
 * random name, so a public URL cannot be derived or enumerated. Existing objects keep their old keys and URLs.
 */
export function buildObjectKey(kind, identifier, ext) {
  return `${kind}/${ownerSegment(identifier)}/${randomUUID()}.${ext}`;
}

/**
 * Keys for a character upload: characters/<HMAC owner>/<uuid>-raw.<ext> and -sheet.jpg (one shared random id). `rawExt` comes from the
 * photo's own bytes (sniffImage), never from the client; the sheet is always stored as the JPEG the generators return.
 */
export function buildCharacterKeys(identifier, rawExt = 'jpg') {
  const id = randomUUID();
  const base = `characters/${ownerSegment(identifier)}/${id}`;
  return { raw: `${base}-raw.${rawExt}`, sheet: `${base}-sheet.jpg` };
}
