/**
 * Has a stored poster / comic panel been deleted by the storage lifecycle rules (R2: posters/ and panels/ are removed automatically)?
 *
 * Asked ONLY after an <img> failed to load, and only once per URL: the same-origin /api/proxy-image answers with the object store's own status,
 * so `404` = the object is gone. Anything else — no network, a timeout, 5xx, 429, 403 (not ours), 410 (reported/hidden), even 200 — is NOT "expired"
 * and keeps whatever the screen did before (the retry path for a panel, the plain image for a poster). The message must never appear for a failure
 * that is not a confirmed 404.
 */
export const EXPIRY_CHECK_TIMEOUT_MS = 6000;

/** only stored objects (http/https URLs) can expire; data: / blob: / relative URLs never do */
export const isStoredObjectUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

/**
 * @param {string} url
 * @param {{ fetchFn?: typeof fetch, timeoutMs?: number }} [opts]
 * @returns {Promise<boolean>} true ONLY when the proxy answered HTTP 404
 */
export async function isImageExpired(url, { fetchFn, timeoutMs = EXPIRY_CHECK_TIMEOUT_MS } = {}) {
  if (!isStoredObjectUrl(url)) return false;
  const doFetch = fetchFn || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return false;
  let ctl = null; let timer = null;
  try {
    if (typeof AbortController === 'function') { ctl = new AbortController(); timer = setTimeout(() => ctl.abort(), timeoutMs); }
    const res = await doFetch(`/api/proxy-image?url=${encodeURIComponent(url)}`, ctl ? { signal: ctl.signal } : undefined);
    try { res?.body?.cancel?.(); } catch { /* the body is not needed: only the status is */ }
    return res?.status === 404;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * What a failed image shows, from the state of its (single) expiry check:
 *   'idle'     → no failure yet                       → the image as usual
 *   'checking' → failed, the proxy is being asked     → an EMPTY dark tile (no message, no red "lost" text: nothing flashes)
 *   'expired'  → confirmed 404                        → the neutral "deleted automatically" tile
 *   'other'    → anything else                        → today's behaviour (retry tile / the plain image)
 */
export const EXPIRY_VIEW = { idle: 'image', checking: 'blank', expired: 'expired', other: 'image' };
export const expiryView = (check) => EXPIRY_VIEW[check] || 'image';
