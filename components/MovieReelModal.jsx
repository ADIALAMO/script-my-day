import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Share2, Download, Loader2, AlertCircle, Video, VolumeX, Volume2 } from 'lucide-react';
import { track } from '@vercel/analytics';
import { shareReadyFile, makeShareFile, exportCapabilities } from '../utils/export-image.js';
import { reelBreadcrumb } from '../utils/reel-diagnostics.js'; // TEMP DIAGNOSTIC (reel-crash)

// ── Canvas dimensions ────────────────────────────────────────────────────────
const CANVAS_W      = 720;
const CANVAS_H      = 1280;
const FPS           = 30;
const MS_PER_FRAME  = Math.round(1000 / FPS);
const PANEL_SECS    = 3;
const END_CARD_SECS = 4;
const FADE_FRAMES   = 12;                     // 0.4 s crossfade at each panel edge
const PANEL_FRAMES  = FPS * PANEL_SECS;       // 90
const END_FRAMES    = FPS * END_CARD_SECS;    // 120
const BRAND_GOLD    = '#d4a373';

// Preview canvas — 9:16 at 180 wide (fits all mobile viewports without scrolling)
const PREVIEW_W = 180;
const PREVIEW_H = Math.round(PREVIEW_W * CANVAS_H / CANVAS_W); // 320

// ── Low-end device tier ─────────────────────────────────────────────────────
// TEMP DIAGNOSTIC (reel-crash) investigation surfaced the root cause: a Galaxy
// Note 8 (Android 9, deviceMemory 4GB) recorded a recovered-after-kill trail
// ending cleanly at recorder-start (mimeType=video/mp4) with a tiny JS heap
// (12/1136MB) — the process dies natively, in the hardware H.264 encoder/GPU
// path, not in JS. 'high' is byte-for-byte today's existing behavior (full
// 720x1280 canvas, 30fps, browser-default bitrate, mp4-first mimeType order) —
// every high-tier code path below is untouched. 'low' composites at the SAME
// full 720x1280 resolution (none of the drawing helpers below are
// resolution-agnostic — they mix CANVAS_W/H ratios with absolute pixel offsets
// tuned for 720x1280, e.g. end-card text baselines — rewriting them to be
// resolution-independent would be a much larger, riskier change for the same
// goal) and only downscales the FINAL captured/encoded stream into a second,
// smaller offscreen canvas. 576x1024 (not 540x960): hardware H.264 encoders
// are commonly picky about dimensions that aren't multiples of 16; 576 and
// 1024 both are, 540 isn't.
const LOW_TIER = {
  key: 'low',
  canvasW: 576,
  canvasH: 1024,
  fps: 24,
  videoBitsPerSecond: 2_000_000,
  // vp8 first: the software VP8 encoder avoids the hardware H.264 path
  // entirely on this tier — slower per-frame, but doesn't compete for the
  // same limited encoder/GPU resource suspected of killing the process.
  mimeTypeCandidates: [
    'video/webm;codecs=vp8,opus',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm',
  ],
};
const HIGH_TIER = {
  key: 'high',
  canvasW: CANVAS_W,
  canvasH: CANVAS_H,
  fps: FPS,
  videoBitsPerSecond: undefined, // unset — browser/OS default, exactly as today
  mimeTypeCandidates: [
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ],
};

// navigator.deviceMemory is the primary signal (already confirmed reliable on
// the actual device this investigation is about: reported 4). Fallback, only
// when deviceMemory is unavailable: parse the Android major version already
// present in navigator.userAgent (no new native dependency/plugin needed —
// @capacitor/device isn't installed, and adding it would mean a new AAB cycle
// for this alone). Chrome is known to freeze/reduce the OS version reported in
// the UA string on some builds going forward, so this fallback is strictly
// best-effort, not authoritative. ?reelTier=low|high always wins, for testing
// on any device without needing the real hardware.
function resolveReelTier() {
  if (typeof window === 'undefined') return HIGH_TIER;
  try {
    const override = new URLSearchParams(window.location.search).get('reelTier');
    if (override === 'low') return LOW_TIER;
    if (override === 'high') return HIGH_TIER;
  } catch { /* malformed query string — fall through to device detection */ }

  const mem = typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined;
  if (typeof mem === 'number') return mem <= 4 ? LOW_TIER : HIGH_TIER;

  try {
    const m = /Android (\d+)/.exec((typeof navigator !== 'undefined' && navigator.userAgent) || '');
    if (m && parseInt(m[1], 10) <= 9) return LOW_TIER;
  } catch { /* best-effort only */ }

  return HIGH_TIER;
}

// ── Director configuration ───────────────────────────────────────────────────

// comedy/horror point at trimmed (≤30s, loop=true anyway makes the longer
// originals pointless to decode in full), loudness-matched copies in
// /audio/reel/ — see utils/reel-diagnostics.js's audio-decoded breadcrumb
// for the measured effect (decodeAudioData's full-file PCM decode was ~30MB
// for comedy and ~133MB for horror's uncompensated 6ch source; both land at
// the same ~11MB now). drama/action were already short, already stereo, and
// gain nothing from a copy — they keep using the shared /audio/*_bg.m4a
// files the background-music hook (useBackgroundAudio.js) also uses; do NOT
// repoint those two, and do NOT touch useBackgroundAudio — it must keep
// reading the originals regardless of what the reel does.
const SOUNDTRACKS = [
  { key: 'drama',   emoji: '🎭', label: 'Hollywood Drama',       labelHe: 'דרמה הוליוודית',       file: '/audio/drama_bg.m4a'   },
  { key: 'action',  emoji: '🏎️', label: 'Adrenaline Rush',       labelHe: 'אדרנלין מוחלט',        file: '/audio/action_bg.m4a'  },
  { key: 'comedy',  emoji: '🍿', label: 'Sitcom Energy',         labelHe: 'אנרגיית סיטקום',       file: '/audio/reel/comedy_bg.m4a' },
  { key: 'horror',  emoji: '👁️', label: 'Psychological Thriller', labelHe: 'מתח פסיכולוגי',       file: '/audio/reel/horror_bg.m4a' },
];

const VISUAL_GRADES = [
  { key: 'original', emoji: '🎬', label: 'Raw / Original', labelHe: 'מקורי',           filter: 'none'                                             },
  { key: 'noir',     emoji: '🎞️', label: 'Classic Noir',   labelHe: 'נואר קלאסי',      filter: 'grayscale(100%) contrast(120%)'                   },
  { key: 'vintage',  emoji: '🌾', label: 'Vintage Indie',  labelHe: 'אינדי וינטג\'',   filter: 'sepia(38%) saturate(130%) contrast(110%)'         },
  { key: 'cyberpunk',emoji: '🌌', label: 'Cyberpunk Neon', labelHe: 'ניאון סייברפאנק', filter: 'saturate(185%) hue-rotate(20deg) contrast(112%)' },
];

// Map genre prop to closest soundtrack default.
const GENRE_SOUNDTRACK_MAP = {
  drama: 'drama', action: 'action', comedy: 'comedy',
  horror: 'horror', romance: 'drama', 'sci-fi': 'action',
};

// ── Pure canvas helpers ──────────────────────────────────────────────────────

function loadImg(src) {
  return new Promise((resolve, reject) => {
    if (!src) return reject(new Error('no src'));
    // R2/CDN URLs are cross-origin and lack CORS headers on the r2.dev subdomain.
    // Routing them through /api/proxy-image makes them same-origin, so the canvas
    // never becomes tainted and captureStream() records real video frames.
    // Data URIs and relative paths are already same-origin — no rewrite needed.
    const imgSrc = src.startsWith('http')
      ? `/api/proxy-image?url=${encodeURIComponent(src)}`
      : src;
    const img = new Image();
    img.onload  = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = imgSrc;
  });
}

// TEMP DIAGNOSTIC (reel-crash) — low-tier-only panel decode. Downscales AT DECODE
// TIME via createImageBitmap so the full-resolution source pixels are never held in
// memory — paired with the progressive one-panel-at-a-time loop in generate(), only
// ONE panel's bitmap is ever alive at once on this tier, instead of all 7 for the
// whole recording. Caps the LONGER side at LOW_TIER_MAX_DIM, preserving the source's
// native aspect ratio and never upscaling: createImageBitmap's resize STRETCHES to
// exactly the given width+height when BOTH are specified, ignoring the source's own
// ratio — distorting any source that isn't already a perfect match (these AI-generated
// panels aren't guaranteed to be 9:16). Decoding once at native size first to read the
// real dimensions, then resizing a second time only if needed, avoids that distortion
// and avoids ever upscaling a source already smaller than the cap. Returns an
// ImageBitmap (caller must call .close() once done with it), or falls back to the same
// plain <img> path the high tier uses if createImageBitmap is unsupported or anything
// here throws — so a decode failure degrades the same way on both tiers, not a crash.
const LOW_TIER_MAX_DIM = 1280; // matches CANVAS_H — compositing still happens at full 720x1280
async function loadPanelImageLowTier(url) {
  try {
    const src = url.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(url)}` : url;
    const resp = await fetch(src);
    if (!resp.ok) throw new Error(`fetch ${resp.status}`);
    const blob = await resp.blob();
    const full = await createImageBitmap(blob);
    if (full.width <= LOW_TIER_MAX_DIM && full.height <= LOW_TIER_MAX_DIM) return full;
    const scale = LOW_TIER_MAX_DIM / Math.max(full.width, full.height);
    const resized = await createImageBitmap(full, {
      resizeWidth:  Math.round(full.width * scale),
      resizeHeight: Math.round(full.height * scale),
      resizeQuality: 'medium',
    });
    full.close();
    return resized;
  } catch {
    return loadImg(url).catch(() => null); // same plain-<img> fallback the high tier uses
  }
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Break `text` into wrapped lines no wider than `maxW` at current ctx font. */
function computeLines(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(test).width > maxW && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Draw centred multi-line text (each line below the previous). */
function drawCentredText(ctx, text, cx, startY, maxW, lineH) {
  computeLines(ctx, text, maxW).forEach((l, i) => ctx.fillText(l, cx, startY + i * lineH));
}

/** Rounded-rect path (compatible back to iOS 14). */
function drawRoundRect(ctx, x, y, w, h, r) {
  const R = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + R, y);
  ctx.lineTo(x + w - R, y);
  ctx.arcTo(x + w, y, x + w, y + R, R);
  ctx.lineTo(x + w, y + h - R);
  ctx.arcTo(x + w, y + h, x + w - R, y + h, R);
  ctx.lineTo(x + R, y + h);
  ctx.arcTo(x, y + h, x, y + h - R, R);
  ctx.lineTo(x, y + R);
  ctx.arcTo(x, y, x + R, y, R);
  ctx.closePath();
}

/** Ken Burns: alternating zoom direction + lateral drift per panel. */
function applyKenBurns(ctx, img, panelIdx, t) {
  const zoomIn = panelIdx % 2 === 0;
  const scale  = zoomIn ? 1 + 0.08 * t : 1.08 - 0.08 * t;
  const dir    = panelIdx % 2 === 0 ? 1 : -1;
  const panX   = dir * 0.025 * t * CANVAS_W;

  ctx.save();
  ctx.translate(CANVAS_W / 2 + panX, CANVAS_H / 2);
  ctx.scale(scale, scale);

  // naturalWidth/Height (HTMLImageElement) vs width/height (ImageBitmap, used
  // by the low-tier progressive decode path) — supports both source types.
  const srcW    = img.naturalWidth ?? img.width;
  const srcH    = img.naturalHeight ?? img.height;
  const imgR    = srcW / srcH;
  const canvasR = CANVAS_W / CANVAS_H;
  const drawW   = imgR > canvasR ? (CANVAS_H / scale) * imgR : CANVAS_W / scale;
  const drawH   = imgR > canvasR ? CANVAS_H / scale           : (CANVAS_W / scale) / imgR;

  ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

/** Top + bottom vignettes for cinematic depth. */
function drawVignettes(ctx) {
  const top = ctx.createLinearGradient(0, 0, 0, CANVAS_H * 0.45);
  top.addColorStop(0, 'rgba(0,0,0,0.72)');
  top.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = top;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H * 0.45);

  const bot = ctx.createLinearGradient(0, CANVAS_H * 0.55, 0, CANVAS_H);
  bot.addColorStop(0, 'rgba(0,0,0,0)');
  bot.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = bot;
  ctx.fillRect(0, CANVAS_H * 0.55, CANVAS_W, CANVAS_H * 0.45);
}

/**
 * Panel badge, scene heading, and dialogue caption — all with legibility mattes.
 * Every text element sits on a dark rounded-rect matte so it reads on any background.
 */
function drawPanelText(ctx, panel, panelIdx) {
  ctx.save();
  ctx.textAlign = 'center';

  // ── 1. PANEL badge (top-centre) ──────────────────────────────────────────
  const badgeText = `PANEL ${String(panelIdx + 1).padStart(2, '0')}`;
  ctx.font = 'bold 29px system-ui, sans-serif';
  const badgeInnerW = ctx.measureText(badgeText).width;
  const badgePadH = 20;  const badgePadV = 12;
  const badgeW = badgeInnerW + badgePadH * 2;
  const badgeH = 29 + badgePadV * 2 - 6;    // ~53px
  const badgeX = CANVAS_W / 2 - badgeW / 2;
  const badgeY = 46;

  ctx.fillStyle = 'rgba(3,7,18,0.74)';
  drawRoundRect(ctx, badgeX, badgeY, badgeW, badgeH, 24);
  ctx.fill();

  ctx.fillStyle = BRAND_GOLD;
  ctx.fillText(badgeText, CANVAS_W / 2, badgeY + badgeH - badgePadV - 2);

  // ── 2. Scene heading ─────────────────────────────────────────────────────
  if (panel.scene) {
    const sceneMaxW = CANVAS_W - 100;
    ctx.font = '21px system-ui, sans-serif';
    const sceneLines = computeLines(ctx, panel.scene, sceneMaxW);
    const sceneLineH = 26;
    const scenePadH = 18; const scenePadV = 9;
    const sceneBlockH = sceneLines.length * sceneLineH;
    const sceneX0 = badgeY + badgeH + 6;

    ctx.fillStyle = 'rgba(3,7,18,0.55)';
    drawRoundRect(ctx,
      40, sceneX0,
      CANVAS_W - 80, sceneBlockH + scenePadV * 2,
      10
    );
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    sceneLines.forEach((l, i) =>
      ctx.fillText(l, CANVAS_W / 2, sceneX0 + scenePadV + 18 + i * sceneLineH)
    );
  }

  // ── 3. Dialogue caption (bottom) with matte ───────────────────────────────
  if (panel.dialogue) {
    const quote   = `"${panel.dialogue}"`;
    const diagMaxW = CANVAS_W - 100;
    const lineH   = 48;
    ctx.font = "italic 36px 'Courier Prime','Courier New',monospace";

    const lines = computeLines(ctx, quote, diagMaxW);

    // Matte geometry — sits flush with canvas safe zone, padded vertically
    const padV    = 22;
    const padH    = 30;
    const firstBase   = CANVAS_H - 195;                     // baseline of line 0
    const lastBase    = firstBase + (lines.length - 1) * lineH;
    const matteTop    = firstBase - 34 - padV;              // ~34 = cap-height for 36px
    const matteBot    = lastBase + 10 + padV;               // ~10 = descender clearance
    const matteH      = matteBot - matteTop;
    const matteX      = 30;
    const matteW      = CANVAS_W - 60;

    ctx.fillStyle = 'rgba(3,7,18,0.82)';
    drawRoundRect(ctx, matteX, matteTop, matteW, matteH, 18);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    lines.forEach((l, i) => ctx.fillText(l, CANVAS_W / 2, firstBase + i * lineH));
  }

  ctx.textAlign = 'left';
  ctx.restore();
}

/** Small LIFESCRIPT watermark — top-right, always legible. */
function drawWatermark(ctx) {
  ctx.save();
  ctx.textAlign = 'right';
  // Pill background
  const txt = 'LIFESCRIPT';
  ctx.font = 'bold 18px system-ui, sans-serif';
  const tw = ctx.measureText(txt).width;
  ctx.fillStyle = 'rgba(3,7,18,0.55)';
  drawRoundRect(ctx, CANVAS_W - tw - 52, 33, tw + 24, 30, 15);
  ctx.fill();
  ctx.fillStyle = 'rgba(212,163,115,0.65)';
  ctx.fillText(txt, CANVAS_W - 34, 54);
  ctx.textAlign = 'left';
  ctx.restore();
}

/**
 * Cinematic end card.
 * t: 0 → 1 over the full end-card duration; drives the fade-in.
 */
function drawEndCard(ctx, producerName, logoImg, t) {
  const alpha = Math.min(1, t * 2.8);

  ctx.fillStyle = '#030712';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  const glow = ctx.createRadialGradient(CANVAS_W / 2, CANVAS_H / 2, 60, CANVAS_W / 2, CANVAS_H / 2, 480);
  glow.addColorStop(0, 'rgba(212,163,115,0.14)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  ctx.globalAlpha = alpha;
  ctx.textAlign   = 'center';

  if (logoImg) {
    const sz = 96;
    ctx.drawImage(logoImg, CANVAS_W / 2 - sz / 2, CANVAS_H / 2 - 232, sz, sz);
  }

  ctx.font      = '700 26px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(212,163,115,0.60)';
  ctx.fillText('A FILM GENERATED BY', CANVAS_W / 2, CANVAS_H / 2 - 55);

  const name = (producerName || 'GUEST').toUpperCase();
  ctx.font = '900 60px system-ui, sans-serif';
  const nameW = ctx.measureText(name).width;
  if (nameW > CANVAS_W - 80) {
    ctx.font = `900 ${Math.floor(60 * (CANVAS_W - 80) / nameW)}px system-ui, sans-serif`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, CANVAS_W / 2, CANVAS_H / 2 + 22);

  ctx.globalAlpha = alpha * 0.35;
  ctx.fillStyle   = BRAND_GOLD;
  ctx.fillRect(CANVAS_W / 2 - 90, CANVAS_H / 2 + 58, 180, 1.5);
  ctx.globalAlpha = alpha;

  ctx.font      = 'bold 21px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(212,163,115,0.88)';
  ctx.fillText('LIFESCRIPT STUDIO', CANVAS_W / 2, CANVAS_H / 2 + 100);

  ctx.font      = '18px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillText('my-life-script.vercel.app', CANVAS_W / 2, CANVAS_H / 2 + 142);

  ctx.globalAlpha = 1;
  ctx.textAlign   = 'left';
}

// ── Component ────────────────────────────────────────────────────────────────

export default function MovieReelModal({
  isOpen, onClose,
  panels, panelImages,
  lang, genre, producerName,
  posterUrl, comicSource, comicCompletedAtRef, // TEMP DIAGNOSTIC (reel-crash)
}) {
  const isHebrew = lang === 'he';
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => { setIsDesktop(exportCapabilities().isDesktop); }, []);

  // ── Director settings ───────────────────────────────────────────────────
  const defaultSoundtrack = GENRE_SOUNDTRACK_MAP[genre] || 'drama';
  const [soundtrack,   setSoundtrack]   = useState(defaultSoundtrack);
  const [visualGrade,  setVisualGrade]  = useState('original');

  // Reset director settings when modal opens with a new genre.
  useEffect(() => {
    if (isOpen) setSoundtrack(GENRE_SOUNDTRACK_MAP[genre] || 'drama');
  }, [isOpen, genre]);

  // ── Generation state ────────────────────────────────────────────────────
  const [phase,        setPhase]        = useState('idle'); // 'idle'|'generating'|'done'|'error'
  const [progress,     setProgress]     = useState(0);
  const [videoUrl,     setVideoUrl]     = useState(null);
  const [errorMsg,     setErrorMsg]     = useState('');
  const [label,        setLabel]        = useState('');
  // Video preview starts muted so autoPlay always works (browser policy).
  // User can unmute with one tap via the overlay button.
  const [isVideoMuted, setIsVideoMuted] = useState(true);

  const canvasRef    = useRef(null);   // hidden 720×1280 render target
  const previewRef   = useRef(null);   // visible small preview canvas
  const videoRef     = useRef(null);
  const recorderRef  = useRef(null);
  const chunksRef    = useRef([]);
  const videoBlobRef = useRef(null);   // the real MediaRecorder Blob — see prewarmReel
  const cancelledRef = useRef(false);

  // ── Body scroll lock — prevent background page from scrolling ────────────
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // ── Background music duck — mute genre track while modal is open ──────────
  // Restores saved volume on close; prevents music bleeding under the reel video.
  useEffect(() => {
    if (!isOpen) return;
    const bgMusic = typeof document !== 'undefined'
      ? document.getElementById('main-bg-music')
      : null;
    if (!bgMusic) return;
    const savedVol = bgMusic.volume;
    bgMusic.volume = 0;
    return () => { bgMusic.volume = savedVol; };
  }, [isOpen]);

  // ── Cleanup on close ────────────────────────────────────────────────────
  // This component stays mounted for the whole session (ScriptOutput renders it
  // unconditionally; isOpen only toggles visibility), so refs are NOT reclaimed
  // just because the modal closes. Without explicitly clearing them here, a
  // finished reel's video Blob (10-30 MB) stayed pinned in videoBlobRef/chunksRef/
  // shareFileRef for the rest of the session the moment the user closed the modal
  // normally (the X/backdrop) instead of tapping "Generate New Reel" — the only
  // other place that cleared them. A second reel generated later in the same
  // session would then build on top of that leaked memory instead of starting
  // clean. Confirmed in code; not what caused the specific crash this was found
  // while investigating (that crash was on a session's first reel, before any
  // blob could have leaked), but a real hazard for any later reel in a session.
  useEffect(() => {
    if (!isOpen) {
      // TEMP DIAGNOSTIC (reel-crash) — closing mid-render is a normal user cancel,
      // not a crash; mark it explicitly so an orphaned trail on next launch means
      // an actual hard kill, not every ordinary "closed the modal while it was
      // still generating" case.
      if (phase === 'generating') reelBreadcrumb('reel-cancelled', {});
      cancelledRef.current = true;
      try { recorderRef.current?.stop(); } catch {}
      setPhase('idle');
      setProgress(0);
      setLabel('');
      setErrorMsg('');
      if (videoUrl) { URL.revokeObjectURL(videoUrl); setVideoUrl(null); }
      shareFileRef.current = { url: null, file: null };
      prewarmRef.current = null;
      chunksRef.current = [];
      videoBlobRef.current = null;
    } else {
      cancelledRef.current = false;
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  // Reset video mute state each time a new reel is ready.
  useEffect(() => {
    if (phase === 'done') setIsVideoMuted(true);
  }, [phase]);

  // ── Panels with loaded images ───────────────────────────────────────────
  const usablePanelData = useMemo(
    () => panels
      .map((p, i) => ({ panel: p, idx: i, url: panelImages[i]?.url }))
      .filter(item => !!item.url),
    [panels, panelImages]
  );
  const readyCount = usablePanelData.length;
  const totalCount = panels.length;

  // TEMP DIAGNOSTIC (reel-crash) — snapshot of what's actually held in memory
  // the moment the modal opens: a data: URI census (poster + any panel still
  // mid-swap from its own data URI to a CDN url) and any stale blob left over
  // from a previous reel in this session (should be ~0 after the leak fix).
  useEffect(() => {
    if (!isOpen) return;
    let dataUriCount = 0;
    let dataUriTotalBytes = 0;
    if (typeof posterUrl === 'string' && posterUrl.startsWith('data:')) {
      dataUriCount++; dataUriTotalBytes += posterUrl.length;
    }
    Object.values(panelImages || {}).forEach((p) => {
      if (p?.url && typeof p.url === 'string' && p.url.startsWith('data:')) {
        dataUriCount++; dataUriTotalBytes += p.url.length;
      }
    });
    reelBreadcrumb('mount', {
      genre,
      panelCount: totalCount,
      readyCount,
      comicSource: comicSource || 'unknown',
      msSinceComicFinished: comicCompletedAtRef?.current ? (Date.now() - comicCompletedAtRef.current) : null,
      dataUriCount,
      dataUriTotalBytes,
      staleBlobSize: videoBlobRef.current?.size || 0,
    });
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Main generation pipeline ────────────────────────────────────────────
  const generate = useCallback(async () => {
    if (readyCount === 0) {
      setErrorMsg(isHebrew ? 'אין תמונות פאנל זמינות.' : 'No panel images available.');
      setPhase('error');
      return;
    }

    const tier = resolveReelTier(); // TEMP DIAGNOSTIC (reel-crash) — low-end-device investigation
    const isLow = tier.key === 'low';
    // Derived TOGETHER from tier.fps so wall-clock duration (and therefore audio
    // sync, since audio plays on its own independent real-time clock regardless
    // of frame count) is identical across tiers — only frame COUNT changes, never
    // PANEL_SECS/END_CARD_SECS. High tier: fps=30 → byte-identical to the former
    // module-level FPS/MS_PER_FRAME/PANEL_FRAMES/END_FRAMES constants.
    const fps         = tier.fps;
    const msPerFrame  = Math.round(1000 / fps);
    const panelFrames = fps * PANEL_SECS;
    const endFrames   = fps * END_CARD_SECS;

    setPhase('generating');
    setProgress(0);
    cancelledRef.current = false;
    chunksRef.current    = [];
    reelBreadcrumb('generate-start', { readyCount, tier: tier.key }); // TEMP DIAGNOSTIC (reel-crash)

    // Create AudioContext synchronously while still in the user-gesture call stack.
    // Browsers require this for autoplay policy compliance — creating it after any
    // `await` loses the gesture context and leaves the context in 'suspended' state.
    let audioCtx = null;
    try {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtx.resume().catch(() => {});
    } catch {
      audioCtx = null;
    }

    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');

    // Low tier only: compositing still happens on the full 720x1280 `canvas` above
    // (none of applyKenBurns/drawVignettes/drawPanelText/drawWatermark/drawEndCard
    // are resolution-agnostic — rewriting all five to be was a larger, riskier
    // change for the same goal) — this second, smaller canvas is what actually gets
    // captured/encoded, fed one proportional downscale draw per frame. High tier
    // never allocates this at all; captures directly from the full-res canvas, same
    // as before.
    const captureCanvas = isLow ? document.createElement('canvas') : canvas;
    if (isLow) {
      captureCanvas.width  = tier.canvasW;
      captureCanvas.height = tier.canvasH;
    }
    const captureCtx = isLow ? captureCanvas.getContext('2d') : null;

    // Resolve selected grade filter.
    const gradeFilter = VISUAL_GRADES.find(g => g.key === visualGrade)?.filter || 'none';
    const filterSupported = 'filter' in ctx;

    let frameCount = 0;
    const totalFrames = usablePanelData.length * panelFrames + endFrames;
    let heartbeatInterval = null; // TEMP DIAGNOSTIC (reel-crash) — cleared in the finally below
    let lowTierPrefetch = null; // low tier only — { idx, promise } for the next panel's bitmap; closed in the finally below if never consumed

    const advance = async () => {
      // Low tier: copy the just-composited full-res frame down into the smaller
      // capture canvas actually being recorded. High tier: no-op, captures the
      // full-res canvas directly, unchanged.
      if (isLow) captureCtx.drawImage(canvas, 0, 0, tier.canvasW, tier.canvasH);

      // Mirror to preview every 6 frames (~5 fps refresh rate) — always from the
      // full-res canvas regardless of tier, cheap either way (PREVIEW_W/H are tiny).
      if (frameCount % 6 === 0 && previewRef.current) {
        const pCtx = previewRef.current.getContext('2d');
        pCtx.drawImage(canvas, 0, 0, PREVIEW_W, PREVIEW_H);
      }
      frameCount++;
      setProgress(Math.min(99, Math.round((frameCount / totalFrames) * 100)));
      // TEMP DIAGNOSTIC (reel-crash) — the heartbeat below replaces this on the low
      // tier (same information, on a wall-clock timer that keeps reporting even if
      // the render loop itself stalls, which a frame-count-gated crumb cannot).
      if (!isLow && frameCount % 60 === 0) reelBreadcrumb('frame', { frameCount, totalFrames });
      await sleep(msPerFrame);
    };

    try {
      // 1. Load resources ──────────────────────────────────────────────────
      // High tier: unchanged — decode all panels + the logo upfront via Promise.all.
      // Low tier: only the logo is decoded upfront (small, needed much later for the
      // end card anyway); panel images decode ONE AT A TIME inside the render loop
      // below (step 4) so only ever one panel's bitmap is held in memory at once,
      // instead of all 7 simultaneously for the whole ~25s recording.
      setLabel(isHebrew ? 'טוען תמונות...' : 'Loading images...');
      const decodeStart = Date.now(); // TEMP DIAGNOSTIC (reel-crash)

      let validItems = [];
      let validImgs  = [];
      let logoImg    = null;

      if (!isLow) {
        const [panelImgs, logo] = await Promise.all([
          Promise.all(usablePanelData.map(d => loadImg(d.url).catch(() => null))),
          loadImg('/icon.png').catch(() => null),
        ]);
        logoImg = logo;
        if (cancelledRef.current) return;

        validItems = usablePanelData.filter((_, i) => panelImgs[i] !== null);
        validImgs  = panelImgs.filter(Boolean);
        reelBreadcrumb('panels-decoded', { // TEMP DIAGNOSTIC (reel-crash)
          attempted: usablePanelData.length,
          decoded: validImgs.length,
          ms: Date.now() - decodeStart,
        });
        if (validItems.length === 0) throw new Error('All panel images failed to decode.');
      } else {
        logoImg = await loadImg('/icon.png').catch(() => null);
        if (cancelledRef.current) return;
        // Decoded count/ms are only known once the panel loop (step 4) finishes on
        // this tier — the panels-decoded crumb fires there instead, same shape.
      }

      // 2. Audio (fail-open) ───────────────────────────────────────────────
      let audioDest = null; let audioSrc = null;
      const audioStart = Date.now(); // TEMP DIAGNOSTIC (reel-crash)
      let decodedBuf = null; // TEMP DIAGNOSTIC (reel-crash) — decodeAudioData's AudioBuffer, for sizing below
      try {
        if (audioCtx) {
          audioDest = audioCtx.createMediaStreamDestination();

          const audioFile = SOUNDTRACKS.find(s => s.key === soundtrack)?.file
            || '/audio/drama_bg.m4a';

          const resp = await fetch(audioFile);
          if (resp.ok) {
            const buf  = await audioCtx.decodeAudioData(await resp.arrayBuffer());
            decodedBuf = buf; // TEMP DIAGNOSTIC (reel-crash)
            const gain = audioCtx.createGain();
            gain.gain.value = 0.45;
            audioSrc = audioCtx.createBufferSource();
            audioSrc.buffer = buf;
            audioSrc.loop   = true;
            audioSrc.connect(gain);
            gain.connect(audioDest);
            audioSrc.start();
          }
        }
      } catch {
        audioCtx = null; audioDest = null;
      }
      // TEMP DIAGNOSTIC (reel-crash) — decodeAudioData decodes the WHOLE file to raw
      // Float32 PCM regardless of how much of it the ~25s reel actually plays, and
      // regardless of the source file's own channel count (a 5.1/6ch source stays
      // 6ch decoded, not downmixed). bytes = length(frames) * channels * 4 — this is
      // genre-dependent: comedy_bg.m4a (85.8s, 2ch) decodes to ~30MB; horror_bg.m4a
      // (115s, 6ch/48kHz) decodes to ~133MB, over 4x comedy despite a SMALLER file on
      // disk (1.87MB vs 2.84MB) — channel count and duration matter far more than
      // on-disk size. See also the separate (not yet actioned) item on caching/
      // re-encoding these files.
      reelBreadcrumb('audio-decoded', {
        ok: !!audioCtx,
        ms: Date.now() - audioStart,
        genre,
        duration: decodedBuf?.duration ?? null,
        numberOfChannels: decodedBuf?.numberOfChannels ?? null,
        length: decodedBuf?.length ?? null,
        decodedBytes: decodedBuf ? decodedBuf.length * decodedBuf.numberOfChannels * 4 : null,
      }); // TEMP DIAGNOSTIC (reel-crash)

      if (cancelledRef.current) { try { audioCtx?.close(); } catch {} return; }

      // 3. MediaRecorder ───────────────────────────────────────────────────
      await document.fonts.ready;

      const mimeType = tier.mimeTypeCandidates
        .find(m => { try { return MediaRecorder.isTypeSupported(m); } catch { return false; } }) || '';

      const videoStream    = captureCanvas.captureStream(fps);
      const combinedStream = audioCtx
        ? new MediaStream([...videoStream.getVideoTracks(), ...audioDest.stream.getAudioTracks()])
        : videoStream;

      const recorderOptions = {};
      if (mimeType) recorderOptions.mimeType = mimeType;
      if (tier.videoBitsPerSecond) recorderOptions.videoBitsPerSecond = tier.videoBitsPerSecond;

      const recorder = new MediaRecorder(combinedStream, recorderOptions);
      recorderRef.current = recorder;
      recorder.ondataavailable = e => { if (e.data?.size > 0) chunksRef.current.push(e.data); };
      recorder.start();
      const recordingStartTs = Date.now(); // TEMP DIAGNOSTIC (reel-crash)
      reelBreadcrumb('recorder-start', { // TEMP DIAGNOSTIC (reel-crash)
        mimeType,
        tier: tier.key,
        canvasW: tier.canvasW,
        canvasH: tier.canvasH,
        fps,
        videoBitsPerSecond: tier.videoBitsPerSecond ?? null,
        deviceMemory: (typeof navigator !== 'undefined' ? navigator.deviceMemory : undefined) ?? null,
      });

      // TEMP DIAGNOSTIC (reel-crash) — wall-clock heartbeat, independent of the render
      // loop's own progress: a stalled/hung loop would stop advancing frameCount but
      // this keeps firing regardless, showing exactly how far recording got before a
      // hard kill instead of just "died somewhere after recorder-start". Throttled to
      // one write per 2s by the interval itself; reelBreadcrumb already wraps every
      // write in try/catch, so a diagnostic failure here can't affect real recording.
      heartbeatInterval = setInterval(() => {
        reelBreadcrumb('rec-heartbeat', {
          t: Date.now() - recordingStartTs,
          frameCount, totalFrames,
        });
      }, 2000);

      // 4. Render panel frames ─────────────────────────────────────────────
      if (!isLow) {
        // High tier — unchanged.
        for (let pi = 0; pi < validItems.length; pi++) {
          if (cancelledRef.current) break;
          const { panel } = validItems[pi];
          const img       = validImgs[pi];

          setLabel(
            isHebrew
              ? `מרנדר פאנל ${pi + 1} מתוך ${validItems.length}...`
              : `Rendering panel ${pi + 1} of ${validItems.length}...`
          );

          for (let f = 0; f < panelFrames; f++) {
            if (cancelledRef.current) break;
            const t = panelFrames > 1 ? f / (panelFrames - 1) : 0;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            if (filterSupported && gradeFilter !== 'none') ctx.filter = gradeFilter;
            applyKenBurns(ctx, img, pi, t);
            if (filterSupported) ctx.filter = 'none';
            drawVignettes(ctx);
            drawPanelText(ctx, panel, pi);
            drawWatermark(ctx);
            const fadeIn  = f < FADE_FRAMES ? 1 - f / FADE_FRAMES : 0;
            const fadeOut = f > panelFrames - FADE_FRAMES
              ? (f - (panelFrames - FADE_FRAMES)) / FADE_FRAMES : 0;
            const blackAlpha = Math.min(1, Math.max(fadeIn, fadeOut));
            if (blackAlpha > 0.01) {
              ctx.fillStyle = `rgba(0,0,0,${blackAlpha})`;
              ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            }
            await advance();
          }
        }
      } else {
        // Low tier — progressive decode: one panel's bitmap alive at a time
        // during its own render, closed immediately after. A panel that fails
        // to decode is skipped cleanly (no frames rendered for it, same as a
        // panel that failed the upfront Promise.all on the high tier today) —
        // total duration simply shortens by that panel's share, exactly
        // matching today's existing shortfall-tolerant behavior, just
        // discovered progressively instead of upfront. `renderedIdx`
        // (successes only) feeds applyKenBurns/drawPanelText so the
        // alternating zoom/pan direction matches the high tier's semantics
        // (indexed into the FILTERED list of panels that actually rendered).
        //
        // Prefetch: panel i+1's decode starts as soon as panel i's own decode
        // resolves, running IN PARALLEL with panel i's ~3s of frame rendering
        // below — so by the time the loop reaches i+1, its bitmap is usually
        // already there instead of adding another decode-time pause at every
        // panel boundary. At most 2 bitmaps alive at once (current + the one
        // prefetching).
        //
        // Cleanup lives in generate()'s own outer `finally` (lowTierPrefetch),
        // NOT inside this promise chain — an EARLIER version closed the bitmap
        // from within a .then() attached at start time, gated on a "consumed"
        // flag the main loop only sets once it actually reaches that index.
        // That fires far too early: the prefetch's decode (~300-500ms) finishes
        // well before the current panel's ~3s of frames are done rendering, so
        // the .then() ran — and closed the bitmap — while the main loop was
        // still mid-render on the PREVIOUS panel, long before it ever reached
        // the one being prefetched. Confirmed on-device (headless Chromium):
        // "Failed to execute 'drawImage' ... The image source is detached" —
        // applyKenBurns handed an already-closed bitmap. Checking only ONCE,
        // at generate()'s actual exit, for a prefetch that was started but
        // never consumed (the loop broke/threw/cancelled before reaching its
        // index) is the only correctly-timed abandonment signal — there is at
        // most one outstanding prefetch at a time (nulled out immediately on
        // consumption, by the index-reuse below), so one check suffices.
        // loadPanelImageLowTier itself never rejects (see its own doc comment),
        // so this chain can't produce an unhandled rejection either way.
        const startPrefetch = (idx) => {
          if (cancelledRef.current || idx >= usablePanelData.length) return;
          lowTierPrefetch = { idx, promise: loadPanelImageLowTier(usablePanelData[idx].url).catch(() => null) };
        };
        startPrefetch(0);

        let renderedIdx = 0;
        let decodedCount = 0;
        let decodeMsAccum = 0; // sum of only the decode calls themselves, not the frame-render time between them
        for (let pi = 0; pi < usablePanelData.length; pi++) {
          if (cancelledRef.current) break;
          const { panel, url } = usablePanelData[pi];

          const panelDecodeStart = Date.now();
          let img;
          if (lowTierPrefetch && lowTierPrefetch.idx === pi) {
            img = await lowTierPrefetch.promise;
            lowTierPrefetch = null; // consumed — nothing left for the finally to clean up here
          } else {
            // Shouldn't normally happen (every panel is prefetched one step
            // ahead) — defensive fallback, e.g. if startPrefetch skipped due
            // to cancellation right as this panel came up.
            img = await loadPanelImageLowTier(url).catch(() => null);
          }
          decodeMsAccum += Date.now() - panelDecodeStart;
          startPrefetch(pi + 1); // overlaps with this panel's frame loop below
          if (!img) { continue; } // skip cleanly — no frames for this panel
          decodedCount++;

          setLabel(
            isHebrew
              ? `מרנדר פאנל ${renderedIdx + 1}...`
              : `Rendering panel ${renderedIdx + 1}...`
          );

          for (let f = 0; f < panelFrames; f++) {
            if (cancelledRef.current) break;
            const t = panelFrames > 1 ? f / (panelFrames - 1) : 0;
            ctx.fillStyle = '#000';
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            if (filterSupported && gradeFilter !== 'none') ctx.filter = gradeFilter;
            applyKenBurns(ctx, img, renderedIdx, t);
            if (filterSupported) ctx.filter = 'none';
            drawVignettes(ctx);
            drawPanelText(ctx, panel, renderedIdx);
            drawWatermark(ctx);
            const fadeIn  = f < FADE_FRAMES ? 1 - f / FADE_FRAMES : 0;
            const fadeOut = f > panelFrames - FADE_FRAMES
              ? (f - (panelFrames - FADE_FRAMES)) / FADE_FRAMES : 0;
            const blackAlpha = Math.min(1, Math.max(fadeIn, fadeOut));
            if (blackAlpha > 0.01) {
              ctx.fillStyle = `rgba(0,0,0,${blackAlpha})`;
              ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
            }
            await advance();
          }

          if (typeof img.close === 'function') img.close(); // ImageBitmap only — releases native memory now, not at GC's leisure
          img = null;
          renderedIdx++;
        }

        reelBreadcrumb('panels-decoded', { // TEMP DIAGNOSTIC (reel-crash) — same shape as the high tier's, just computed progressively
          attempted: usablePanelData.length,
          decoded: decodedCount,
          ms: decodeMsAccum, // sum of decode-only time, matching what the high tier's `ms` measures — NOT the whole loop (which also includes ~21s of frame rendering/pacing)
        });
        if (decodedCount === 0) throw new Error('All panel images failed to decode.');
        validItems = { length: decodedCount }; // only .length is read below (panel_count analytics)
      }

      // 5. Render end card ─────────────────────────────────────────────────
      if (!cancelledRef.current) {
        setLabel(isHebrew ? 'מרנדר קרדיטים...' : 'Rendering end card...');
        for (let f = 0; f < endFrames; f++) {
          if (cancelledRef.current) break;
          drawEndCard(ctx, producerName, logoImg, f / (endFrames - 1));
          await advance();
        }

        // Hold the final end-card frame for two extra capture intervals before
        // stopping the recorder. captureStream(fps) samples on its own independent
        // timer; without this pause the last 1–2 drawn frames may not be sampled
        // before recorder.stop() finalises the stream.
        if (!cancelledRef.current) await sleep(msPerFrame * 2);
      }

      // 6. Finalize ────────────────────────────────────────────────────────
      try { audioSrc?.stop(); } catch {}
      try { audioCtx?.close(); } catch {}
      if (cancelledRef.current) return;

      await new Promise(resolve => { recorder.onstop = resolve; recorder.stop(); });
      if (cancelledRef.current) return;

      // ── Phase 4 hook: server-side FFmpeg pipeline ─────────────────────────
      // When useServerPipeline is true, POST chunksRef.current to /api/compile-mp4,
      // receive a proper H.264/AAC MP4 URL, and skip the local Blob step below.
      // The component shell (state, props, download handler) stays identical.
      // ─────────────────────────────────────────────────────────────────────
      const outputMime = mimeType || 'video/webm';
      const blob = new Blob(chunksRef.current, { type: outputMime });
      videoBlobRef.current = blob;
      const url  = URL.createObjectURL(blob);

      // Push final frame to preview before switching to video element.
      if (previewRef.current) {
        previewRef.current.getContext('2d').drawImage(canvas, 0, 0, PREVIEW_W, PREVIEW_H);
      }

      setVideoUrl(url);
      setProgress(100);
      setPhase('done');
      reelBreadcrumb('reel-finished', { blobSize: blob.size, tier: tier.key }); // TEMP DIAGNOSTIC (reel-crash)

      track('Reel Generated', {
        genre, language: lang,
        panel_count: validItems.length,
        soundtrack, visual_grade: visualGrade,
        producer: producerName || 'Guest',
        reel_tier: tier.key,
      });

    } catch (err) {
      console.error('Reel generation failed:', err);
      if (!cancelledRef.current) {
        setErrorMsg(isHebrew ? `שגיאה: ${err.message}` : `Failed: ${err.message}`);
        setPhase('error');
        reelBreadcrumb('reel-error', { message: err?.message || '?', tier: tier.key }); // TEMP DIAGNOSTIC (reel-crash)
      }
    } finally {
      if (heartbeatInterval) clearInterval(heartbeatInterval); // TEMP DIAGNOSTIC (reel-crash) — every exit path, success/error/cancel alike
      // Low tier only: a prefetch left non-null here means generate() is
      // exiting (break/throw/cancel) before the render loop ever reached that
      // panel's index to consume it — close whatever bitmap it produces once
      // its decode settles, so an abandoned prefetch can never leak one.
      if (lowTierPrefetch) {
        lowTierPrefetch.promise.then((bitmap) => {
          if (bitmap && typeof bitmap.close === 'function') {
            try { bitmap.close(); } catch { /* never let cleanup itself throw */ }
          }
        });
      }
    }
  }, [usablePanelData, soundtrack, visualGrade, genre, lang, producerName, isHebrew, readyCount]);

  // ── Phase 4 architecture placeholder ────────────────────────────────────
  // Flip useServerPipeline to true (and implement /api/compile-mp4) in Phase 4
  // to swap the client-side MediaRecorder Blob with a server-encoded H.264 MP4.
  // No other component changes are needed — only the generate() pipeline block
  // marked "Phase 4 hook" below needs to be updated.
  const useServerPipeline = false; // eslint-disable-line no-unused-vars

  // ── Share ────────────────────────────────────────────────────────────────
  // Web Share API only — lets mobile users "Save to Photos" or post to IG/TikTok.
  // Never navigates the page (an <a download> at a blob: URL makes iOS Safari NAVIGATE,
  // tearing down the SPA). Falls back to opening the video where sharing is unsupported.
  // The filename's extension is derived from the ACTUAL recorded blob.type — the low
  // tier prefers vp8/webm first (see resolveReelTier), so a hardcoded .mp4 here would
  // mislabel a real webm file. QuickTime / mobile players codec-detect from it.
  // Cache of the share-ready reel File, tagged with the videoUrl it was built from so a
  // stale render is never shared. Pre-warmed on pointer-down so navigator.share() fires
  // inside iOS's transient-activation window (consistent with poster/panel sharing).
  const shareFileRef = useRef({ url: null, file: null });
  const prewarmRef   = useRef(null);
  // prewarmReel builds the share File directly from the in-memory Blob (see generate()
  // below) instead of fetch()-ing videoUrl's blob: object URL — CSP's connect-src
  // (next.config.js) does not allowlist the blob: scheme, so that fetch always failed
  // silently, leaving mobile's "Share Reel" a dead button (see handleShare's `if (!file)
  // return`) and desktop surviving only by accident via the raw-videoUrl download fallback.
  const prewarmReel = useCallback(() => {
    if (!videoUrl || !videoBlobRef.current) return null;
    if (shareFileRef.current.url === videoUrl && shareFileRef.current.file) return null;
    if (prewarmRef.current) return prewarmRef.current;
    const url = videoUrl;
    // Strip codec params (e.g. "video/mp4;codecs=h264,aac" → "video/mp4").
    // navigator.canShare on some iOS versions rejects the semicolon-qualified
    // type and returns false, causing the share to silently no-op on mobile.
    const baseType = (videoBlobRef.current.type || 'video/webm').split(';')[0].trim();
    const ext = baseType.includes('mp4') ? 'mp4' : 'webm';
    const filename = `lifescript-reel-${genre || 'film'}.${ext}`;
    const file = new File([videoBlobRef.current], filename, { type: baseType });
    shareFileRef.current = { url, file };
    return Promise.resolve(file);
  }, [videoUrl, genre]);

  // Auto-prewarm as soon as the reel is ready — maximises head-start before the user
  // taps "Share Reel", keeping navigator.share() inside iOS's transient-activation
  // window even when the video blob is large (10-30 MB).
  useEffect(() => {
    if (videoUrl && phase === 'done') prewarmReel();
  }, [videoUrl, phase, prewarmReel]);

  const handleShare = useCallback(async () => {
    if (!videoUrl) return;
    const doDownload = (src, ext) => {
      const a = document.createElement('a');
      a.href = src; a.download = `lifescript-reel-${genre || 'film'}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
    };
    try {
      let file = (shareFileRef.current.url === videoUrl) ? shareFileRef.current.file : null;
      if (!file) { const p = prewarmReel(); file = p ? await p : null; }

      if (isDesktop) {
        // Desktop: always use <a download> — never the share sheet.
        // macOS Safari supports navigator.share for files and returns shared=true,
        // so a share-then-fallback pattern silently goes through the share sheet
        // instead of saving to Downloads.  Direct download is always the right UX.
        const ext = file ? ((file.type || '').includes('mp4') ? 'mp4' : 'webm') : 'webm';
        const src = file ? URL.createObjectURL(file) : videoUrl;
        doDownload(src, ext);
        if (file && src !== videoUrl) setTimeout(() => URL.revokeObjectURL(src), 1000);
        return;
      }

      // Mobile: native share sheet (navigator.share).
      if (!file) return; // prewarm failed — no safe fallback on iOS without navigating the SPA
      await shareReadyFile(file, 'LifeScript Reel');
      // null = activation expired, false = canShare returned false — both silent on mobile.
    } catch {
      // Catch-all: on desktop, fall back to the raw blob URL download. videoBlobRef
      // is still in scope here even though prewarm failed, so the extension can
      // still be derived from the real recorded type rather than assumed.
      if (isDesktop) {
        const fallbackExt = (videoBlobRef.current?.type || '').includes('mp4') ? 'mp4' : 'webm';
        doDownload(videoUrl, fallbackExt);
      }
    }
  }, [videoUrl, prewarmReel, genre, isDesktop]);

  const handleReset = useCallback(() => {
    if (videoUrl) { URL.revokeObjectURL(videoUrl); setVideoUrl(null); }
    shareFileRef.current = { url: null, file: null }; // drop the stale reel share render
    prewarmRef.current = null;
    chunksRef.current = [];
    videoBlobRef.current = null;
    setPhase('idle'); setProgress(0); setLabel(''); setErrorMsg('');
  }, [videoUrl]);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            key="reel-bd"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.22 }}
            className="fixed inset-0 z-[3000] bg-black/88 backdrop-blur-lg"
            onClick={phase === 'generating' ? undefined : onClose}
          />

          {/* ── Modal shell ───────────────────────────────────────────────
               Centering wrapper:  fixed inset-0 z-[3001].
               • p-3 gives a minimum 12px gap from viewport edges on all sides.
               • pt-[5.5rem] sm:pt-3 ensures the modal top never collides with
                 the sticky Navbar (~80px tall on mobile, ~56px on desktop).
               • overflow-y-auto only on the inner body panel (not this wrapper).
               ──────────────────────────────────────────────────────────────── */}
          <motion.div
            key="reel-modal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{   opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed top-0 left-0 right-0 z-[3001] flex items-center justify-center px-4 md:px-6 pointer-events-none"
            style={{
              height: '100dvh',
              paddingTop: 'max(1rem, env(safe-area-inset-top))',
              paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            }}
          >
            <motion.div
              initial={{ scale: 0.92, y: 16 }}
              animate={{ scale: 1,    y: 0  }}
              exit={{   scale: 0.92, y: 16  }}
              transition={{ type: 'spring', stiffness: 400, damping: 36, mass: 0.7 }}
              className="
                w-full max-w-[440px] pointer-events-auto
                flex flex-col
                max-h-full
                bg-[#060610]/99 backdrop-blur-3xl
                border border-[#d4a373]/14
                rounded-[2rem] sm:rounded-[2.5rem]
                shadow-[0_60px_140px_rgba(0,0,0,0.96)]
                overflow-hidden
              "
            >
              {/* ══ STICKY HEADER ══════════════════════════════════════════ */}
              <div className="shrink-0 relative px-5 sm:px-7 pt-5 sm:pt-7 pb-4 border-b border-white/[0.055]">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/18 flex items-center justify-center shrink-0">
                    <Video size={16} className="text-[#d4a373]" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-white font-black text-[13px] sm:text-[14.5px] uppercase tracking-wider leading-none truncate">
                      {isHebrew ? 'גנרטור ריל קולנועי' : 'Cinematic Reel Generator'}
                    </h2>
                    <p className="text-[#d4a373]/38 text-[7.5px] sm:text-[8.5px] font-black tracking-[0.25em] uppercase mt-1.5">
                      {isHebrew ? 'אינסטגרם · טיקטוק · יוטיוב שורטס' : 'Instagram · TikTok · YouTube Shorts'}
                    </p>
                  </div>
                </div>

                {/* Close — always reachable */}
                {phase !== 'generating' && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label={isHebrew ? 'סגור' : 'Close'}
                    className="close-button absolute top-4 right-4 sm:top-5 sm:right-5 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/[0.06] [@media(hover:hover)]:hover:bg-white/[0.14] text-gray-500 [@media(hover:hover)]:hover:text-white transition-all duration-200"
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              {/* ══ SCROLLABLE BODY ═══════════════════════════════════════ */}
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 sm:px-6 py-4 sm:py-5 space-y-5">

                {/* Hidden render canvas — off-screen but in DOM for captureStream */}
                <canvas
                  ref={canvasRef}
                  width={CANVAS_W}
                  height={CANVAS_H}
                  style={{ position: 'absolute', top: -9999, left: -9999, pointerEvents: 'none' }}
                />

                {/* ── IDLE PHASE: Director's Control Panel ──────────────── */}
                {phase === 'idle' && (
                  <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-5">

                    {/* Panel readiness bar */}
                    <div className="bg-white/[0.03] border border-white/[0.07] rounded-2xl p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-white/45 text-[9.5px] font-bold uppercase tracking-wider">
                          {isHebrew ? 'פאנלים מוכנים לייצוא' : 'Panels ready for export'}
                        </span>
                        <span className={`text-[10px] font-black tabular-nums ${readyCount === totalCount ? 'text-green-400' : 'text-[#d4a373]'}`}>
                          {readyCount} / {totalCount}
                        </span>
                      </div>
                      <div className="flex gap-1">
                        {panels.map((_, i) => {
                          const st = panelImages[i];
                          return <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors duration-500 ${
                            st?.url    ? 'bg-[#d4a373]'
                          : st?.error  ? 'bg-red-500/35'
                          : 'bg-white/10 animate-pulse'
                          }`} />;
                        })}
                      </div>
                    </div>

                    {/* ── Soundtrack Vibe ──────────────────────────────── */}
                    <div className="space-y-3">
                      <SectionLabel
                        left="──"
                        right="──"
                        text={isHebrew ? '🎵  מוזיקת הסרטון' : '🎵  Soundtrack Vibe'}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        {SOUNDTRACKS.map(opt => (
                          <SelectorButton
                            key={opt.key}
                            active={soundtrack === opt.key}
                            onClick={() => setSoundtrack(opt.key)}
                          >
                            <span className="text-[22px] leading-none">{opt.emoji}</span>
                            <span className={`text-[8px] font-black uppercase tracking-wide text-center leading-snug ${
                              soundtrack === opt.key ? 'text-[#d4a373]' : 'text-white/38'
                            }`}>
                              {isHebrew ? opt.labelHe : opt.label}
                            </span>
                          </SelectorButton>
                        ))}
                      </div>
                    </div>

                    {/* ── Visual Grading ───────────────────────────────── */}
                    <div className="space-y-3">
                      <SectionLabel
                        left="──"
                        right="──"
                        text={isHebrew ? '🎨  גרייד ויזואלי' : '🎨  Cinematic Grade'}
                      />
                      <div className="grid grid-cols-2 gap-2">
                        {VISUAL_GRADES.map(opt => (
                          <SelectorButton
                            key={opt.key}
                            active={visualGrade === opt.key}
                            onClick={() => setVisualGrade(opt.key)}
                          >
                            <span className="text-[22px] leading-none">{opt.emoji}</span>
                            <span className={`text-[8px] font-black uppercase tracking-wide text-center leading-snug ${
                              visualGrade === opt.key ? 'text-[#d4a373]' : 'text-white/38'
                            }`}>
                              {isHebrew ? opt.labelHe : opt.label}
                            </span>
                          </SelectorButton>
                        ))}
                      </div>

                      {/* Active grade filter preview label */}
                      <p className="text-center text-[7.5px] font-mono text-white/20 tracking-widest">
                        {VISUAL_GRADES.find(g => g.key === visualGrade)?.filter || 'none'}
                      </p>
                    </div>

                    {/* Format note */}
                    <div className="flex items-center justify-center gap-1.5 flex-wrap pt-1">
                      {['9:16 Portrait', '720 × 1280', '30 FPS', 'Ken Burns FX'].map(c => (
                        <span key={c} className="px-2 py-0.5 rounded-full bg-white/[0.04] border border-white/[0.07] text-[7.5px] font-bold text-white/30 uppercase tracking-wider">
                          {c}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* ── GENERATING PHASE ─────────────────────────────────── */}
                {phase === 'generating' && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex flex-col items-center gap-4"
                  >
                    {/* Live preview canvas */}
                    <div
                      className="rounded-2xl overflow-hidden border border-[#d4a373]/20 bg-black shadow-[0_8px_36px_rgba(0,0,0,0.8)] shrink-0"
                      style={{ width: PREVIEW_W, height: PREVIEW_H }}
                    >
                      <canvas ref={previewRef} width={PREVIEW_W} height={PREVIEW_H} className="block" />
                    </div>

                    {/* Progress */}
                    <div className="w-full space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[#d4a373] text-[9px] font-black uppercase tracking-widest truncate pr-2">
                          {label}
                        </span>
                        <span className="text-white/40 text-[10px] font-mono shrink-0">{progress}%</span>
                      </div>
                      <div className="h-1.5 bg-white/[0.07] rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full bg-gradient-to-r from-[#d4a373] to-[#fefae0]"
                          animate={{ width: `${progress}%` }}
                          transition={{ duration: 0.3, ease: 'linear' }}
                        />
                      </div>
                      <p className="text-white/20 text-[8px] text-center tracking-[0.18em] uppercase">
                        {isHebrew ? 'אל תסגור חלון זה בזמן הרנדור' : 'Keep this window open during rendering'}
                      </p>
                    </div>
                  </motion.div>
                )}

                {/* ── DONE PHASE ───────────────────────────────────────── */}
                {phase === 'done' && videoUrl && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-center gap-4"
                  >
                    <div
                      className="relative rounded-2xl overflow-hidden border border-[#d4a373]/25 bg-black shadow-[0_8px_36px_rgba(212,163,115,0.14)] shrink-0"
                      style={{ width: PREVIEW_W, height: PREVIEW_H }}
                    >
                      <video
                        ref={videoRef}
                        src={videoUrl}
                        autoPlay loop playsInline
                        muted={isVideoMuted}
                        className="w-full h-full object-cover"
                      />

                      {/* Sound toggle — always visible; one tap unmutes with a real gesture */}
                      <button
                        onClick={() => {
                          const vid = videoRef.current;
                          if (!vid) return;
                          const next = !isVideoMuted;
                          // Set directly on the DOM element first to avoid React
                          // reconciliation delay, then sync React state.
                          vid.muted = next;
                          if (!next) vid.play().catch(() => { vid.muted = true; setIsVideoMuted(true); });
                          setIsVideoMuted(next);
                        }}
                        className="absolute bottom-2.5 right-2.5 flex items-center justify-center w-8 h-8 rounded-full transition-all duration-200"
                        style={{
                          background: 'rgba(0,0,0,0.62)',
                          border: isVideoMuted
                            ? '1px solid rgba(255,255,255,0.14)'
                            : '1px solid rgba(212,163,115,0.45)',
                          backdropFilter: 'blur(6px)',
                        }}
                        title={isVideoMuted
                          ? (isHebrew ? 'הפעל קול' : 'Tap to hear audio')
                          : (isHebrew ? 'השתק' : 'Mute')}
                      >
                        {isVideoMuted
                          ? <VolumeX size={13} className="text-white/55" />
                          : <Volume2 size={13} className="text-[#d4a373]" />
                        }
                      </button>
                    </div>
                    <div className="w-full space-y-3">
                      {/* Success badge */}
                      <p className="text-green-400 text-[9.5px] font-black uppercase tracking-widest text-center">
                        ✓ {isHebrew ? 'הריל מוכן!' : 'Reel Ready!'}
                      </p>

                      {/* Apple / iOS compatibility note */}
                      <motion.div
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.45 }}
                        className="rounded-xl border px-3 py-2.5"
                        style={{
                          background: 'rgba(255,255,255,0.025)',
                          borderColor: 'rgba(255,255,255,0.07)',
                        }}
                      >
                        <p
                          className="text-[7.5px] leading-relaxed text-center"
                          style={{ color: 'rgba(255,255,255,0.28)' }}
                          dir={isHebrew ? 'rtl' : 'ltr'}
                        >
                          {isHebrew
                            ? 'משתף באייפון או מק? מומלץ לנגן באמצעות כרום, וואטסאפ או נגן VLC במידה והקובץ לא נפתח אוטומטית.'
                            : "Sharing on iOS or Mac? If the file doesn’t play natively, open it via Chrome, WhatsApp, or VLC Player."}
                        </p>
                      </motion.div>
                    </div>
                  </motion.div>
                )}

                {/* ── ERROR PHASE ──────────────────────────────────────── */}
                {phase === 'error' && (
                  <motion.div
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    className="flex flex-col items-center gap-3 py-6 text-center"
                  >
                    <AlertCircle size={26} className="text-red-400 shrink-0" />
                    <p className="text-red-400/80 text-[11px] font-medium leading-relaxed max-w-[280px]">
                      {errorMsg}
                    </p>
                  </motion.div>
                )}

              </div>{/* end scrollable body */}

              {/* ══ STICKY FOOTER ═════════════════════════════════════════ */}
              <div className="shrink-0 px-5 sm:px-6 pt-3 pb-5 sm:pb-6 space-y-2 border-t border-white/[0.05]"
                style={{ paddingBottom: 'max(20px, env(safe-area-inset-bottom, 20px))' }}
              >
                {phase !== 'done' ? (
                  <button
                    onClick={generate}
                    disabled={phase === 'generating' || readyCount === 0}
                    className={`w-full py-[14px] sm:py-[15px] rounded-2xl font-black text-[12px] sm:text-[12.5px] uppercase tracking-widest transition-all flex items-center justify-center gap-2.5 active:scale-[0.98]
                      ${phase === 'generating'
                        ? 'bg-[#d4a373]/12 text-[#d4a373]/40 cursor-not-allowed'
                      : readyCount === 0
                        ? 'bg-white/[0.04] text-white/18 cursor-not-allowed'
                      : 'bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black hover:from-white hover:to-white shadow-[0_8px_28px_rgba(212,163,115,0.35)]'}`}
                  >
                    {phase === 'generating' ? (
                      <><Loader2 size={15} className="animate-spin" />{isHebrew ? 'מרנדר...' : 'Rendering...'}</>
                    ) : phase === 'error' ? (
                      isHebrew ? '↺ נסה שוב' : '↺ Try Again'
                    ) : (
                      <><Video size={15} />{isHebrew ? 'צור ריל קולנועי' : 'Generate Cinematic Reel'}</>
                    )}
                  </button>
                ) : (
                  <>
                    <button
                      onPointerDown={prewarmReel}
                      onClick={handleShare}
                      className="w-full py-[14px] sm:py-[15px] rounded-2xl font-black text-[12px] sm:text-[12.5px] uppercase tracking-widest bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black hover:from-white hover:to-white active:scale-[0.98] transition-all flex items-center justify-center gap-2.5 shadow-[0_8px_28px_rgba(212,163,115,0.35)]"
                    >
                      {isDesktop ? <Download size={15} /> : <Share2 size={15} />}
                      {isDesktop
                        ? (isHebrew ? 'הורד ריל' : 'Download Reel')
                        : (isHebrew ? 'שתף ריל' : 'Share Reel')}
                    </button>
                    <button
                      onClick={handleReset}
                      className="w-full py-2.5 rounded-xl text-[9px] font-black uppercase tracking-widest text-white/28 hover:text-white/55 transition-colors"
                    >
                      {isHebrew ? 'צור ריל חדש' : 'Generate New Reel'}
                    </button>
                  </>
                )}

                <div className="flex items-center justify-center gap-1.5 pt-1">
                  <span className="text-[#d4a373]/22 text-[7px] font-black uppercase tracking-[0.3em]">
                    LIFESCRIPT STUDIO
                  </span>
                </div>
              </div>
            </motion.div>{/* end modal panel */}
          </motion.div>{/* end centering wrapper */}
        </>
      )}
    </AnimatePresence>
  );
}

// ── Sub-components (co-located, not exported) ────────────────────────────────

function SectionLabel({ text }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-px flex-1 bg-white/[0.07]" />
      <span className="text-[8px] font-black uppercase tracking-[0.28em] text-white/28 whitespace-nowrap">
        {text}
      </span>
      <div className="h-px flex-1 bg-white/[0.07]" />
    </div>
  );
}

function SelectorButton({ active, onClick, children }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileTap={{ scale: 0.95 }}
      className={`flex flex-col items-center justify-center gap-2 p-3 rounded-2xl border transition-all duration-250 min-h-[76px] ${
        active
          ? 'border-[#d4a373]/65 bg-[#d4a373]/10 shadow-[0_0_18px_rgba(212,163,115,0.14)]'
          : 'border-white/[0.08] bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]'
      }`}
    >
      {children}
    </motion.button>
  );
}
