import { useCallback, useState } from 'react';
import { markReported } from '../utils/reported-store.js';

/** SHA-256 (hex) of the decoded bytes of a base64 data URI — the same value the server computes (lib/image-check.js imageHash). */
async function hashDataUri(dataUri) {
  const m = /^data:[^;,]*;base64,(.+)$/s.exec(dataUri || '');
  if (!m || typeof crypto === 'undefined' || !crypto.subtle) return null;
  const bin = atob(m[1]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Sends one report. `sources` are the image URLs (our R2 links) or data: URIs the user is looking at (up to 8; a reel lists its frames).
 * `galleryRef` ('poster:<id>' | 'reel:<id>') reports a static showcase item instead (sources are ignored).
 * Resolves { ok: true } or { ok: false, error: 'rate' | 'invalid' | 'failed' }. On success the sources are remembered as hidden.
 */
export function useReportContent() {
  const [sending, setSending] = useState(false);

  const submit = useCallback(async ({ kind, reason, sources, galleryRef }) => {
    setSending(true);
    try {
      const refs = [];
      if (galleryRef) refs.push({ gallery: galleryRef });   // static gallery item: a lookup key only (lib/gallery-report.js)
      for (const s of (sources || []).slice(0, 8)) {
        if (typeof s !== 'string') continue;
        if (s.startsWith('http')) refs.push({ url: s });
        else if (s.startsWith('data:')) { const hash = await hashDataUri(s); if (hash) refs.push({ hash }); }
      }
      if (!refs.length) return { ok: false, error: 'invalid' };
      const resp = await fetch('/api/report-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, reason, refs }),
      });
      if (resp.status === 429) return { ok: false, error: 'rate' };
      if (resp.status === 400) return { ok: false, error: 'invalid' };
      if (!resp.ok) return { ok: false, error: 'failed' };
      markReported(galleryRef ? [`gallery:${galleryRef}`] : sources);
      return { ok: true };
    } catch {
      return { ok: false, error: 'failed' };
    } finally {
      setSending(false);
    }
  }, []);

  return { submit, sending };
}
