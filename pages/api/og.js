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

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const name = (searchParams.get('name') || '').slice(0, 40);
  const isHe = (searchParams.get('lang') || 'he') !== 'en';

  const headline = isHe
    ? (name ? `הוזמנת על ידי ${name}` : 'הוזמנת ל-LIFESCRIPT')
    : (name ? `${name} invited you` : "You're invited");
  const sub = isHe ? 'לככב בפוסטר קולנועי משלך' : 'Star in your own movie poster';

  const fonts = await loadFonts();

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
          backgroundImage: 'radial-gradient(circle at 50% 38%, rgba(212,163,115,0.16), rgba(3,7,18,0) 60%)',
          direction: isHe ? 'rtl' : 'ltr',
          fontFamily: 'Heebo',
          padding: '80px',
        }}
      >
        {/* Top accent line */}
        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '8px', backgroundColor: '#d4a373' }} />

        {/* Brand eyebrow */}
        <div style={{ display: 'flex', fontSize: 26, letterSpacing: 14, color: 'rgba(212,163,115,0.75)', fontWeight: 700, marginBottom: 28 }}>
          LIFESCRIPT
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', textAlign: 'center', fontSize: 72, color: '#ffffff', fontWeight: 700, lineHeight: 1.1, maxWidth: 960 }}>
          {headline}
        </div>

        {/* Sub-headline */}
        <div style={{ display: 'flex', textAlign: 'center', fontSize: 40, color: 'rgba(255,255,255,0.62)', fontWeight: 700, marginTop: 24, maxWidth: 900 }}>
          {sub}
        </div>

        {/* Gift chip */}
        <div
          style={{
            display: 'flex',
            marginTop: 52,
            padding: '14px 30px',
            borderRadius: 999,
            border: '2px solid rgba(212,163,115,0.4)',
            backgroundColor: 'rgba(212,163,115,0.1)',
            color: '#d4a373',
            fontSize: 28,
            fontWeight: 700,
          }}
        >
          {isHe ? 'פוסטר Star-Yourself חינם מחכה לך' : 'A free Star-Yourself poster awaits'}
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
