import { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { track } from '@vercel/analytics';
import { getMsg, CODES, isQuotaError } from '../lib/messages.js';
import { useRotatingMessages } from './useRotatingMessages.js';

// ── Panel image state machine ────────────────────────────────────────────────

function panelImagesReducer(state, action) {
  switch (action.type) {
    case 'INIT_ALL': {
      const next = {};
      for (let i = 0; i < action.count; i++) next[i] = { loading: true, url: null, error: false };
      return next;
    }
    case 'INIT_FROM_HISTORY': {
      const next = {};
      action.panels.forEach((p, i) => {
        next[i] = p.imageUrl
          ? { loading: false, url: p.imageUrl, error: false }
          : { loading: false, url: null, error: true };
      });
      return next;
    }
    case 'SET_PANEL':
      return { ...state, [action.idx]: action.payload };
    case 'RESET':
      return {};
    default:
      return state;
  }
}

const STORYBOARD_MESSAGES_HE = ['סורק סצנות...', 'ממפה פאנלים...', 'מדפיס קווי דיו...', 'מסיים ציורים...'];
const STORYBOARD_MESSAGES_EN = ['Scanning scenes...', 'Mapping panels...', 'Inking drawings...', 'Composing frames...'];

/**
 * Manages the full storyboard lifecycle: panel data fetching, per-panel
 * image generation, R2 upload, loading state, error state, and style selection.
 *
 * Image generation is skipped for locked panels (idx >= unlockedPanels) so
 * free-tier users never consume AI credits on content they cannot see.
 *
 * Persistence flow (three phases):
 *   1. Storyboard text arrives → onPanelsGenerated(panels, imageUrl=null each)
 *      Saves the narrative plan immediately even if the user closes early.
 *   2. Each AI image arrives → shown as data URI instantly (zero extra wait).
 *   3. Each image uploads to R2 in the background → CDN URL hot-swaps the
 *      data URI in state; onPanelsGenerated called again with the new URL.
 *      History entry grows richer with each completed upload, never blocks UX.
 *
 * @param {Object}   opts
 * @param {string}   opts.lang             - 'en' | 'he'
 * @param {string}   opts.genre            - Active genre key
 * @param {string}   opts.cleanScript      - Parsed script text (generation input)
 * @param {string}   opts.script           - Raw script prop — reset signal only
 * @param {Function} opts.onAuthRequired   - Called with context on 403
 * @param {Function} opts.onPanelsGenerated - Called with merged panel array
 *   whenever the text or a CDN URL becomes available. Parent persists to history.
 */
export function useStoryboardGeneration({
  lang,
  genre,
  cleanScript,
  script,
  onAuthRequired,
  onPanelsGenerated,
  initialPanels,
  characterImageUrl, // Identity Track — null/undefined → standard generation
  heroDescriptor,    // e.g. 'male hero' — only set when Identity Track is active
}) {
  const isHebrew = lang === 'he';

  const [showStoryboard,      setShowStoryboard]      = useState(false);
  const [storyboardPanels,    setStoryboardPanels]    = useState([]);
  const [storyboardLoading,   setStoryboardLoading]   = useState(false);
  const [storyboardError,     setStoryboardError]     = useState('');
  const [storyboardErrorCode, setStoryboardErrorCode] = useState('');
  const [comicStyle,          setComicStyle]           = useState('anime');
  const [panelImages, dispatchPanelImages]             = useReducer(panelImagesReducer, {});
  const [unlockedPanels,      setUnlockedPanels]       = useState(0);

  // Tracks whether the current generation session is still active.
  // Set to false on reset / close so in-flight callbacks self-abort.
  const storyboardActiveRef = useRef(false);

  // Accumulates R2 CDN URLs as each panel upload completes.
  // Reset at the start of every new generation run.
  const panelCdnUrlsRef = useRef({});

  // Stable ref to the latest onPanelsGenerated callback.
  // Using a ref avoids adding the callback to useCallback dep arrays,
  // which would recreate generateStoryboardImages on every parent render.
  const onPanelsGeneratedRef = useRef(onPanelsGenerated);
  useEffect(() => { onPanelsGeneratedRef.current = onPanelsGenerated; }, [onPanelsGenerated]);

  // Same ref pattern for the Identity Track reference URL: read at fetch time
  // inside the fire-and-forget panel loop without churning the callback.
  const characterImageUrlRef = useRef(characterImageUrl);
  useEffect(() => { characterImageUrlRef.current = characterImageUrl; }, [characterImageUrl]);

  const messages       = isHebrew ? STORYBOARD_MESSAGES_HE : STORYBOARD_MESSAGES_EN;
  const currentMessage = useRotatingMessages(messages, 2200, storyboardLoading);

  // ── Reset on new script / restore from history ──────────────────────────
  useEffect(() => {
    storyboardActiveRef.current = false;
    panelCdnUrlsRef.current     = {};
    setStoryboardError('');
    setStoryboardErrorCode('');

    if (initialPanels && initialPanels.length > 0) {
      // Restore saved panels from history — skip re-generation entirely.
      setStoryboardPanels(initialPanels);
      setUnlockedPanels(initialPanels.length);
      setShowStoryboard(true);
      dispatchPanelImages({ type: 'INIT_FROM_HISTORY', panels: initialPanels });
    } else {
      setShowStoryboard(false);
      setStoryboardPanels([]);
      setUnlockedPanels(0);
      dispatchPanelImages({ type: 'RESET' });
    }
  }, [script, initialPanels]);

  // ── Panel image generation + R2 upload ───────────────────────────────────

  const generateStoryboardImages = useCallback(async (panels, unlocked, sessionId) => {
    // Only initialise loading state for panels that will actually receive images.
    // Locked panels (idx >= unlocked) are rendered by StoryboardView as upgrade
    // teasers and never touch panelImages, so there is no need to track their state.
    dispatchPanelImages({ type: 'INIT_ALL', count: unlocked });

    // Fire requests only for unlocked panels.
    // panel.isLocked guards against edge-cases where the index check alone might
    // not be sufficient (e.g. history restore with a mixed panel array).
    for (const [idx, panel] of panels.entries()) {
      if (idx >= unlocked || panel.isLocked) break;
      if (!storyboardActiveRef.current) break;

      // Each panel is fire-and-forget so they render progressively.
      (async () => {
        try {
          // ── Phase 1: AI image generation ──────────────────────────────────
          const resp = await fetch('/api/generate-poster', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt:      panel.visual,
              genre,
              lang,
              requestType: 'comic',
              panelIndex:  idx,
              // Selective Framing: only HERO panels carry the identity reference.
              // Non-hero panels send no reference → the server degrades them to the
              // free faceless cascade automatically (objects/locations/secondaries).
              characterImageUrl: (panel.hero && characterImageUrlRef.current) ? characterImageUrlRef.current : undefined,
            }),
          });
          const data = await resp.json();
          if (!storyboardActiveRef.current) return;

          if (data.success && data.imageUrl) {
            // ── Phase 2: show data URI immediately (instant UX) ────────────
            dispatchPanelImages({
              type: 'SET_PANEL', idx,
              payload: { loading: false, url: data.imageUrl, error: false },
            });

            // ── Phase 3: background R2 upload (does NOT block the image) ───
            // Determine extension from data URI prefix.
            const ext = data.imageUrl.startsWith('data:image/png') ? 'png' : 'jpg';
            const key = `panels/${sessionId}_${String(idx).padStart(2, '0')}.${ext}`;

            fetch('/api/upload-panel', {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ imageData: data.imageUrl, key }),
            })
              .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
              .then(({ url: cdnUrl }) => {
                if (!cdnUrl || !storyboardActiveRef.current) return;

                // ── Phase 4: hot-swap data URI → permanent CDN URL ──────────
                dispatchPanelImages({
                  type: 'SET_PANEL', idx,
                  payload: { loading: false, url: cdnUrl, error: false },
                });

                // ── Phase 5: persist updated panels to history ──────────────
                // Build the full merged array with all CDN URLs known so far.
                panelCdnUrlsRef.current[idx] = cdnUrl;
                const merged = panels.map((p, i) => ({
                  ...p,
                  imageUrl: panelCdnUrlsRef.current[i] ?? null,
                }));
                onPanelsGeneratedRef.current?.(merged);
              })
              .catch((err) => {
                // Upload failed silently — the data URI keeps displaying for
                // the current session; history entry has imageUrl: null for
                // this panel and can be regenerated later.
                console.warn(`⚠️ R2 upload skipped for panel ${idx}: ${err.message}`);
              });

          } else {
            dispatchPanelImages({
              type: 'SET_PANEL', idx,
              payload: { loading: false, url: null, error: true },
            });
          }
        } catch {
          if (!storyboardActiveRef.current) return;
          dispatchPanelImages({
            type: 'SET_PANEL', idx,
            payload: { loading: false, url: null, error: true },
          });
        }
      })();
    }
  }, [genre, lang]); // onPanelsGeneratedRef is a ref — intentionally excluded from deps

  // ── Storyboard text fetch ─────────────────────────────────────────────────

  const generateStoryboard = useCallback(async () => {
    storyboardActiveRef.current = false;
    panelCdnUrlsRef.current     = {};
    dispatchPanelImages({ type: 'RESET' });
    setStoryboardLoading(true);
    setStoryboardError('');
    setStoryboardErrorCode('');

    const deviceId = typeof window !== 'undefined' ? localStorage.getItem('lifescript_device_id') || '' : '';

    try {
      const response = await fetch('/api/generate-storyboard', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id':  deviceId,
        },
        body: JSON.stringify({ script: cleanScript, lang, genre, comicStyle, deviceId, heroDescriptor: heroDescriptor || undefined }),
      });
      const data = await response.json();

      if (response.status === 403) {
        onAuthRequired?.('comic');
        return;
      }

      if (data.success && data.panels?.length > 0) {
        const unlocked = typeof data.unlockedPanels === 'number'
          ? data.unlockedPanels
          : data.panels.length;

        storyboardActiveRef.current = true;
        setStoryboardPanels(data.panels);
        setUnlockedPanels(unlocked);
        setShowStoryboard(true);
        track('Storyboard Generated', { genre, language: lang });

        // Persist panel text to history immediately (imageUrl: null per panel).
        // Even if the user closes before images finish, the narrative plan is saved.
        onPanelsGeneratedRef.current?.(data.panels.map(p => ({ ...p, imageUrl: null })));

        // Unique session ID scopes all R2 keys for this generation run.
        const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        generateStoryboardImages(data.panels, unlocked, sessionId);

      } else {
        const code = data.code || CODES.STORYBOARD_FAIL;
        setStoryboardErrorCode(code);
        setStoryboardError(getMsg(code, lang));
      }
    } catch {
      const code = (typeof navigator !== 'undefined' && navigator.onLine)
        ? CODES.STORYBOARD_FAIL
        : CODES.NETWORK_OFFLINE;
      setStoryboardErrorCode(code);
      setStoryboardError(getMsg(code, lang));
    } finally {
      setStoryboardLoading(false);
    }
  }, [lang, genre, cleanScript, comicStyle, heroDescriptor, generateStoryboardImages]);

  // ── Close ─────────────────────────────────────────────────────────────────

  const closeStoryboard = useCallback(() => {
    storyboardActiveRef.current = false;
    setShowStoryboard(false);
    setStoryboardPanels([]);
    setUnlockedPanels(0);
    dispatchPanelImages({ type: 'RESET' });
  }, []);

  return {
    showStoryboard,
    storyboardPanels,
    storyboardLoading,
    storyboardError,
    storyboardErrorCode,
    panelImages,
    unlockedPanels,
    comicStyle,
    setComicStyle,
    currentStoryboardMessage: currentMessage,
    generateStoryboard,
    closeStoryboard,
    isQuotaError,
  };
}
