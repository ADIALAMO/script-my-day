import { ImageResponse } from 'next/og';

export const config = { runtime: 'edge' };

// Heebo (the app's font) covers Hebrew AND Latin only via separate subset files, so we load
// both and hand them to satori under one family — it falls back across them per-glyph. Loading
// a Hebrew-capable font is MANDATORY: without it, satori renders Hebrew as empty boxes.
const FONT_URLS = [
  'https://cdn.jsdelivr.net/npm/@fontsource/heebo/files/heebo-hebrew-700-normal.woff',
  'https://cdn.jsdelivr.net/npm/@fontsource/heebo/files/heebo-latin-700-normal.woff',
];

async function loadFonts() {
  const fonts = [];
  for (const url of FONT_URLS) {
    try {
      const res = await fetch(url);
      if (res.ok) fonts.push({ name: 'Heebo', data: await res.arrayBuffer(), weight: 700, style: 'normal' });
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

async function loadLogo(origin) {
  try {
    const res = await fetch(`${origin}/icon.png`);
    if (!res.ok) return null;
    return `data:image/png;base64,${bufToBase64(await res.arrayBuffer())}`;
  } catch {
    return null;
  }
}

export default async function handler(req) {
  const { searchParams, origin } = new URL(req.url);
  const name = (searchParams.get('name') || '').slice(0, 40);
  const isHe = (searchParams.get('lang') || 'he') !== 'en';

  const rawHeadline = isHe
    ? (name ? `הוזמנת על ידי ${name}` : 'קיבלת הזמנה מיוחדת')
    : (name ? `${name} invited you` : "You're invited");
  const rawSub = isHe ? 'לככב בפוסטר קולנועי משלך' : 'Star in your own movie poster';
  const rawChip = isHe ? 'פוסטר Star-Yourself חינם מחכה לך' : 'A free Star-Yourself poster awaits';

  const headline = isHe ? reshapeHebrew(rawHeadline) : rawHeadline;
  const sub      = isHe ? reshapeHebrew(rawSub)      : rawSub;
  const chip     = isHe ? reshapeHebrew(rawChip)     : rawChip;

  const [fonts, logo] = await Promise.all([loadFonts(), loadLogo(origin)]);

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
