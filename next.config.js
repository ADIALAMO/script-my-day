/** @type {import('next').NextConfig} */

// ── Environment guard ─────────────────────────────────────────────────────────
const isProd = process.env.NODE_ENV === 'production';

// ── Production-only CSP ───────────────────────────────────────────────────────
//
// WHY CSP IS EXCLUDED FROM DEVELOPMENT:
//
//   1. eval() — Next.js dev mode uses webpack's eval-source-map devtool, which
//      wraps every compiled module in eval(). Without 'unsafe-eval' in
//      script-src, the browser silently drops every chunk → React never mounts
//      → blank page. Adding 'unsafe-eval' to prod CSP is unacceptable (it
//      negates the entire XSS protection).
//
//   2. WebSocket HMR — Next.js hot-module-reloading connects via
//      ws://localhost:3000/_next/webpack-hmr. CSP's connect-src: 'self' does
//      NOT cover ws:// scheme URIs; only https:// and http:// are matched by
//      'self'. Every dev-mode save would fail to propagate.
//
//   3. Version drift — Next.js internals (chunk naming, inline bootstrapper
//      scripts, dynamic import URLs) change between minor releases. Whitelisting
//      them in CSP creates ongoing maintenance burden with no security benefit
//      (CSP on localhost protects no real users).
//
//   PRODUCTION is where CSP matters: real users, real attack surface, HTTPS.
//   Vercel terminates TLS at the edge before the request reaches Next.js, so
//   all HTTPS-enforcement directives work exactly as intended there.
//
// 'unsafe-inline' on script-src:
//   Next.js Pages Router injects inline hydration <script> tags. These cannot
//   be eliminated without per-request nonces (requires custom middleware). This
//   is the accepted baseline until a nonce-based CSP is wired in.
//
// camera omitted from Permissions-Policy:
//   CharacterModal's "Star Yourself" selfie capture requires the camera API.
//
// upgrade-insecure-requests:
//   Rewrites http:// sub-resource requests to https://. Safe on Vercel (HTTPS
//   at the edge). Must stay out of dev — on http://localhost:3000 it would
//   upgrade asset URLs to https://localhost:3000/... → TLS handshake failure.

const CSP_DIRECTIVES = [
  "default-src 'self'",

  // Next.js inline hydration scripts + Vercel Analytics loader
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",

  // Tailwind utility classes, framer-motion inline styles, optional Google Fonts
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",

  // Poster/comic images (data URI or R2 CDN) + Google OAuth profile photos
  "img-src 'self' data: blob: https://*.r2.dev https://lh3.googleusercontent.com",

  // Heebo font subsets (self-hosted or jsDelivr) + Google Fonts glyphs
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.jsdelivr.net",

  // All XHR/fetch calls stay on-origin; Vercel telemetry endpoints explicit
  "connect-src 'self' https://va.vercel-scripts.com https://vitals.vercel-insights.com",

  "media-src 'self' blob:",
  "frame-src 'none'",

  // Belt-and-suspenders with X-Frame-Options: DENY for pre-CSP browsers
  "frame-ancestors 'none'",

  "object-src 'none'",

  // Prevents <base href="…"> injection from hijacking relative URLs
  "base-uri 'self'",

  // Locks down <form action="…"> injection; our checkout uses JS navigation
  "form-action 'self' https://checkout.stripe.com https://billing.stripe.com",

  // Rewrite http:// sub-resources to https:// — production only (see note above)
  "upgrade-insecure-requests",
];

// ── Header sets ───────────────────────────────────────────────────────────────
//
// These four headers are safe and useful in both dev and prod — they impose no
// HTTPS requirements and place no restrictions on script execution or fetch.

const SHARED_HEADERS = [
  {
    // Prevents MIME-type sniffing — critical for user-uploaded selfie blobs
    // and generated images returned via /api/proxy-image.
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    // Blocks the app from being embedded in a foreign <iframe> (clickjacking).
    // Belt-and-suspenders with CSP frame-ancestors for pre-CSP browsers.
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    // Limits referrer data sent to third-party AI/analytics providers so that
    // internal URL paths are not leaked in upstream request logs.
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    // Deny powerful browser features the app does not use.
    // camera= is intentionally absent — the selfie capture feature requires it.
    key: 'Permissions-Policy',
    value: 'microphone=(), geolocation=(), usb=(), bluetooth=()',
  },
];

// Production appends the two HTTPS-enforcement headers on top of the shared set.
const securityHeaders = isProd
  ? [
      ...SHARED_HEADERS,
      {
        // Tells browsers to pin HTTPS for 1 year, including subdomains.
        // Must not be sent in dev — on localhost it survives restarts and
        // forces every subsequent visit to https://localhost:3000, which has
        // no TLS listener and breaks the dev server across the full max-age.
        key: 'Strict-Transport-Security',
        value: 'max-age=31536000; includeSubDomains',
      },
      {
        key: 'Content-Security-Policy',
        value: CSP_DIRECTIVES.join('; '),
      },
    ]
  : SHARED_HEADERS;

// ── Next.js config ────────────────────────────────────────────────────────────

const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['ioredis'],

  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
