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
 * Image generation is intentionally skipped for locked panels (idx >= unlockedPanels)
 * so free-tier users never consume Cloudflare / OpenRouter credits on content they
 * cannot see. StoryboardView renders a blur/lock overlay for those slots instead.
 *
 * @param {Object} opts
 * @param {string} opts.lang        - 'en' | 'he'
 * @param {string} opts.genre       - Active genre key
 * @param {string} opts.cleanScript - Parsed script text (used as generation input)
 * @param {string} opts.script      - Raw script prop — used only as a reset signal
 * @param {Function} opts.onAuthRequired - Called with context string when API returns 403
 */
export function useStoryboardGeneration({ lang, genre, cleanScript, script, onAuthRequired }) {
  const isHebrew = lang === 'he';

  const [showStoryboard,    setShowStoryboard]    = useState(false);
  const [storyboardPanels,  setStoryboardPanels]  = useState([]);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [storyboardError,   setStoryboardError]   = useState('');
  const [storyboardErrorCode, setStoryboardErrorCode] = useState('');
  const [comicStyle,        setComicStyle]         = useState('anime');
  const [panelImages, dispatchPanelImages]         = useReducer(panelImagesReducer, {});
  const [unlockedPanels,    setUnlockedPanels]     = useState(0);

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
    setUnlockedPanels(0);
    dispatchPanelImages({ type: 'RESET' });
  }, [script]);

  // ── Panel image generation ────────────────────────────────────────────────

  const generateStoryboardImages = useCallback(async (panels, unlocked) => {
    dispatchPanelImages({ type: 'INIT_ALL', count: panels.length });

    // Fire image requests only for unlocked panels. Locked panels (idx >= unlocked)
    // stay in their initial "loading: true" state — StoryboardView renders a lock
    // overlay for them and never tries to display panelImages state for those slots.
    //
    // All unlocked requests fire concurrently (no stagger needed — Cloudflare Workers AI
    // handles burst well, and the Gemini-era stagger has been removed along with Gemini).
    for (const [idx, panel] of panels.entries()) {
      if (idx >= unlocked) break;
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
    const devTier  = typeof window !== 'undefined' ? localStorage.getItem('lifescript_dev_tier')  || '' : '';

    try {
      const response = await fetch('/api/generate-storyboard', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id':  deviceId,
          'x-admin-key':  adminKey,
          ...(devTier ? { 'x-dev-tier': devTier } : {}),
        },
        body: JSON.stringify({ script: cleanScript, lang, genre, comicStyle, deviceId }),
      });
      const data = await response.json();

      if (response.status === 403) {
        onAuthRequired?.('comic');
        return;
      }

      if (data.success && data.panels?.length > 0) {
        // unlockedPanels from API tells us how many panels this tier may see.
        // Default to full panel count if the field is missing (backwards compat).
        const unlocked = typeof data.unlockedPanels === 'number'
          ? data.unlockedPanels
          : data.panels.length;

        storyboardActiveRef.current = true;
        setStoryboardPanels(data.panels);
        setUnlockedPanels(unlocked);
        setShowStoryboard(true);
        track('Storyboard Generated', { genre, language: lang });
        generateStoryboardImages(data.panels, unlocked);
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
