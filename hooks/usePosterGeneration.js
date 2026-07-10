import { useState, useRef, useCallback } from 'react';
import * as htmlToImage from 'html-to-image';
import { track } from '@vercel/analytics';
import { getMsg, CODES } from '../lib/messages.js';
import { getGenreLabel } from '../constants/genres.js';
import { useRotatingMessages } from './useRotatingMessages.js';
import { shareReadyFile, makeShareFile, downloadBlob, exportCapabilities, urlToBlob } from '../utils/export-image.js';

const POSTER_MESSAGES_HE = [
  'מנתח את האסתטיקה של התסריט...',
  'מלהק כוכבים לפוסטר הרשמי...',
  'מעצב את התאורה בסט הצילומים...',
  'בונה את הקומפוזיציה הויזואלית...',
  'מלטש את הצבעים והפילטרים...',
  'מרנדר את הפוסטר ב-4K...',
  'תולה את הפוסטר בבכורה העולמית...',
];
const POSTER_MESSAGES_EN = [
  'Analyzing script aesthetics...',
  'Casting stars for the poster...',
  'Setting the cinematic lights...',
  'Building visual composition...',
  'Color grading and filtering...',
  'Rendering poster in 4K...',
  'Hanging the poster for the premiere...',
];

/**
 * Manages all poster generation state, the image-capture pipeline,
 * and the loading-message rotation.
 *
 * @param {Object}   opts
 * @param {string}   opts.lang             - 'en' | 'he'
 * @param {string}   opts.genre            - Active genre key
 * @param {string}   opts.visualPrompt     - Extracted [image:] prompt from the script
 * @param {string}   opts.posterTitle      - Film title extracted from the script text
 * @param {boolean}  opts.isHebrew         - Derived from the script text (not lang prop)
 * @param {string}   opts.finalProducerName
 * @param {Function} opts.onPosterGenerated - Called with the final imageUrl on success
 * @param {Function} opts.onAuthRequired  - Called with context string when the API returns 403
 */
export function usePosterGeneration({
  lang,
  genre,
  visualPrompt,
  posterTitle,
  isHebrew,
  finalProducerName,
  onPosterGenerated,
  onAuthRequired,
  characterImageUrl, // Identity Track — null/undefined → standard generation
}) {
  const [posterUrl,     setPosterUrl]     = useState('');
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterError,   setPosterError]   = useState('');
  const [showPoster,    setShowPoster]    = useState(false);
  const [triggerFlash,  setTriggerFlash]  = useState(false);

  const posterRef = useRef(null);
  // Tracks whether the current generation run is still active.
  // cancelPoster() flips it to false so an in-flight response self-aborts
  // and never writes stale state back after the user has backed out.
  const posterActiveRef = useRef(false);

  // The signed-in user's referral link, prefetched so it's ready synchronously at share
  // time (navigator.share needs the user gesture — we can't await a fetch inside it).
  // undefined = not yet fetched; null = anonymous / in-flight; string = ready.
  const referralLinkRef = useRef(undefined);
  const ensureReferralLink = useCallback(() => {
    if (referralLinkRef.current !== undefined) return; // already fetched or in-flight
    referralLinkRef.current = null;                    // mark in-flight (also anon fallback)
    fetch('/api/referral', { credentials: 'include' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d?.link) referralLinkRef.current = d.link; })
      .catch(() => {});
  }, []);

  const messages      = isHebrew ? POSTER_MESSAGES_HE : POSTER_MESSAGES_EN;
  const currentMessage = useRotatingMessages(messages, 2800, posterLoading);

  // ── Generation ──────────────────────────────────────────────────────────────

  const generatePoster = useCallback(async () => {
    posterActiveRef.current = true;
    setPosterLoading(true);
    setPosterError('');
    setShowPoster(true);
    ensureReferralLink(); // warm the referral link in the background for share-time



    const genreTag = getGenreLabel(genre, 'en');
    const prompt   = `A textless movie poster style, depicting: ${visualPrompt}. Genre: ${genreTag}. High budget Hollywood production, epic scale, 8k, ultra-detailed, sharp focus. (NO TEXT)`;
    const deviceId = typeof window !== 'undefined' ? localStorage.getItem('lifescript_device_id') || '' : '';

    try {
      const response = await fetch('/api/generate-poster', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id':  deviceId,
        },
        body: JSON.stringify({ prompt, genre, lang, deviceId, characterImageUrl: characterImageUrl || undefined }),
      });
      const data = await response.json();

      // User cancelled while the request was in flight — drop the result.
      if (!posterActiveRef.current) return;

      if (response.status === 403) {
        setPosterLoading(false);
        setShowPoster(false);
        onAuthRequired?.('poster');
        return;
      }

      if (response.status === 429) {
        setPosterError(getMsg(data.code || CODES.QUOTA_POSTER, lang));
        setPosterLoading(false);
        return;
      }

      if (data.isPlaceholder) {
        setPosterError(getMsg(CODES.PROVIDERS_BUSY, lang));
        setPosterLoading(false);
        return;
      }

      if (data.success && data.imageUrl) {
        // Phase 1: show the data URI immediately — zero extra wait.
        setPosterUrl(data.imageUrl);
        onPosterGenerated?.(data.imageUrl);

        // GA4 viral-funnel: this poster activated a pending referral (rewarded the inviter).
        if (data.referralGranted && typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'referral_activated', { genre });
        }

        // Phase 2: upload to R2 in the background — same hot-swap pattern as panels.
        // On success, replace the data URI with the permanent CDN URL in both
        // local state and the history entry so the thumbnail and future reel
        // generation always reference a stable, proxy-safe CDN URL.
        const ext = data.imageUrl.startsWith('data:image/png') ? 'png' : 'jpg';
        const key = `posters/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
        fetch('/api/upload-panel', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ imageData: data.imageUrl, key }),
        })
          .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
          .then(({ url: cdnUrl }) => {
            if (!cdnUrl || !posterActiveRef.current) return;
            // Only persist the CDN URL to history — do NOT swap the displayed
            // posterUrl.  Replacing the src mid-render causes the browser to blank
            // the <img> element immediately while the proxy fetch is in flight
            // (~1 s), making the poster disappear even though posterLoading=false.
            // The data URI already loaded and visible; it stays as the display URL
            // for the lifetime of this session.
            onPosterGenerated?.(cdnUrl);
          })
          .catch(err => console.warn(`⚠️ Poster R2 upload skipped: ${err.message}`));
      } else {
        setPosterError(getMsg(data.code || CODES.POSTER_FAIL, lang));
        setPosterLoading(false);
      }
    } catch {
      setPosterError(getMsg(
        (typeof navigator !== 'undefined' && navigator.onLine) ? CODES.POSTER_FAIL : CODES.NETWORK_OFFLINE,
        lang
      ));
      setPosterLoading(false);
    }
  }, [lang, genre, visualPrompt, onPosterGenerated, characterImageUrl]);

  // ── Capture (share only) ────────────────────────────────────────────────────

  // Cache of the watermarked, share-ready File for the poster currently on screen,
  // tagged with the posterUrl it was built from so a stale render (from a previous poster)
  // is never shared. shareFileRef holds the finished File; prewarmRef dedupes an in-flight
  // background render so a tap and the eager pre-warm don't render twice.
  const shareFileRef = useRef({ url: null, file: null });
  const prewarmRef   = useRef(null);

  const posterFilename = useCallback(
    () => `poster-${(posterTitle || 'movie-poster').replace(/\s+/g, '-')}.png`,
    [posterTitle],
  );

  // Render the poster DOM to a PNG blob. This is the expensive part (img.decode +
  // settle + two html-to-image passes); it MUST run before the user gesture on slow
  // devices, hence the pre-warm below.
  const renderPosterBlob = useCallback(async () => {
    if (!posterRef.current || !posterUrl) return null;

    const img = posterRef.current.querySelector('img');
    if (img) await img.decode().catch(() => {});
    await new Promise(r => setTimeout(r, 400));

    const rect   = posterRef.current.getBoundingClientRect();
    const width  = Math.floor(rect.width);
    const height = Math.floor(rect.height);

    const sharedOptions = {
      width, height, quality: 0.95, pixelRatio: 2,
      skipFonts: true, fontEmbedCSS: '', cacheBust: false,
      filter: (node) => {
        const tag = node.tagName?.toUpperCase() || '';
        if ((tag === 'LINK' || tag === 'STYLE') && node.href && !node.href.includes(window.location.hostname)) {
          return false;
        }
        return true;
      },
      style: {
        transform: 'scale(1)', margin: '0', padding: '0',
        left: '0', top: '0', borderRadius: '3.5rem', overflow: 'visible',
      },
    };

    try {
      // Warm-up pass to pre-cache cross-origin resources.
      await htmlToImage.toPng(posterRef.current, { ...sharedOptions, quality: 0.1 });
      const dataUrl = await htmlToImage.toPng(posterRef.current, sharedOptions);
      return await urlToBlob(dataUrl);
    } catch (err) {
      console.error('[renderPosterBlob] html-to-image failed:', err);
      return null;
    }
  }, [posterUrl, posterTitle]);

  // Pre-render the watermarked share File in the BACKGROUND, before the user taps Share.
  // This is the slow-device fix: at tap time the heavy work is already done, so the share
  // path runs only shareReadyFile() → navigator.share() fires instantly, inside iOS's
  // transient-activation window (otherwise NotAllowedError on slow phones). No-op on
  // desktop (downloads, no native share) and idempotent per poster. Returns the in-flight
  // promise so callers can await a pre-warm that is already running.
  const prewarmPosterShare = useCallback(() => {
    if (typeof window === 'undefined' || !posterUrl) return null;
    if (exportCapabilities().isDesktop) return null;
    if (shareFileRef.current.url === posterUrl && shareFileRef.current.file) return null; // ready
    if (prewarmRef.current) return prewarmRef.current; // already rendering

    const url = posterUrl;
    // Fetch the poster source directly instead of running html-to-image.
    // html-to-image blocks the main thread for 1-3 s on slow phones (DOM clone +
    // canvas draws), causing visible UI jank and expiring iOS's transient-activation
    // window so navigator.share() always throws NotAllowedError.  A same-origin
    // fetch completes in <200 ms for data URIs and <500 ms for proxied CDN URLs —
    // the share file is ready long before the user's tap.
    const src = posterUrl.startsWith('http')
      ? `/api/proxy-image?url=${encodeURIComponent(posterUrl)}`
      : posterUrl;
    prewarmRef.current = urlToBlob(src)
      .then(blob => makeShareFile(blob, posterFilename(), { lang }))
      .then(file => { shareFileRef.current = { url, file }; return file; })
      .catch(() => null)
      .finally(() => { prewarmRef.current = null; });
    return prewarmRef.current;
  }, [posterUrl, lang, posterFilename]);

  // mode: 'auto' (desktop ⇒ download, mobile ⇒ share) | 'download' | 'share'.
  const handleCapturePoster = useCallback(async (mode = 'auto') => {
    if (!posterRef.current || !posterUrl) return;

    const { isDesktop } = exportCapabilities();
    // On mobile, <a download> either navigates the iOS tab or saves to the Downloads
    // folder — neither is the "Save to Camera Roll" flow the user expects. Route ALL
    // mobile paths through the share sheet; only desktop takes the direct download path.
    const wantDownload = isDesktop && (mode === 'download' || mode === 'auto');
    const method = wantDownload ? 'download' : 'share';

    track('Poster Shared', { genre, language: lang, title: posterTitle, method });
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'content_export', { method, genre, title: posterTitle });
    }

    try {
      // Desktop ⇒ clean `<a download>` of the composited poster (never navigates the SPA).
      if (wantDownload) {
        let blob = await renderPosterBlob();
        if (!blob) {
          // html-to-image failed (canvas taint, zero-size element, etc.) — fall back to
          // fetching the raw poster image directly.  The CSS title/credits overlay is lost
          // but the user still gets the AI-generated image with the watermark applied.
          try {
            const src = posterUrl.startsWith('http')
              ? `/api/proxy-image?url=${encodeURIComponent(posterUrl)}`
              : posterUrl;
            blob = await urlToBlob(src);
          } catch { /* silent */ }
        }
        if (blob) await downloadBlob(blob, posterFilename(), { lang });
        return;
      }

      // Mobile ⇒ Web Share API. Prefer the pre-warmed File so navigator.share() fires
      // instantly inside the activation window. If the pre-warm hasn't finished (or never
      // started), await/run it now — no worse than the pre-fix behaviour, and the result
      // is cached for the next tap.
      let file = (shareFileRef.current.url === posterUrl) ? shareFileRef.current.file : null;
      if (!file) {
        const p = prewarmPosterShare();
        if (p) await p;
        file = (shareFileRef.current.url === posterUrl) ? shareFileRef.current.file : null;
      }
      if (!file) {
        if (isDesktop) {
          // Desktop: html-to-image to capture the CSS title/credits overlay.
          const blob = await renderPosterBlob();
          if (blob) file = await makeShareFile(blob, posterFilename(), { lang });
        } else {
          // Mobile: fast direct fetch — no CSS overlays, but stays inside iOS's
          // transient-activation window (html-to-image takes 2-3 s and kills it).
          try {
            const src = posterUrl.startsWith('http')
              ? `/api/proxy-image?url=${encodeURIComponent(posterUrl)}`
              : posterUrl;
            const blob = await urlToBlob(src);
            file = await makeShareFile(blob, posterFilename(), { lang });
          } catch { /* silent */ }
        }
      }
      // All paths failed — only open a new tab on desktop (iOS blocks window.open
      // in async handlers; a popup-blocked no-op looks like a frozen button to the user).
      if (!file) { if (isDesktop && posterUrl) window.open(posterUrl, '_blank'); return; }

      // CRITICAL (iOS share behaviour): WhatsApp / iMessage downgrade a file share to a
      // *link card* — dropping the image entirely — the instant the share text contains a
      // URL. The poster image is the whole point of the share, so we send a clean caption
      // with NO URL. Share-loop attribution is preserved by the bilingual `lifescript.app`
      // watermark burned into the image (see compositeWatermark in utils/export-image.js);
      // the clickable, coded referral link has its own dedicated path in ReferralModal.
      const caption = isHebrew ? 'נוצר ב-LIFESCRIPT 🎬' : 'Made with LIFESCRIPT 🎬';
      const shared = await shareReadyFile(file, posterTitle || 'My Poster', { text: caption });
      if (shared === null && isDesktop) {
        // Activation window expired (desktop) — download the pre-watermarked file.
        const fileUrl = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = fileUrl; a.download = posterFilename(); a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
        return;
      }
      if (shared !== true && !isDesktop) {
        // Mobile: share failed (activation expired or file sharing not supported).
        // Fall back to <a download> — on Android this saves to Files; on modern iOS
        // it opens the Downloads manager rather than navigating the page.
        const fileUrl = URL.createObjectURL(file);
        const a = document.createElement('a');
        a.href = fileUrl; a.download = posterFilename(); a.rel = 'noopener';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(fileUrl), 1000);
        return;
      }
      // false = Web Share not supported on this browser — last resort new tab on desktop.
      if (!shared && isDesktop && posterUrl) window.open(posterUrl, '_blank');
    } catch (err) {
      console.error('Poster capture error:', err);
      if (isDesktop && posterUrl) window.open(posterUrl, '_blank');
    }
  }, [posterUrl, posterTitle, isHebrew, finalProducerName, genre, lang, renderPosterBlob, posterFilename, prewarmPosterShare]);

  // ── Reset (called by ScriptOutput when a new script arrives) ────────────────

  const resetPoster = useCallback(() => {
    posterActiveRef.current = false;
    shareFileRef.current = { url: null, file: null }; // drop the stale share render
    prewarmRef.current = null;
    setShowPoster(false);
    setPosterUrl('');
    setPosterError('');
    setPosterLoading(false);
    setTriggerFlash(false);
  }, []);

  // Cancel an in-flight poster generation and restore the pre-poster UI.
  // posterActiveRef is flipped first so any pending fetch resolution self-aborts.
  const cancelPoster = useCallback(() => {
    track('Poster Cancelled', { genre, language: lang });
    resetPoster();
  }, [resetPoster, genre, lang]);

  return {
    posterUrl,    setPosterUrl,
    posterLoading, setPosterLoading,
    posterError,  setPosterError,
    showPoster,   setShowPoster,
    triggerFlash, setTriggerFlash,
    posterRef,
    currentPosterMessage: currentMessage,
    generatePoster,
    handleCapturePoster,
    prewarmPosterShare,
    resetPoster,
    cancelPoster,
  };
}
