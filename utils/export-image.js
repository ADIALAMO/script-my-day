/**
 * Share an image or video blob to the device via the Web Share API
 * ("Save Image" / social share sheet). This is the only export path that works
 * reliably on iOS without navigating the top-level page — an `<a download>` pointing
 * at a blob:/data: URL makes iOS Safari NAVIGATE the tab, tearing down the SPA
 * ("download refreshes the page and loses state").
 *
 * Every export returns a boolean: true when the OS handled it (including a user
 * cancel), false when file sharing is unsupported on this platform — letting the
 * caller fall back (e.g. open the asset in a new tab). Nothing here ever navigates
 * the page.
 *
 * ── Native Android (Capacitor) branch ─────────────────────────────────────────
 * capacitor.config.json points the Android app's WebView at the live production
 * site (no bundled build) — so the share buttons run inside Android's System
 * WebView, NOT a real browser. Confirmed on-device: `navigator.share` and
 * `navigator.canShare` are both `undefined` there — not partially supported,
 * genuinely absent. The `<a download>` fallback below ALSO silently no-ops there —
 * a bare WebView has no native download handler wired up for blob: URLs the way
 * a real browser chrome does. Together those two facts are why poster/comic/reel
 * sharing went completely silent on Android while working fine on iOS Safari.
 *
 * The fix: when `isCapacitorNative()`, skip the Web Share API entirely and go
 * straight to the native `@capacitor/share` plugin, which fires a real Android
 * share Intent — unaffected by WebView web-platform gaps. Its `files` option
 * wants `file://` URIs, not raw Files, so each File is base64-encoded and
 * written to the Capacitor `Cache` directory via `@capacitor/filesystem` first
 * (see shareFilesNative). The web path (iOS Safari, desktop, the PWA) is
 * completely untouched — same navigator.share call, same transient-activation
 * handling in usePosterGeneration.js.
 */

import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { isCapacitorNative } from './platform.js';

// File → base64 (no `data:...;base64,` prefix) for Filesystem.writeFile, which
// expects raw base64 when no `encoding` is given (binary data). FileReader is
// used over arrayBuffer()+manual encoding because it's the simpler, well-tested
// path and these payloads (a poster PNG, a short reel clip) are small enough
// that the extra base64-string allocation is a non-issue.
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('FileReader failed'));
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.split(',')[1] || '');
    };
    reader.readAsDataURL(file);
  });
}

// Writes each File to a temp path in the Capacitor Cache directory (cleared
// opportunistically by the OS under storage pressure — fine, these are
// one-shot share payloads, not content the app needs to keep) and hands the
// resulting file:// URIs to the native share sheet. Throws on failure; the
// caller (shareFiles) already has the try/catch + sharePending latch that
// every other share path shares, so errors are handled in one place.
async function shareFilesNative(files, title, text) {
  const uris = [];
  for (const file of files) {
    const base64 = await fileToBase64(file);
    if (!base64) throw new Error('Could not read file for native share');
    const path = `share/${Date.now()}-${Math.random().toString(36).slice(2)}-${file.name || 'lifescript.png'}`;
    const { uri } = await Filesystem.writeFile({
      path,
      data: base64,
      directory: Directory.Cache,
      recursive: true,
    });
    uris.push(uri);
  }
  // Errors here propagate unchanged — caller (shareFiles) already owns the
  // try/catch + shareHandled logic shared by every share path.
  await Share.share({
    ...(title ? { title, dialogTitle: title } : {}),
    ...(text ? { text } : {}),
    files: uris,
  });
}

// Capability detection (never UA sniffing). Decides which export affordance to show:
//   • isDesktop — a hover-capable, fine-pointer device (mouse/trackpad). On desktop an
//     `<a download>` triggers a real file download and NEVER navigates the SPA, so it is
//     the right primary action. Touch devices (phones/tablets, incl. iOS) report
//     `(pointer: coarse)` / `(hover: none)`, so they never take the download path that
//     caused the "share then refresh, lose state" iOS bug.
//   • canShareFiles — the Web Share API can hand Files to the OS sheet ("Save Image" /
//     social share). True on mobile and on some macOS browsers.
export function exportCapabilities() {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') {
    return { isDesktop: false, canShareFiles: false };
  }
  // Native Android/iOS: file sharing always goes through @capacitor/share (see
  // shareFilesNative below), independent of whatever the WebView's Web Share
  // API does or doesn't support — so it's unconditionally capable here.
  let canShareFiles = isCapacitorNative();
  if (!canShareFiles) {
    try {
      const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' });
      canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [probe] }));
    } catch {
      canShareFiles = false;
    }
  }
  const isDesktop = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  return { isDesktop, canShareFiles };
}

// ─── data: URI → Blob without fetch() ───────────────────────────────────────────
// CSP's connect-src (next.config.js) intentionally does NOT allowlist the data:
// scheme — even though a data: URI never leaves the page, browsers still gate
// fetch()/XHR against connect-src by scheme. That made every fetch('data:image/...')
// in this app throw silently in production while working fine in local dev (no CSP
// there). Decoding the base64 payload locally sidesteps fetch entirely — it never
// touches the network, so it needs no CSP allowance.
function dataUrlToBlob(dataUrl) {
  const [header, base64 = ''] = dataUrl.split(',');
  const mime = /data:(.*?);base64/.exec(header)?.[1] || 'image/png';
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Turn any poster/panel source URL into a Blob: data: URIs are decoded locally
// (see dataUrlToBlob above); http(s) URLs still go through fetch, unaffected since
// connect-src already allows 'self' and CDN assets are always requested via the
// same-origin /api/proxy-image route.
export async function urlToBlob(url) {
  if (url.startsWith('data:')) return dataUrlToBlob(url);
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.blob();
}

// ─── Share-loop watermark (compositing) ─────────────────────────────────────────
// Every shared poster/panel is a free ad: we burn a small bilingual brand + CTA into the
// bottom of the image so re-shares carry attribution back to lifescript.app and pull new
// users into the loop. Compositing runs on a canvas seeded from the blob's OWN object URL,
// so the canvas is same-origin and never tainted — toBlob always succeeds. Videos (reels)
// and non-image blobs are returned untouched (canvas can't composite a video frame here).

const WATERMARK_COPY = {
  he: { brand: 'LIFESCRIPT', cta: 'צור את שלך', url: 'lifescript.app' },
  en: { brand: 'LIFESCRIPT', cta: 'Create yours', url: 'lifescript.app' },
};

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// ─── Poster overlay: title + credits, drawn on the canvas ───────────────────────
// The on-screen poster (components/PosterRenderer.jsx) draws its title and credits
// as CSS over the artwork. The mobile/native share path fetches the RAW image (html-to-image
// takes 2-3 s and would kill iOS's transient activation), so without this the shared file had
// no title and no credits. This redraws the same block on the canvas, from the same strings,
// scaled off the poster's on-screen width so it matches what the user sees.
//
// Layout constants are CSS px at the on-screen poster width (`cssWidth`) and mirror the
// Tailwind classes in PosterRenderer.jsx (sm = phone sizes, md = viewport >= 768px).
// Keep the two in sync when editing either.
const OVERLAY_FONT = '"Heebo", system-ui, -apple-system, "Segoe UI", sans-serif';
const OVERLAY_URL_LINE = 'MY-LIFE-SCRIPT.VERCEL.APP';

// Heebo is loaded by a stylesheet in _document; make sure the weights we draw with are
// actually available before touching the canvas (an unloaded face silently falls back).
// Bounded so a slow font fetch can never hold up a share.
async function ensureOverlayFonts() {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  try {
    await Promise.race([
      Promise.all([
        document.fonts.load('900 16px Heebo'),
        document.fonts.load('italic 900 16px Heebo'),
        document.fonts.load('700 16px Heebo'),
        document.fonts.load('italic 700 16px Heebo'),
      ]),
      new Promise((resolve) => setTimeout(resolve, 800)),
    ]);
  } catch { /* fall back to system fonts */ }
}

/**
 * Draws the poster title (top) and credits block (bottom) onto `ctx`.
 * spec: { title, credits: { comingSoon, line1, line2, line3 }, rtl, cssWidth, viewportWidth }
 * `stripH` is the height of the brand strip drawn afterwards at the very bottom; the credits
 * sit directly above it. Returns layout metrics (pixels) — also used by tests.
 */
export function drawPosterOverlay(ctx, w, h, spec, stripH = 0) {
  const { title = '', credits = {}, rtl = false, cssWidth = 450, viewportWidth = 390 } = spec || {};
  const k  = w / (cssWidth || 450);               // CSS px -> canvas px
  const md = viewportWidth >= 768;
  const hasLS = 'letterSpacing' in ctx;
  const cx = w / 2;

  ctx.save();
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const font = (weight, italic, px) => { ctx.font = `${italic ? 'italic ' : ''}${weight} ${px * k}px ${OVERLAY_FONT}`; };
  const track = (px) => { if (hasLS) ctx.letterSpacing = `${px * k}px`; };
  const width = (t, trackPx) => ctx.measureText(t).width + (hasLS ? 0 : trackPx * k * [...t].length);
  const wrap = (text, maxW, trackPx) => {
    const words = String(text ?? '').split(/\s+/).filter(Boolean);
    const lines = []; let cur = '';
    for (const word of words) {
      const t = cur ? `${cur} ${word}` : word;
      if (cur && width(t, trackPx) > maxW) { lines.push(cur); cur = word; } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  // ── Top scrim (title readability) — from-black/55 via-transparent ──
  const topScrim = ctx.createLinearGradient(0, 0, 0, h);
  topScrim.addColorStop(0, 'rgba(0,0,0,0.55)');
  topScrim.addColorStop(0.5, 'rgba(0,0,0,0)');
  topScrim.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = topScrim;
  ctx.fillRect(0, 0, w, h);

  // ── Title: clamp(1.1rem, 5vw, 2.5rem), line-height 1.1, max-width 90% of the padded box ──
  const padCss  = md ? 48 : 32;                    // p-8 / md:p-12
  const innerW  = (cssWidth - 2 * padCss) * k;
  const titlePx = Math.min(40, Math.max(17.6, viewportWidth * 0.05));
  let titleBottom = padCss * k + 16 * k;           // pad + mt-4
  const titleText = String(title || '').toUpperCase();
  if (titleText) {
    font(900, true, titlePx); track(0);
    const lines = wrap(titleText, innerW * 0.9, 0);
    ctx.fillStyle = '#fff';
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowBlur = 30 * k; ctx.shadowOffsetY = 10 * k;
    const lineH = titlePx * 1.1 * k;
    lines.forEach((line, i) => ctx.fillText(line, cx, titleBottom + lineH * i + lineH / 2));
    titleBottom += lineH * lines.length;
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
    // gold hairline under the title: h-px, w-1/3, mt-4
    const lw = innerW / 3;
    const hair = ctx.createLinearGradient(cx - lw / 2, 0, cx + lw / 2, 0);
    hair.addColorStop(0, 'rgba(212,163,115,0)');
    hair.addColorStop(0.5, 'rgba(212,163,115,0.5)');
    hair.addColorStop(1, 'rgba(212,163,115,0)');
    ctx.fillStyle = hair;
    ctx.fillRect(cx - lw / 2, titleBottom + 16 * k, lw, Math.max(1, k));
  }

  // ── Credits block, bottom-anchored just above the brand strip ──
  const padX   = (md ? 24 : 8) * k;                // px-2 / md:px-6
  const availW = w - 2 * padX;
  const rows = [
    { text: credits.comingSoon, px: md ? 14 : 9, weight: 900, italic: false, tr: 0.3,  fill: '#d4a373',                after: 6 },   // mb-1.5
    { divider: true, after: 6 },                                                                                                // border-t + pt-1.5
    { text: credits.line1, px: md ? 10 : 7, weight: 700, italic: true,  tr: 0.1,  fill: 'rgba(255,255,255,0.9)',  after: 2 },
    { text: credits.line2, px: md ? 8 : 6,  weight: 700, italic: false, tr: 0.1,  fill: 'rgba(255,255,255,0.63)', after: 2 },
    { text: credits.line3, px: md ? 8 : 6,  weight: 700, italic: false, tr: 0.1,  fill: 'rgba(255,255,255,0.63)', after: 6 },   // mb-1 (4) + flex gap (2)
    { text: OVERLAY_URL_LINE, px: md ? 7 : 5, weight: 900, italic: true, tr: 0.4, fill: 'rgba(212,163,115,0.4)', after: 0 },
  ];
  const LEADING = 1.2;
  // Measure first (top-down heights), then place bottom-up.
  const laid = rows.map((r) => {
    if (r.divider) return { ...r, h: Math.max(1, k), lines: [] };
    font(r.weight, r.italic, r.px); track(r.tr * r.px);
    const lines = wrap(String(r.text ?? '').toUpperCase(), availW, r.tr * r.px);
    return { ...r, lines, h: lines.length * r.px * LEADING * k };
  });
  const blockH = laid.reduce((s, r) => s + r.h + r.after * k, 0) - (laid.length ? laid[laid.length - 1].after * k : 0);
  const bottom = h - stripH - 2 * k;
  const blockTop = bottom - blockH;

  // soft bottom gradient (from-black/90 via-black/65 via-45% to-transparent), with 24 css px (pt-6) of fade-in headroom
  const gTop = blockTop - 24 * k;
  const g = ctx.createLinearGradient(0, gTop, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.65)');   // via-black/65 at 45% from the bottom
  g.addColorStop(1, 'rgba(0,0,0,0.9)');
  ctx.fillStyle = g;
  ctx.fillRect(0, gTop, w, h - gTop);

  let y = blockTop;
  for (const r of laid) {
    if (r.divider) {
      ctx.fillStyle = 'rgba(255,255,255,0.2)';
      ctx.fillRect(padX, y, availW, r.h);
    } else {
      font(r.weight, r.italic, r.px); track(r.tr * r.px);
      ctx.fillStyle = r.fill;
      const lineH = r.px * LEADING * k;
      r.lines.forEach((line, i) => ctx.fillText(line, cx, y + lineH * i + lineH / 2));
    }
    y += r.h + r.after * k;
  }
  ctx.restore();

  return { blockTop, blockHeight: blockH, blockBottom: bottom, titleBottom, canvasH: h };
}

// Burn the bilingual brand + CTA strip onto an image blob. Returns a NEW blob
// (image/png or image/jpeg, see `format`), or the ORIGINAL blob unchanged on
// any failure / non-image input (never throws).
//
// format: 'png' (default, lossless — unchanged for every existing caller) or
// 'jpeg'. Real on-device diagnostics (Galaxy A13, a weak/budget Android
// device) measured this function costing ~8.7s end to end, with
// canvas.toBlob(..., 'image/png', ...) ALONE accounting for ~8.35s of that —
// drawImage/gradient-fill/fillText (even with shadowBlur, initially
// suspected) combined cost under 15ms. The obvious next guess — JPEG's
// encoder being cheaper than PNG's — was tried and measured WORSE (~13.2s)
// on this exact WebView/Skia build, then reverted. Left here as a documented
// dead end, not a recommendation: don't re-enter that loop without new data.
//
// scale: 1 (default, unchanged) or a factor < 1. Format-agnostic, unlike the
// JPEG experiment above: encode time scales with pixel count regardless of
// codec, and shared images get re-compressed by every social app anyway.
// Multiplies both dimensions BEFORE anything else is computed — every other
// value in this function (pad, brandSize, stripH, the canvas itself) is
// already derived from w/h, so scaling them here is the only change needed;
// drawImage resamples the source image into the smaller canvas for free.
//
// overlay (optional, posters only): { title, credits, rtl, cssWidth, viewportWidth } — also draws the
// poster title and credits block (see drawPosterOverlay). Omitted → output is byte-identical to before.
// strict (optional): rethrow failures instead of returning the untouched blob, so a caller that
// needs the overlay can fall back to another renderer. Default false = never throws, as before.
export async function compositeWatermark(blob, { lang = 'en', format = 'png', scale = 1, overlay = null, strict = false } = {}) {
  if (typeof document === 'undefined' || !blob || !blob.type?.startsWith('image/')) {
    return blob; // SSR, missing blob, or a video (reel) → pass through untouched.
  }
  const mime    = format === 'jpeg' ? 'image/jpeg' : 'image/png';
  const quality = format === 'jpeg' ? 0.92 : 0.95; // quality is a no-op for PNG (lossless) — kept for parity with the prior literal.

  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const naturalW = img.naturalWidth || img.width;
    const naturalH = img.naturalHeight || img.height;
    if (!naturalW || !naturalH) return blob;
    // Scaled once, here — every size below (pad, brandSize, stripH, the
    // canvas, drawImage's destination) already derives from w/h, so nothing
    // else in this function needs to know `scale` exists.
    const w = Math.round(naturalW * scale);
    const h = Math.round(naturalH * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) { if (strict) throw new Error('no 2d context'); return blob; }
    ctx.drawImage(img, 0, 0, w, h);

    const isHe = lang === 'he';
    const copy = WATERMARK_COPY[isHe ? 'he' : 'en'];

    // Everything scales off image width so the mark looks identical at any resolution.
    const pad       = Math.round(w * 0.035);
    const brandSize = Math.max(18, Math.round(w * 0.040));
    const subSize   = Math.max(12, Math.round(w * 0.023));
    const stripH    = Math.round(brandSize + subSize + pad * 1.6);

    // Poster title + credits (posters only). Drawn before the brand strip, which sits below them.
    if (overlay) {
      try {
        await ensureOverlayFonts();
        drawPosterOverlay(ctx, w, h, overlay, stripH);
      } catch (e) {
        if (strict) throw e; // otherwise: ship the image + strip without the overlay
      }
    }

    // Legibility scrim: transparent → dark gradient along the bottom edge.
    const grad = ctx.createLinearGradient(0, h - stripH, 0, h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.70)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, h - stripH, w, stripH);

    // RTL Hebrew anchors to the right edge; LTR English to the left.
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = isHe ? 'right' : 'left';
    ctx.direction = isHe ? 'rtl' : 'ltr';
    const x = isHe ? w - pad : pad;
    const fontStack = '"Heebo", system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.shadowColor = 'rgba(0,0,0,0.55)';

    // Brand wordmark (top line of the strip).
    ctx.font = `700 ${brandSize}px ${fontStack}`;
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.shadowBlur = Math.round(brandSize * 0.25);
    ctx.fillText(copy.brand, x, h - pad - subSize * 1.25);

    // CTA + url (bottom line). Arrow points "forward" per reading direction.
    const arrow = isHe ? '←' : '→';
    ctx.font = `500 ${subSize}px ${fontStack}`;
    ctx.fillStyle = 'rgba(255,255,255,0.82)';
    ctx.shadowBlur = Math.round(subSize * 0.2);
    ctx.fillText(`${copy.cta} ${arrow}  ·  ${copy.url}`, x, h - pad);

    const out = await new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
    if (!out && strict) throw new Error('toBlob returned null');
    return out || blob;
  } catch (err) {
    if (strict) throw err;
    return blob; // decode error / unexpected failure → original, unwatermarked, still shareable.
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Desktop-only: download a blob via a temporary `<a download>`. Stamps the share-loop
// watermark onto images first (videos pass through). Uses an object URL so the composited
// poster/panel is saved, not the raw source image. Returns a boolean so callers can fall
// back. Do NOT call this on touch devices — see the iOS note at the top of this file.
export async function downloadBlob(blob, filename, { lang = 'en', overlay = null, strict = false } = {}) {
  if (typeof document === 'undefined') return false;
  try {
    const stamped = await compositeWatermark(blob, { lang, overlay, strict });
    const url = URL.createObjectURL(stamped);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || 'lifescript.png';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

// Download several blobs in sequence (the desktop "Download comic" action). A short gap
// lets the browser queue each file instead of dropping all but the first.
// items: Array<{ blob, filename }>.
export async function downloadBlobs(items, { lang = 'en' } = {}) {
  let count = 0;
  for (const { blob, filename } of items) {
    if (await downloadBlob(blob, filename, { lang })) count++;
    await new Promise((r) => setTimeout(r, 250));
  }
  return count > 0;
}

// Re-entrancy latch shared by EVERY Web Share call in the app (files, text, url).
// iOS WebKit keeps an internal "a share is already in progress" flag; invoking
// navigator.share() again before the previous call fully settles throws
// InvalidStateError. Without this latch, a fast double-tap — or tapping Share again
// right after dismissing the sheet — fired an overlapping share, and the old error
// fallback (window.open after awaits, which iOS blocks) left the button looking frozen.
// There is only ever one OS share sheet, so a module-level latch is the correct scope.
let sharePending = false;

// True when the rejection is a deliberate OS/user action (not an error we should
// fall back on): the user dismissed the sheet (AbortError) or a share was still
// settling from a rapid double-tap (InvalidStateError). Both cases are "handled"
// — the OS saw the request and the user chose not to proceed. NotAllowedError is
// intentionally excluded: it means the transient-activation window expired (too
// much async work between the tap and navigator.share), and callers must decide
// whether to fall back to a download or retry.
//
// Native (@capacitor/share on Android) has no DOM error names at all — its
// SharePlugin.java rejects with the literal string "Share canceled" when the
// user dismisses the native chooser (confirmed on-device: without this check,
// a cancel was indistinguishable from a real failure and triggered the same
// <a download> fallback shareHandled exists to prevent on the web path).
function shareHandled(err) {
  return err?.name === 'AbortError' || err?.name === 'InvalidStateError'
    || /^share canceled$/i.test(err?.message || '');
}

// Core: hand an array of Files to the OS share sheet. Optional `text` rides along in the
// share payload (used to carry the referral link so every poster share seeds the loop).
async function shareFiles(files, title, text) {
  if (!files.length) return false;
  const native = isCapacitorNative();
  // Native: always "supported" — @capacitor/share doesn't need navigator.share to
  // exist. Web: gate on the same navigator.canShare({files}) check as before,
  // completely unchanged for iOS Safari / desktop / the PWA.
  if (!native && (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare || !navigator.canShare({ files }))) {
    return false;
  }
  if (sharePending) return true; // a sheet is already open/settling — swallow the re-tap
  sharePending = true;
  try {
    if (native) {
      await shareFilesNative(files, title, text);
      return true;
    }
    await navigator.share({ files, title, ...(text ? { text } : {}) });
    return true;
  } catch (err) {
    if (shareHandled(err)) return true;
    // NotAllowedError = activation window expired (async work took too long before
    // navigator.share was called). Return null so callers can distinguish "expired"
    // from "unsupported" (false) and choose the right fallback (download vs open tab).
    // Native errors don't carry this DOM error shape, so they fall through to `false`.
    if (err?.name === 'NotAllowedError') return null;
    return false;
  } finally {
    sharePending = false;
  }
}

// Web Share for plain payloads (text/url, no files): script text, referral link. Shares
// the same latch as file shares so a poster share and a script/referral share can never
// overlap and trip InvalidStateError. Returns true when handled (shared or dismissed),
// false only when Web Share is unavailable so the caller can fall back (copy / email).
export async function shareData({ title, text, url } = {}) {
  const native = isCapacitorNative();
  if (!native && (typeof navigator === 'undefined' || !navigator.share)) return false;
  if (sharePending) return true; // a sheet is already open/settling — swallow the re-tap
  sharePending = true;
  try {
    const payload = {
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      ...(url ? { url } : {}),
    };
    if (native) await Share.share(payload);
    else await navigator.share(payload);
    return true;
  } catch (err) {
    return shareHandled(err);
  } finally {
    sharePending = false;
  }
}

// Build the final, watermarked File for a blob WITHOUT sharing it. Lets callers pre-render
// the share payload in the background (see usePosterGeneration's prewarm) so the eventual
// navigator.share() fires INSIDE the iOS transient-activation window. On slow devices the
// heavy prep (htmlToImage, network fetch, canvas watermark) between the tap and share()
// otherwise overruns activation and throws NotAllowedError — even on the first tap.
//
// format stays PNG everywhere (see compositeWatermark's doc comment — JPEG was
// tried here and measured WORSE on-device, reverted). Native gets scale: 0.75
// (0.75² ≈ 56% of the original pixels) — applies to posters AND comic panels
// (shareBlobs routes through this same function), since both hit the identical
// toBlob bottleneck on the identical device class. On-device measurement
// confirmed this helps substantially on newer/mid-range hardware (167ms-1.6s
// toBlob). On old/weak devices (Galaxy Note9, Android 9) toBlob still varies
// 2.7s-13.4s at the SAME resolution on the SAME device — a device/OS encoder
// characteristic that further pixel-count reduction can't reliably fix, hence
// the "Preparing..." UI indicator on the share buttons instead of chasing
// more encode optimizations here. Web/iOS Safari/desktop stay at scale: 1
// (full res) — no evidence of a problem there.
export async function makeShareFile(blob, filename, { lang = 'en', overlay = null, strict = false } = {}) {
  const scale = isCapacitorNative() ? 0.75 : 1;
  const stamped = await compositeWatermark(blob, { lang, scale, overlay, strict });
  return new File([stamped], filename, { type: stamped.type || blob.type || 'image/png' });
}

// Share an already-prepared File (e.g. one cached by makeShareFile). No compositing happens
// here, so almost nothing runs between the user gesture and navigator.share() — the path
// that keeps slow devices inside the activation window. `text` rides along as the caption.
export async function shareReadyFile(file, title, { text } = {}) {
  return shareFiles([file], title, text);
}

// Share a single blob (poster, comic panel, reel video…). Images get the bilingual
// share-loop watermark; videos pass through compositeWatermark untouched. `text` (e.g. a
// localized caption + referral link) is forwarded to the OS share sheet when provided.
export async function shareBlob(blob, filename, title, { lang = 'en', text } = {}) {
  const file = await makeShareFile(blob, filename, { lang });
  return shareReadyFile(file, title, { text });
}

// Share many blobs at once (the tier-aware "Share all panels" action).
// items: Array<{ blob, filename }> — the caller passes ONLY the assets the user owns.
export async function shareBlobs(items, title, { lang = 'en' } = {}) {
  // Reuses makeShareFile (instead of duplicating its compositeWatermark + File-wrap
  // logic here, as this used to) so the native/JPEG decision lives in exactly one place.
  const files = await Promise.all(items.map(({ blob, filename }) => makeShareFile(blob, filename, { lang })));
  return shareFiles(files, title);
}
