// Server-side proxy for R2/CDN panel images.
//
// Why this exists: R2's pub-*.r2.dev subdomain does not emit
// Access-Control-Allow-Origin headers, so browser canvas use (drawImage →
// captureStream) taints the canvas and produces black video frames.  Fetching
// the image server-side and re-serving it with CORS headers makes the response
// same-origin from the browser's perspective — no taint, no black frames.
//
// Security: only objects under our own R2_PUBLIC_URL origin are proxied (exact origin match, no
// credentials, no traversal, no private/loopback hosts — lib/proxy-url.js). Redirects are never
// followed and the body is capped (config/limits.js PROXY_IMAGE). Rate limited per client IP.

import { enforceRateLimit } from '../../lib/rate-limit.js';
import { extractTrustedIp } from '../../lib/api-utils.js';
import { resolveAllowedUrl, readCapped } from '../../lib/proxy-url.js';
import { PROXY_IMAGE } from '../../config/limits.js';

export const config = {
  api: { responseLimit: '8mb' },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  // Basic per-IP limit (before any outbound fetch). Responses are CDN-cached for a year, so
  // normal browsing only pays for cache MISSES. Falls back to an in-process limiter if Redis is down.
  if (await enforceRateLimit(req, res, 'proxy-image', {
    identifier: `ip:${extractTrustedIp(req)}`,
    fallback: { max: PROXY_IMAGE.perIpPerMinute, windowMs: 60_000 },
  })) return;

  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).end();

  const allowed = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  if (!allowed) {
    return res.status(500).json({ error: 'R2_PUBLIC_URL not configured.' });
  }

  const target = resolveAllowedUrl(url, allowed);
  if (!target) {
    return res.status(403).end();
  }

  try {
    // redirect:'manual' — R2 objects never redirect, so a 3xx is refused instead of followed
    // (a redirect to a private range is the classic SSRF bypass of a host allowlist).
    const upstream = await fetch(target, { redirect: 'manual', signal: AbortSignal.timeout(12000) });
    if (upstream.status >= 300 && upstream.status < 400) return res.status(502).end();
    if (!upstream.ok) return res.status(upstream.status).end();

    // Only ever re-serve real raster images from our own origin. Anything else
    // (text/html, SVG, …) would execute as same-origin content, so refuse it.
    const contentType = (upstream.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/') || contentType === 'image/svg+xml') {
      return res.status(415).end();
    }
    const buffer = await readCapped(upstream, PROXY_IMAGE.maxBytes);
    if (!buffer) return res.status(413).end();

    res.setHeader('Content-Type', contentType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Defence in depth: even if a non-image slipped through, the sandbox CSP
    // blocks scripts and gives it an opaque origin.
    res.setHeader('Content-Security-Policy', 'sandbox');
    res.setHeader('Access-Control-Allow-Origin', '*');
    // Browser cache: served from disk on repeat visits within 1 year.
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    // Vercel edge cache: serves repeated proxy requests from the CDN edge node
    // closest to the user, eliminating the R2→Vercel serverless round-trip.
    // Takes effect on Pro/Enterprise plans; harmless no-op on Hobby.
    res.setHeader('Vercel-CDN-Cache-Control', 'public, max-age=31536000, immutable');
    return res.status(200).send(buffer);
  } catch (err) {
    console.error('proxy-image error:', err.message);
    return res.status(502).end();
  }
}
