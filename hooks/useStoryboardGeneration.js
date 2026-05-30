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
 * image generation, loading state, error state, and comic style selection.
 * Self-resets whenever the parent `script` prop changes.
 *
 * @param {Object} opts
 * @param {string} opts.lang        - 'en' | 'he'
 * @param {string} opts.genre       - Active genre key
 * @param {string} opts.cleanScript - Parsed script text (used as generation input)
 * @param {string} opts.script      - Raw script prop — used only as a reset signal
 */
export function useStoryboardGeneration({ lang, genre, cleanScript, script }) {
  const isHebrew = lang === 'he';

  const [showStoryboard,    setShowStoryboard]    = useState(false);
  const [storyboardPanels,  setStoryboardPanels]  = useState([]);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [storyboardError,   setStoryboardError]   = useState('');
  const [storyboardErrorCode, setStoryboardErrorCode] = useState('');
  const [comicStyle,        setComicStyle]         = useState('anime');
  const [panelImages, dispatchPanelImages]         = useReducer(panelImagesReducer, {});

  const storyboardActiveRef = useRef(false);

  const messages       = isHebrew ? STORYBOARD_MESSAGES_HE : STORYBOARD_MESSAGES_EN;
  const currentMessage = useRotatingMessages(messages, 2200, storyboardLoading);

  // Reset all storyboard state whenever a new script arrives.
  useEffect(() => {
    storyboardActiveRef.current = false;
    setShowStoryboard(false);
    setStoryboardPanels([]);
    setStoryboardError('');
    setStoryboardErrorCode('');
    dispatchPanelImages({ type: 'RESET' });
  }, [script]);

  // ── Panel image generation ────────────────────────────────────────────────

  const generateStoryboardImages = useCallback(async (panels) => {
    dispatchPanelImages({ type: 'INIT_ALL', count: panels.length });

    // Dispatch panel requests with a client-side stagger so they arrive at the server
    // 2 000ms apart. This matches the server-side stagger window (idx * 2000ms) and
    // ensures panel 1 does NOT hit the server before panel 0 has had time to write its
    // circuit-breaker failure to Redis (~120ms round-trip). Without this stagger, all 7
    // requests arrive simultaneously and read a clean circuit state — none of them benefit
    // from panel 0's Gemini failure — causing a burst of Gemini hits or Pollinations hits.
    //
    // Each fetch is NOT awaited inline; it runs in the background and updates state
    // independently via dispatchPanelImages, preserving the progressive-loading UX where
    // panels fill in as they complete rather than all at once at the end.
    for (const [idx, panel] of panels.entries()) {
      if (!storyboardActiveRef.current) break;

      // Fire and forget — panel fills in when the provider responds.
      (async () => {
        try {
          const resp = await fetch('/api/generate-poster', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              prompt: panel.visual,
              genre,
              lang,
              requestType: 'comic',
              panelIndex: idx,
            }),
          });
          const data = await resp.json();
          if (!storyboardActiveRef.current) return;
          if (data.success && data.imageUrl) {
            dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: data.imageUrl, error: false } });
          } else {
            dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: null, error: true } });
          }
        } catch {
          if (!storyboardActiveRef.current) return;
          dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: null, error: true } });
        }
      })();

      // Wait before launching the next panel so the server-side circuit breaker state
      // has time to be written by the previous panel's request. Skip the delay after
      // the last panel — no next request to stagger.
      if (idx < panels.length - 1) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }, [genre, lang]);

  // ── Storyboard fetch ──────────────────────────────────────────────────────

  const generateStoryboard = useCallback(async () => {
    storyboardActiveRef.current = false;
    dispatchPanelImages({ type: 'RESET' });
    setStoryboardLoading(true);
    setStoryboardError('');
    setStoryboardErrorCode('');

    const deviceId = typeof window !== 'undefined' ? localStorage.getItem('lifescript_device_id') || '' : '';
    const adminKey = typeof window !== 'undefined' ? localStorage.getItem('lifescript_admin_key') || '' : '';

    try {
      const response = await fetch('/api/generate-storyboard', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id':  deviceId,
          'x-admin-key':  adminKey,
        },
        body: JSON.stringify({ script: cleanScript, lang, genre, comicStyle, deviceId }),
      });
      const data = await response.json();

      if (data.success && data.panels?.length > 0) {
        storyboardActiveRef.current = true;
        setStoryboardPanels(data.panels);
        setShowStoryboard(true);
        track('Storyboard Generated', { genre, language: lang });
        generateStoryboardImages(data.panels);
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
  }, [lang, genre, cleanScript, comicStyle, generateStoryboardImages]);

  // ── Close ─────────────────────────────────────────────────────────────────

  const closeStoryboard = useCallback(() => {
    storyboardActiveRef.current = false;
    setShowStoryboard(false);
    setStoryboardPanels([]);
    dispatchPanelImages({ type: 'RESET' });
  }, []);

  return {
    showStoryboard,
    storyboardPanels,
    storyboardLoading,
    storyboardError,
    storyboardErrorCode,
    panelImages,
    comicStyle,
    setComicStyle,
    currentStoryboardMessage: currentMessage,
    generateStoryboard,
    closeStoryboard,
    isQuotaError,
  };
}
