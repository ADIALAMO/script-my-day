// Server-side proxy for R2/CDN panel images.
//
// Why this exists: R2's pub-*.r2.dev subdomain does not emit
// Access-Control-Allow-Origin headers, so browser canvas use (drawImage →
// captureStream) taints the canvas and produces black video frames.  Fetching
// the image server-side and re-serving it with CORS headers makes the response
// same-origin from the browser's perspective — no taint, no black frames.
//
// Security: only URLs that begin with our own R2_PUBLIC_URL are proxied.
// Any other URL receives 403, preventing open-redirect / SSRF abuse.

export const config = {
  api: { responseLimit: '8mb' },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();

  const { url } = req.query;
  if (!url || typeof url !== 'string') return res.status(400).end();

  const allowed = (process.env.R2_PUBLIC_URL ?? '').replace(/\/$/, '');
  if (!allowed) {
    return res.status(500).json({ error: 'R2_PUBLIC_URL not configured.' });
  }

  if (!url.startsWith(allowed + '/')) {
    return res.status(403).end();
  }

  try {
    const upstream = await fetch(url, { signal: AbortSignal.timeout(12000) });
    if (!upstream.ok) return res.status(upstream.status).end();

    const contentType = upstream.headers.get('content-type') || 'image/jpeg';
    const buffer = Buffer.from(await upstream.arrayBuffer());

    res.setHeader('Content-Type', contentType);
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
