import { ImageResponse } from 'next/og';
import { OG_IMAGE } from '../../config/limits.js';
import { SITE_URL } from '../../lib/site.js';

export const config = { runtime: 'edge' };

// Heebo (the app's font) covers Hebrew AND Latin only via separate subset files, so we load
// both and hand them to satori under one family — it falls back across them per-glyph. Loading
// a Hebrew-capable font is MANDATORY: without it, satori renders Hebrew as empty boxes.
const FONT_URLS = [
  'https://cdn.jsdelivr.net/npm/@fontsource/heebo/files/heebo-hebrew-700-normal.woff',
  'https://cdn.jsdelivr.net/npm/@fontsource/heebo/files/heebo-latin-700-normal.woff',
];

// Outbound fetches are limited to a fixed host allowlist, never follow a redirect blindly (a
// redirect to a private range is the classic SSRF bypass) and are size-capped — the card only
// ever needs two small font files and our own logo.
const ALLOWED_ASSET_HOSTS = new Set(['cdn.jsdelivr.net', new URL(SITE_URL).hostname]);

async function fetchAsset(url) {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !ALLOWED_ASSET_HOSTS.has(u.hostname)) throw new Error('asset host not allowed');
  const res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (!res.ok) throw new Error(`asset HTTP ${res.status}`); // includes 3xx: redirects are refused
  const declared = parseInt(res.headers.get('content-length'), 10);
  if (Number.isFinite(declared) && declared > OG_IMAGE.maxAssetBytes) throw new Error('asset too large');
  const buf = await res.arrayBuffer();
  if (buf.byteLength > OG_IMAGE.maxAssetBytes) throw new Error('asset too large');
  return buf;
}

async function loadFonts() {
  const fonts = [];
  for (const url of FONT_URLS) {
    try {
      fonts.push({ name: 'Heebo', data: await fetchAsset(url), weight: 700, style: 'normal' });
    } catch { /* one subset failed — render with whatever loaded (graceful degradation) */ }
  }
  return fonts;
}

// satori lays text out left-to-right and does NOT apply the Unicode bidi algorithm, so raw
// Hebrew renders visually reversed. We reshape into VISUAL order ourselves: split into Hebrew
// vs non-Hebrew runs, reverse the run order, and reverse the characters inside Hebrew runs only
// (Latin/digits/brand names stay intact). Correct for our short, mostly-Hebrew labels.
function reshapeHebrew(text) {
  const isHeb = (ch) => /[֐-׿]/.test(ch);
  const runs = [];
  let buf = '';
  let bufHeb = null;
  for (const ch of text) {
    const h = isHeb(ch);
    if (bufHeb === null) { buf = ch; bufHeb = h; }
    else if (h === bufHeb) { buf += ch; }
    else { runs.push({ t: buf, heb: bufHeb }); buf = ch; bufHeb = h; }
  }
  if (buf) runs.push({ t: buf, heb: bufHeb });
  return runs.reverse().map((r) => (r.heb ? [...r.t].reverse().join('') : r.t)).join('');
}

// Embed the project logo as a data URI (robust: a failed fetch degrades to no-logo instead of
// breaking the whole card, which a bare <img> remote-fetch would do on a 404).
function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function loadLogo() {
  try {
    // Always OUR site (SITE_URL), never an origin derived from the request's Host header.
    return `data:image/png;base64,${bufToBase64(await fetchAsset(`${SITE_URL}/icon.png`))}`;
  } catch {
    return null;
  }
}

// ── Per-IP rate limit ─────────────────────────────────────────────────────────────────────────
// Edge-safe fixed window straight over Upstash's REST API (no Node-only client in the edge
// bundle): INCR + EXPIRE in one pipeline call, 1-minute buckets. FAIL-OPEN on any problem.
async function overLimit(ip) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return false;
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `rl:og:${ip}:${bucket}`;
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify([['INCR', key], ['EXPIRE', key, 120]]),
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return false;
    const out = await r.json();
    const count = Number(out?.[0]?.result);
    return Number.isFinite(count) && count > OG_IMAGE.perIpPerMinute;
  } catch {
    return false;
  }
}

function clientIp(req) {
  const real = req.headers.get('x-real-ip');
  if (real && real.trim()) return real.trim();
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) { const last = fwd.split(',').map((x) => x.trim()).filter(Boolean).pop(); if (last) return last; }
  return 'unknown';
}

export default async function handler(req) {
  if (await overLimit(clientIp(req))) {
    return new Response('Too many requests', { status: 429, headers: { 'Retry-After': '60' } });
  }

  const { searchParams } = new URL(req.url);
  // Only the invitee's first name (capped) and a two-value language reach the card.
  const name = (searchParams.get('name') || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 40);
  const isHe = (searchParams.get('lang') || 'he') !== 'en';

  const rawHeadline = isHe
    ? (name ? `הוזמנת על ידי ${name}` : 'קיבלת הזמנה מיוחדת')
    : (name ? `${name} invited you` : "You're invited");
  const rawSub = isHe ? 'לככב בפוסטר קולנועי משלך' : 'Star in your own movie poster';
  const rawChip = isHe ? 'פוסטר Star-Yourself חינם מחכה לך' : 'A free Star-Yourself poster awaits';

  const headline = isHe ? reshapeHebrew(rawHeadline) : rawHeadline;
  const sub      = isHe ? reshapeHebrew(rawSub)      : rawSub;
  const chip     = isHe ? reshapeHebrew(rawChip)     : rawChip;

  const [fonts, logo] = await Promise.all([loadFonts(), loadLogo()]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#030712',
          backgroundImage: 'radial-gradient(circle at 50% 34%, rgba(212,163,115,0.18), rgba(3,7,18,0) 62%)',
          fontFamily: 'Heebo',
          padding: '72px',
        }}
      >
        {/* Top accent line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '8px', backgroundColor: '#d4a373' }} />

        {/* Brand lockup: logo + wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 44 }}>
          {logo ? (
            <img src={logo} width={72} height={72} style={{ borderRadius: 18, marginRight: 22 }} />
          ) : null}
          <div style={{ display: 'flex', fontSize: 34, letterSpacing: 12, color: '#ffffff', fontWeight: 700 }}>
            LIFESCRIPT
          </div>
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', textAlign: 'center', fontSize: 72, color: '#ffffff', fontWeight: 700, lineHeight: 1.1, maxWidth: 1000 }}>
          {headline}
        </div>

        {/* Sub-headline */}
        <div style={{ display: 'flex', textAlign: 'center', fontSize: 40, color: 'rgba(255,255,255,0.62)', fontWeight: 700, marginTop: 22, maxWidth: 940 }}>
          {sub}
        </div>

        {/* Gift chip */}
        <div
          style={{
            display: 'flex',
            marginTop: 50,
            padding: '14px 32px',
            borderRadius: 999,
            border: '2px solid rgba(212,163,115,0.42)',
            backgroundColor: 'rgba(212,163,115,0.12)',
            color: '#d4a373',
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          {chip}
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts,
      headers: { 'cache-control': 'public, max-age=86400, s-maxage=86400, immutable' },
    },
  );
}
