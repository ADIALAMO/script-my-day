import { useState, useRef, useCallback } from 'react';
import * as htmlToImage from 'html-to-image';
import { track } from '@vercel/analytics';
import { getMsg, CODES } from '../lib/messages.js';
import { getGenreLabel } from '../constants/genres.js';
import { useRotatingMessages } from './useRotatingMessages.js';
import { shareBlob, downloadBlob, exportCapabilities } from '../utils/export-image.js';
import { withUtmMedium } from '../utils/referral-link.js';

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

  // mode: 'auto' (desktop ⇒ download, mobile ⇒ share) | 'download' | 'share'.
  const handleCapturePoster = useCallback(async (mode = 'auto') => {
    if (!posterRef.current || !posterUrl) return;

    const { isDesktop } = exportCapabilities();
    const wantDownload = mode === 'download' || (mode === 'auto' && isDesktop);
    const method = wantDownload ? 'download' : 'share';

    track('Poster Shared', { genre, language: lang, title: posterTitle, method });
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'content_export', { method, genre, title: posterTitle });
    }

    try {
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

      // Warm-up pass to pre-cache cross-origin resources.
      await htmlToImage.toPng(posterRef.current, { ...sharedOptions, quality: 0.1 });
      const dataUrl = await htmlToImage.toPng(posterRef.current, sharedOptions);

      // Convert to a blob once. Desktop ⇒ clean `<a download>` of the composited poster
      // (never navigates the SPA). Mobile ⇒ Web Share API ("Save Image" / social sheet),
      // which is the platform-native save path and also never navigates — fixing the iOS
      // "share then refresh, lose all state" bug. If file-share is unsupported, fall back
      // to opening the poster in a new tab so the user can still save it.
      const blob = await (await fetch(dataUrl)).blob();
      const filename = `poster-${(posterTitle || 'movie-poster').replace(/\s+/g, '-')}.png`;
      if (wantDownload) {
        const ok = await downloadBlob(blob, filename, { lang });
        if (!ok && posterUrl) window.open(posterUrl, '_blank');
        return;
      }
      const link = referralLinkRef.current ? withUtmMedium(referralLinkRef.current, 'poster_share') : null;
      const caption = isHebrew ? 'נוצר ב-LIFESCRIPT 🎬 צרו את שלכם:' : 'Made with LIFESCRIPT 🎬 Create yours:';
      const text = link ? `${caption} ${link}` : (isHebrew ? 'נוצר ב-LIFESCRIPT 🎬' : 'Made with LIFESCRIPT 🎬');
      const shared = await shareBlob(blob, filename, posterTitle || 'My Poster', { lang, text });
      if (!shared && posterUrl) window.open(posterUrl, '_blank');
    } catch (err) {
      console.error('Poster capture error:', err);
      if (posterUrl) window.open(posterUrl, '_blank');
    }
  }, [posterUrl, posterTitle, isHebrew, finalProducerName, genre, lang]);

  // ── Reset (called by ScriptOutput when a new script arrives) ────────────────

  const resetPoster = useCallback(() => {
    posterActiveRef.current = false;
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
    resetPoster,
    cancelPoster,
  };
}
