/**
 * Single source of truth for the site's absolute base URL.
 *
 * Used for every absolute URL that an external crawler must be able to fetch — OG/Twitter
 * images (homepage + /i/<code>) and invite links. og:image MUST be absolute (crawlers like
 * WhatsApp/Facebook don't resolve relative URLs), so it has to point at a LIVE domain.
 *
 * Uses a NEXT_PUBLIC_ var so the value is identical on server and client (no hydration
 * mismatch) and is inlined at build time. Set `NEXT_PUBLIC_SITE_URL` in Vercel to the
 * canonical domain; until lifescript.app is actually connected, the fallback keeps every
 * absolute URL on the live Vercel deployment so previews never 404.
 *
 * When the custom domain goes live: set NEXT_PUBLIC_SITE_URL=https://lifescript.app and
 * redeploy — one change updates the homepage OG, invite links, and /i OG together.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://my-life-script.vercel.app')
  .replace(/\/$/, '');
