/**
 * Reliable cross-platform image export (download / share).
 *
 * THE MOBILE BUG THIS SOLVES: iOS Safari (and some Android webviews) ignore the
 * `<a download>` attribute when the href is a `data:` or `blob:` URL, and instead
 * NAVIGATE the current tab to that URL. Inside our SPA/PWA that tears the whole app
 * down — the "download works but the page refreshes and loses state" symptom.
 *
 * The Web Share API is the only dependable "Save Image" path on iOS, so we prefer it
 * on mobile for BOTH download and share. Desktop keeps a true anchor-download (which
 * works there) using a short-lived blob URL — never a data: URL. Nothing here ever
 * navigates the top-level page.
 */

export const isMobile = () =>
  typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Anchor-download via a short-lived blob URL (never a data: URL — those trigger the iOS
// navigation bug and balloon memory). Desktop path.
function anchorDownload(blob, filename) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revoke after the click has consumed the URL.
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

// Returns true when the OS share sheet handled it (including a user-cancel), so the
// caller must NOT fall through to a navigation. Returns false only when sharing files
// is genuinely unsupported on this platform.
async function tryShareFile(blob, filename, title) {
  if (typeof navigator === 'undefined' || !navigator.share || !navigator.canShare) return false;
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  if (!navigator.canShare({ files: [file] })) return false;
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (err) {
    // User dismissed the share sheet — treat as handled; never navigate as a "fallback".
    if (err?.name === 'AbortError') return true;
    return false;
  }
}

/**
 * Save/share an image blob to the device.
 *   action 'share'    → share sheet first on every platform; anchor-download fallback.
 *   action 'download' → mobile: share sheet (the only reliable iOS "Save Image");
 *                       desktop: straight anchor-download.
 * Preserves SPA state because it never navigates the page.
 *
 * @param {Blob} blob
 * @param {string} filename
 * @param {{ action?: 'download'|'share', title?: string }} [opts]
 */
export async function exportImageBlob(blob, filename, { action = 'download', title } = {}) {
  if (action === 'share' || isMobile()) {
    const handled = await tryShareFile(blob, filename, title);
    if (handled) return;
  }
  anchorDownload(blob, filename);
}
