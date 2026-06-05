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

// Desktop-only: download a blob via a temporary `<a download>`. Uses an object URL so
// the composited (overlaid) poster/panel is saved, not the raw source image. Returns a
// boolean so callers can fall back. Do NOT call this on touch devices — see the iOS note
// at the top of this file.
export function downloadBlob(blob, filename) {
  if (typeof document === 'undefined') return false;
  try {
    const url = URL.createObjectURL(blob);
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
export async function downloadBlobs(items) {
  let count = 0;
  for (const { blob, filename } of items) {
    if (downloadBlob(blob, filename)) count++;
    await new Promise((r) => setTimeout(r, 250));
  }
  return count > 0;
}

// Core: hand an array of Files to the OS share sheet.
async function shareFiles(files, title) {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
  if (!files.length || !navigator.canShare({ files })) return false;
  try {
    await navigator.share({ files, title });
    return true;
  } catch (err) {
    // User dismissed the sheet — treat as handled; never fall through to navigation.
    return err?.name === 'AbortError';
  }
}

// Share a single blob (poster, comic panel, reel video…).
export async function shareBlob(blob, filename, title) {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  return shareFiles([file], title);
}

// Share many blobs at once (the tier-aware "Share all panels" action).
// items: Array<{ blob, filename }> — the caller passes ONLY the assets the user owns.
export async function shareBlobs(items, title) {
  const files = items.map(({ blob, filename }) =>
    new File([blob], filename, { type: blob.type || 'image/png' }));
  return shareFiles(files, title);
}
