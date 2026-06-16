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

// Max user-initiated panel image replacements per comic. A small budget keeps the
// "try again" cost bounded — each replace is a fresh image generation.
const REGEN_LIMIT = 2;

function makeClientComicSeed() {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
  if (cryptoObj?.getRandomValues) {
    const values = new Uint32Array(2);
    cryptoObj.getRandomValues(values);
    return `${values[0]}${values[1]}`;
  }
  return `${Date.now()}${Math.floor(Math.random() * 1_000_000_000)}`;
}

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
  const [regensLeft,          setRegensLeft]           = useState(REGEN_LIMIT);

  // Tracks whether the current generation session is still active.
  // Set to false on reset / close so in-flight callbacks self-abort.
  const storyboardActiveRef = useRef(false);

  // Set to true by cancelStoryboard() so an in-flight TEXT response
  // (the phase before storyboardActiveRef goes true) is dropped instead
  // of re-opening the storyboard after the user has backed out.
  const storyboardCancelledRef = useRef(false);

  // Accumulates R2 CDN URLs as each panel upload completes.
  // Reset at the start of every new generation run.
  const panelCdnUrlsRef = useRef({});

  // Remembers the R2 key namespace for this run so a later panel REPLACE can mint a fresh,
  // uniquely-keyed object (panel images are cached immutable; reusing a key would let the CDN
  // serve the stale image). Null until the first generation/restore assigns it.
  const panelSessionRef = useRef(null);

  // One seed root per comic run. The server derives panel-specific seeds from this
  // plus panelIndex, keeping character/style randomness coherent across panels.
  const comicSeedRef = useRef(null);

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
    panelSessionRef.current     = null;
    comicSeedRef.current        = null;
    setRegensLeft(REGEN_LIMIT);
    setStoryboardError('');
    setStoryboardErrorCode('');

    if (initialPanels && initialPanels.length > 0) {
      // Restore saved panels from history — skip re-generation entirely.
      // History is a faithful snapshot of what the user actually created: drop any
      // legacy locked teaser panels so a restored comic is never re-gated by quota
      // (older entries, saved before unlockedPanels hit the full count, could still
      // carry isLocked:true and would otherwise show the "Pro Only" card on restore).
      const ownedPanels = initialPanels.filter(p => !p.isLocked);
      // Seed the CDN-url ref so a later REPLACE rebuilds the full history array without
      // dropping the other panels' existing images.
      ownedPanels.forEach((p, i) => { if (p.imageUrl) panelCdnUrlsRef.current[i] = p.imageUrl; });
      setStoryboardPanels(ownedPanels);
      setUnlockedPanels(ownedPanels.length);
      setShowStoryboard(true);
      dispatchPanelImages({ type: 'INIT_FROM_HISTORY', panels: ownedPanels });
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
              comicSeed:   comicSeedRef.current,
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

  // ── Replace a single panel image (user-initiated, budget-limited) ──────────
  // Re-runs image generation for ONE unlocked panel with the same visual prompt (a fresh
  // server-side seed → a new image). The old image stays visible under a spinner, so a
  // failed/placeholder attempt never blanks a good panel and never spends a replacement.
  // Budget (REGEN_LIMIT) is shared across the whole comic.
  const regeneratePanel = useCallback(async (idx) => {
    if (regensLeft <= 0) return;
    if (idx >= unlockedPanels) return;
    const panel = storyboardPanels[idx];
    if (!panel || panel.isLocked || !panel.visual) return;
    const current = panelImages[idx];
    if (current?.loading) return;               // a render is already in flight for this panel
    const oldUrl = current?.url || null;

    // Keep the existing image visible (regenerating flag) instead of resetting to a skeleton.
    dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: true, url: oldUrl, error: false, regenerating: true } });

    try {
      const resp = await fetch('/api/generate-poster', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt:      panel.visual,
          genre,
          lang,
          requestType: 'comic',
          panelIndex:  idx,
          comicSeed:   comicSeedRef.current,
          characterImageUrl: (panel.hero && characterImageUrlRef.current) ? characterImageUrlRef.current : undefined,
        }),
      });
      const data = await resp.json();
      if (!storyboardActiveRef.current) return;  // user closed the storyboard mid-flight

      // A placeholder/failure must NOT replace a good image or burn a replacement.
      if (!data.success || !data.imageUrl || data.isPlaceholder) {
        dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: oldUrl, error: !oldUrl } });
        return;
      }

      // Commit the new image immediately (data URI) and spend one replacement.
      setRegensLeft(n => Math.max(0, n - 1));
      dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: data.imageUrl, error: false } });
      track('Comic Panel Replaced', { genre, language: lang });

      // Background R2 upload under a FRESH key (immutable cache → a reused key would serve the
      // stale image). Hot-swap to the CDN URL, then persist the merged panel array to history.
      const ext = data.imageUrl.startsWith('data:image/png') ? 'png' : 'jpg';
      const sid = panelSessionRef.current || (panelSessionRef.current = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
      const key = `panels/${sid}_${String(idx).padStart(2, '0')}_r${Date.now().toString(36)}.${ext}`;
      fetch('/api/upload-panel', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData: data.imageUrl, key }),
      })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
        .then(({ url: cdnUrl }) => {
          if (!cdnUrl || !storyboardActiveRef.current) return;
          dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: cdnUrl, error: false } });
          panelCdnUrlsRef.current[idx] = cdnUrl;
          const merged = storyboardPanels.map((p, i) => ({
            ...p, imageUrl: panelCdnUrlsRef.current[i] ?? p.imageUrl ?? null,
          }));
          onPanelsGeneratedRef.current?.(merged);
        })
        .catch((err) => console.warn(`⚠️ R2 upload skipped for replaced panel ${idx}: ${err.message}`));
    } catch {
      if (!storyboardActiveRef.current) return;
      dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: oldUrl, error: !oldUrl } });
    }
  }, [regensLeft, unlockedPanels, storyboardPanels, panelImages, genre, lang]);

  // ── Storyboard text fetch ─────────────────────────────────────────────────

  const generateStoryboard = useCallback(async () => {
    storyboardActiveRef.current = false;
    storyboardCancelledRef.current = false;
    panelCdnUrlsRef.current     = {};
    comicSeedRef.current        = makeClientComicSeed();
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

      // User cancelled while the text request was in flight — drop the result.
      if (storyboardCancelledRef.current) return;

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

        // Unique session ID scopes all R2 keys for this generation run (and later replaces).
        const sessionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        panelSessionRef.current = sessionId;
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

  // ── Cancel (during the loading phase, before panels are shown) ──────────────
  // Aborts both the in-flight text fetch (via storyboardCancelledRef) and any
  // panel-image fan-out (via storyboardActiveRef), then restores the idle UI so
  // the GENERATE COMIC button reappears.
  const cancelStoryboard = useCallback(() => {
    storyboardCancelledRef.current = true;
    storyboardActiveRef.current    = false;
    setStoryboardLoading(false);
    setShowStoryboard(false);
    setStoryboardPanels([]);
    setUnlockedPanels(0);
    setStoryboardError('');
    setStoryboardErrorCode('');
    dispatchPanelImages({ type: 'RESET' });
    track('Storyboard Cancelled', { genre, language: lang });
  }, [genre, lang]);

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
    regeneratePanel,
    regensLeft,
    regenLimit: REGEN_LIMIT,
    closeStoryboard,
    cancelStoryboard,
    isQuotaError,
  };
}
