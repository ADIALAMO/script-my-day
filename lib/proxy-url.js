/**
 * URL validation for /api/proxy-image (pure, no I/O — unit tested in tests/proxy-url.test.js).
 *
 * The proxy exists only to re-serve OUR OWN R2 objects with CORS headers. Anything else must be
 * refused, so the check compares the parsed ORIGIN (scheme + host + port) — not a string prefix —
 * and additionally rejects credentials, path traversal / encoded separators, and private /
 * loopback / link-local / metadata hosts as defense in depth (the host is fixed by the
 * R2_PUBLIC_URL env var, never taken from the request, so DNS-rebinding style tricks need the
 * attacker to control that value).
 */

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

/** True for hostnames that must never be fetched server-side. */
export function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.internal') || h.endsWith('.local')) return true;
  if (h.includes(':')) return true; // any IPv6 literal (::1, fc00::/7, fe80::/10, ::ffff:10.0.0.1 …)
  const m = IPV4.exec(h);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;            // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
    if (a >= 224) return true;                          // multicast / reserved
    return true;                                        // any other IP literal: R2 is a hostname
  }
  return false;
}

/**
 * @returns {string|null} the normalised URL to fetch, or null when it is not an object under
 *                        `allowedBase` (the R2 public URL).
 */
export function resolveAllowedUrl(raw, allowedBase) {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 2048) return null;
  let base; let u;
  try { base = new URL(allowedBase); u = new URL(raw); } catch { return null; }
  if (base.protocol !== 'https:' || u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  if (u.origin !== base.origin) return null;
  if (isPrivateHostname(u.hostname)) return null;
  const basePath = base.pathname.replace(/\/+$/, '');
  if (!u.pathname.startsWith(`${basePath}/`) || u.pathname === `${basePath}/`) return null;
  if (/%2e|%2f|%5c|%00|\\/i.test(u.pathname) || u.pathname.split('/').includes('..')) return null;
  return u.toString();
}

/**
 * Reads a fetch Response body into a Buffer, aborting as soon as it exceeds `maxBytes`
 * (Content-Length can be absent or wrong). Returns null when the cap is exceeded.
 */
export async function readCapped(response, maxBytes) {
  const declared = parseInt(response.headers.get('content-length'), 10);
  if (Number.isFinite(declared) && declared > maxBytes) { await response.body?.cancel?.(); return null; }
  if (!response.body?.getReader) {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > maxBytes ? null : buf;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}
