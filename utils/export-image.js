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
 */

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
  let canShareFiles = false;
  try {
    const probe = new File([new Blob(['x'], { type: 'image/png' })], 'probe.png', { type: 'image/png' });
    canShareFiles = !!(navigator.canShare && navigator.canShare({ files: [probe] }));
  } catch {
    canShareFiles = false;
  }
  const isDesktop = !!(window.matchMedia && window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  return { isDesktop, canShareFiles };
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

// Burn the bilingual brand + CTA strip onto an image blob. Returns a NEW image/png blob,
// or the ORIGINAL blob unchanged on any failure / non-image input (never throws).
export async function compositeWatermark(blob, { lang = 'en' } = {}) {
  if (typeof document === 'undefined' || !blob || !blob.type?.startsWith('image/')) {
    return blob; // SSR, missing blob, or a video (reel) → pass through untouched.
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) return blob;

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(img, 0, 0, w, h);

    const isHe = lang === 'he';
    const copy = WATERMARK_COPY[isHe ? 'he' : 'en'];

    // Everything scales off image width so the mark looks identical at any resolution.
    const pad       = Math.round(w * 0.035);
    const brandSize = Math.max(18, Math.round(w * 0.040));
    const subSize   = Math.max(12, Math.round(w * 0.023));
    const stripH    = Math.round(brandSize + subSize + pad * 1.6);

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

    const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png', 0.95));
    return out || blob;
  } catch {
    return blob; // decode error / unexpected failure → original, unwatermarked, still shareable.
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Desktop-only: download a blob via a temporary `<a download>`. Stamps the share-loop
// watermark onto images first (videos pass through). Uses an object URL so the composited
// poster/panel is saved, not the raw source image. Returns a boolean so callers can fall
// back. Do NOT call this on touch devices — see the iOS note at the top of this file.
export async function downloadBlob(blob, filename, { lang = 'en' } = {}) {
  if (typeof document === 'undefined') return false;
  try {
    const stamped = await compositeWatermark(blob, { lang });
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
function shareHandled(err) {
  return err?.name === 'AbortError' || err?.name === 'InvalidStateError';
}

// Core: hand an array of Files to the OS share sheet. Optional `text` rides along in the
// share payload (used to carry the referral link so every poster share seeds the loop).
async function shareFiles(files, title, text) {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
  if (!files.length || !navigator.canShare({ files })) return false;
  if (sharePending) return true; // a sheet is already open/settling — swallow the re-tap
  sharePending = true;
  try {
    await navigator.share({ files, title, ...(text ? { text } : {}) });
    return true;
  } catch (err) {
    if (shareHandled(err)) return true;
    // NotAllowedError = activation window expired (async work took too long before
    // navigator.share was called). Return null so callers can distinguish "expired"
    // from "unsupported" (false) and choose the right fallback (download vs open tab).
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
  if (typeof navigator === 'undefined' || !navigator.share) return false;
  if (sharePending) return true; // a sheet is already open/settling — swallow the re-tap
  sharePending = true;
  try {
    await navigator.share({
      ...(title ? { title } : {}),
      ...(text ? { text } : {}),
      ...(url ? { url } : {}),
    });
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
export async function makeShareFile(blob, filename, { lang = 'en' } = {}) {
  const stamped = await compositeWatermark(blob, { lang });
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
  const files = await Promise.all(items.map(async ({ blob, filename }) => {
    const stamped = await compositeWatermark(blob, { lang });
    return new File([stamped], filename, { type: stamped.type || blob.type || 'image/png' });
  }));
  return shareFiles(files, title);
}
