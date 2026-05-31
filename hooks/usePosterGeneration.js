import { useState, useRef, useCallback } from 'react';
import * as htmlToImage from 'html-to-image';
import { track } from '@vercel/analytics';
import { getMsg, CODES } from '../lib/messages.js';
import { getGenreLabel } from '../constants/genres.js';
import { useRotatingMessages } from './useRotatingMessages.js';

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
}) {
  const [posterUrl,     setPosterUrl]     = useState('');
  const [posterLoading, setPosterLoading] = useState(false);
  const [posterError,   setPosterError]   = useState('');
  const [showPoster,    setShowPoster]    = useState(false);
  const [triggerFlash,  setTriggerFlash]  = useState(false);

  const posterRef = useRef(null);

  const messages      = isHebrew ? POSTER_MESSAGES_HE : POSTER_MESSAGES_EN;
  const currentMessage = useRotatingMessages(messages, 2800, posterLoading);

  // ── Generation ──────────────────────────────────────────────────────────────

  const generatePoster = useCallback(async () => {
    setPosterLoading(true);
    setPosterError('');
    setShowPoster(true);

    const genreTag = getGenreLabel(genre, 'en');
    const prompt   = `A textless movie poster style, depicting: ${visualPrompt}. Genre: ${genreTag}. High budget Hollywood production, epic scale, 8k, ultra-detailed, sharp focus. (NO TEXT)`;
    const deviceId = typeof window !== 'undefined' ? localStorage.getItem('lifescript_device_id') || '' : '';
    const adminKey = typeof window !== 'undefined' ? localStorage.getItem('lifescript_admin_key') || '' : '';

    try {
      const response = await fetch('/api/generate-poster', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id':  deviceId,
          'x-admin-key':  adminKey,
        },
        body: JSON.stringify({ prompt, genre, lang, deviceId }),
      });
      const data = await response.json();

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
        setPosterUrl(data.imageUrl);
        onPosterGenerated?.(data.imageUrl);
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
  }, [lang, genre, visualPrompt, onPosterGenerated]);

  // ── Capture (download / share) ──────────────────────────────────────────────

  const handleCapturePoster = useCallback(async (action) => {
    if (!posterRef.current || !posterUrl) return;

    track(action === 'download' ? 'Poster Downloaded' : 'Poster Shared', {
      genre, language: lang, title: posterTitle,
    });
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'content_export', { method: action, genre, title: posterTitle });
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

      if (action === 'download') {
        const link      = document.createElement('a');
        link.href       = dataUrl;
        link.download   = `poster-${(posterTitle || 'movie-poster').replace(/\s+/g, '-')}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else if (action === 'share') {
        const res  = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], 'movie-poster.png', { type: 'image/png' });

        if (navigator.share && navigator.canShare?.({ files: [file] })) {
          try {
            await navigator.share({ files: [file], title: posterTitle || 'My Poster' });
          } catch (err) {
            if (err.name !== 'AbortError') throw err;
          }
        } else {
          const link    = document.createElement('a');
          link.href     = dataUrl;
          link.download = 'poster.png';
          link.click();
        }
      }
    } catch (err) {
      console.error('Poster capture error:', err);
      if (posterUrl) window.open(posterUrl, '_blank');
    }
  }, [posterUrl, posterTitle, isHebrew, finalProducerName, genre, lang]);

  // ── Reset (called by ScriptOutput when a new script arrives) ────────────────

  const resetPoster = useCallback(() => {
    setShowPoster(false);
    setPosterUrl('');
    setPosterError('');
    setPosterLoading(false);
    setTriggerFlash(false);
  }, []);

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
  };
}
