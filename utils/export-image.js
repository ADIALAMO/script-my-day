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
