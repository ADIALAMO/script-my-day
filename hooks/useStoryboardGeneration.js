import { useState, useEffect, useRef, useReducer, useCallback } from 'react';
import { track } from '@vercel/analytics';
import { getMsg, CODES, isQuotaError } from '../lib/messages.js';
import { useRotatingMessages } from './useRotatingMessages.js';
import {
  classifyFrameFailure, missingFrames, anySessionExpired, shouldAutoRetry, restoredPanelState,
  FETCH_TIMEOUT_MS, AUTO_RETRY_DELAY_MS, RESUME_CONCURRENCY,
} from '../utils/frame-error.js';

const makeSessionId = () => `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

/**
 * fetch + JSON with a hard timeout (AbortController). Resolves { status, ok, headers, data, nonJson }; a non-JSON body (e.g. Vercel's 504 page) gives
 * nonJson:true and data {}. Rejects with e.kind = 'timeout' | 'network' (offline, iOS "Load failed" after the tab was suspended, user abort).
 * `onController` lets the caller abort the request (Cancel).
 */
async function fetchJson(url, init, ms, onController) {
  const controller = new AbortController();
  onController?.(controller);
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    let data = {};
    let nonJson = false;
    try { data = await resp.json(); } catch { nonJson = true; }
    return { status: resp.status, ok: resp.ok, headers: resp.headers, data: data && typeof data === 'object' ? data : {}, nonJson };
  } catch (e) {
    const err = new Error(timedOut ? 'timeout' : 'network');
    err.kind = timedOut ? 'timeout' : 'network';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Panel image state machine ────────────────────────────────────────────────

function panelImagesReducer(state, action) {
  switch (action.type) {
    case 'INIT_ALL': {
      const next = {};
      for (let i = 0; i < action.count; i++) next[i] = { loading: true, url: null, error: false };
      return next;
    }
    case 'INIT_FROM_HISTORY': {
      // a panel that never got its image is "missing": retryable when the comic's session (seed) was saved with the entry, else a plain lost frame
      const next = {};
      action.panels.forEach((p, i) => { next[i] = restoredPanelState(p, action.canResume); });
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

// Display fallback for the number of replacements per comic. The REAL limit is enforced by the
// server (lib/comic-guard.js, config COMIC.regenLimit) and arrives with the storyboard response
// (`regenLimit`); this browser counter only mirrors it for the UI and is never the guard.
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
  initialComicMeta,  // { comicSeed, sessionId, unlocked } saved with the History entry — lets missing frames be resumed
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
  const [regenLimit,          setRegenLimit]           = useState(REGEN_LIMIT);
  // Honest, non-blocking note when a spend budget degraded or stopped part of this comic.
  const [comicNotice,         setComicNotice]          = useState('');

  // Tracks whether the current generation session is still active.
  // Set to false on reset / close so in-flight callbacks self-abort.
  const storyboardActiveRef = useRef(false);

  // Set to true by cancelStoryboard() so an in-flight TEXT response
  // (the phase before storyboardActiveRef goes true) is dropped instead
  // of re-opening the storyboard after the user has backed out.
  const storyboardCancelledRef = useRef(false);

  // Aborts the in-flight storyboard text request (Cancel) — and the timeout controller lives in fetchJson.
  const storyboardAbortRef = useRef(null);
  // Latest values for the resume / visibility code (no stale closures, no dep churn).
  const unlockedRef = useRef(0);
  const panelsRef = useRef([]);
  const panelImagesRef = useRef({});
  // true only for a comic generated in THIS session — the automatic "tab is visible again" retry never spends credits on a restored comic
  const freshComicRef = useRef(false);
  const visRetriedRef = useRef(new Set());

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

  panelImagesRef.current = panelImages;
  panelsRef.current      = storyboardPanels;
  unlockedRef.current    = unlockedPanels;

  const messages       = isHebrew ? STORYBOARD_MESSAGES_HE : STORYBOARD_MESSAGES_EN;
  const currentMessage = useRotatingMessages(messages, 2200, storyboardLoading);

  // ── Reset on new script / restore from history ──────────────────────────
  useEffect(() => {
    storyboardActiveRef.current = false;
    freshComicRef.current       = false;
    visRetriedRef.current       = new Set();
    panelCdnUrlsRef.current     = {};
    panelSessionRef.current     = null;
    comicSeedRef.current        = null;
    setRegensLeft(REGEN_LIMIT);
    setRegenLimit(REGEN_LIMIT);
    setComicNotice('');
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
      // The comic's server session (seed) was saved with the entry: restore it so missing frames can be resumed (and Replace works) for 24 h.
      const canResume = !!(initialComicMeta && typeof initialComicMeta.comicSeed === 'string' && initialComicMeta.comicSeed);
      if (canResume) {
        comicSeedRef.current = initialComicMeta.comicSeed;
        panelSessionRef.current = initialComicMeta.sessionId || makeSessionId();
        storyboardActiveRef.current = true;   // a restored comic is live: retry / replace results must not be dropped
      }
      setStoryboardPanels(ownedPanels);
      setUnlockedPanels(ownedPanels.length);
      setShowStoryboard(true);
      dispatchPanelImages({ type: 'INIT_FROM_HISTORY', panels: ownedPanels, canResume });
    } else {
      setShowStoryboard(false);
      setStoryboardPanels([]);
      setUnlockedPanels(0);
      dispatchPanelImages({ type: 'RESET' });
    }
  }, [script, initialPanels, initialComicMeta]);

  // ── Panel image generation + R2 upload ───────────────────────────────────
  //
  // Shared by the initial fire-and-forget generation loop AND the rate-limit
  // retry path below — both need the identical sequence: call generate-poster
  // for ONE panel, then either show the image + kick off the R2 upload +
  // history persist, flag it as rate-limited (not a real failure — no image
  // was ever generated, nothing to blame the provider cascade for), or flag a
  // genuine failure. `allPanels` is passed explicitly rather than read from
  // `storyboardPanels` state: for the FIRST generation, the state update from
  // setStoryboardPanels in generateStoryboard may not have committed yet by
  // the time a fast response comes back, so the literal array argument is
  // used there; the retry path passes the (by-then-settled) state instead.
  const generatePanelImage = useCallback(async (idx, panel, sessionId, allPanels, onSettled, attempt = 0) => {
    // A frame that failed ends in an error state that SAYS whether asking again can help (retryable) or the comic's session is gone.
    const settleError = (f) => {
      dispatchPanelImages({
        type: 'SET_PANEL', idx,
        payload: { loading: false, url: null, error: true, retryable: f.retryable, sessionExpired: f.sessionExpired },
      });
      onSettled?.();
    };
    // ONE automatic retry for connection-level failures, after ~1.5 s and only while the tab is visible (iOS suspends background pages, and the
    // requests of a page that was just resumed often fail instantly). The frame stays "loading" meanwhile.
    const retryOnce = () => {
      const run = () => { if (storyboardActiveRef.current) generatePanelImage(idx, panel, sessionId, allPanels, onSettled, attempt + 1); };
      const later = () => setTimeout(run, AUTO_RETRY_DELAY_MS);
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        const onVis = () => { if (document.visibilityState === 'visible') { document.removeEventListener('visibilitychange', onVis); later(); } };
        document.addEventListener('visibilitychange', onVis);
      } else later();
    };
    // network-level failures (offline, timeout, non-JSON body, 5xx): auto-retry once, then show the "Retry this frame" state
    const connectionFailure = (kind, status) => {
      const f = classifyFrameFailure({ kind, status });
      if (shouldAutoRetry({ attempt, retryable: f.retryable })) retryOnce(); else settleError(f);
    };

    let res;
    try {
      res = await fetchJson('/api/generate-poster', {
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
      }, FETCH_TIMEOUT_MS.panel);
    } catch (e) {
      if (!storyboardActiveRef.current) return;
      connectionFailure(e?.kind || 'network');
      return;
    }
    if (!storyboardActiveRef.current) return;
    const { status, data, nonJson, headers } = res;

    if (nonJson) { connectionFailure('nonjson', status); return; }
    if (status >= 500) { connectionFailure('http', status); return; }

    if (status === 429) {
      // Only the sliding-window limiter is a "wait a moment and retry" case. A quota answer
      // (daily panel cap, replacements used up) will not clear by retrying — show a failure.
      if (data?.code && data.code !== CODES.RATE_LIMITED) {
        settleError(classifyFrameFailure({ kind: 'api', status, code: data.code }));
        return;
      }
      const retryAfterSec = parseInt(headers.get('Retry-After'), 10);
      dispatchPanelImages({
        type: 'SET_PANEL', idx,
        payload: {
          loading: false, url: null, error: false,
          rateLimited: true,
          retryAvailableAt: Date.now() + (Number.isFinite(retryAfterSec) ? retryAfterSec : 8) * 1000,
        },
      });
      onSettled?.();
      return;
    }

    // A placeholder (all providers exhausted) is server-shaped like a success
    // (success: true, a real imageUrl — the placeholder SVG) but no image was
    // actually generated. Must be treated as a failure here: never uploaded to
    // R2, never persisted to history, never shown as if it were a real panel.
    if (data.isPlaceholder) {
      if (data.code === CODES.IMAGE_BUDGET_REACHED || data.code === CODES.CONTENT_REFUSED || data.code === CODES.CONTENT_CHECK_UNAVAILABLE) setComicNotice((n) => n || getMsg(data.code, lang));
      settleError(classifyFrameFailure({ kind: 'placeholder', status, code: data.code }));
      return;
    }

    if (data.success && data.imageUrl) {
      // A hero panel that came out without the user's face because identity is capped/used up:
      // say why (once per comic) instead of leaving a silent substitution.
      if (data.identityDegraded && data.code) setComicNotice((n) => n || getMsg(data.code, lang));
      // ── Phase 2: show data URI immediately (instant UX) ────────────
      dispatchPanelImages({
        type: 'SET_PANEL', idx,
        payload: { loading: false, url: data.imageUrl, error: false },
      });
      onSettled?.();

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
          // Build the full merged array with all CDN URLs known so far (plus the comic's session, so missing frames can be resumed later).
          panelCdnUrlsRef.current[idx] = cdnUrl;
          const merged = allPanels.map((p, i) => ({
            ...p,
            imageUrl: panelCdnUrlsRef.current[i] ?? null,
          }));
          onPanelsGeneratedRef.current?.(merged, { comicSeed: comicSeedRef.current, sessionId: panelSessionRef.current, unlocked: unlockedRef.current });
        })
        .catch((err) => {
          // Upload failed silently — the data URI keeps displaying for
          // the current session; history entry has imageUrl: null for
          // this panel and can be regenerated later.
          console.warn(`⚠️ R2 upload skipped for panel ${idx}: ${err.message}`);
        });

    } else {
      // The server's keyword blocklist rejected this panel's prompt (nothing was generated or charged).
      if (data.code === CODES.CONTENT_BLOCKED) setComicNotice((n) => n || getMsg(data.code, lang));
      settleError(classifyFrameFailure({ kind: 'api', status, code: data.code }));
    }
  }, [genre, lang]); // onPanelsGeneratedRef is a ref — intentionally excluded from deps

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
      generatePanelImage(idx, panel, sessionId, panels);
    }
  }, [generatePanelImage]);

  // ── Retry a single rate-limited panel (not a budget-consuming regen — no
  // image was ever generated, so nothing should be spent) ────────────────────
  const retryRateLimitedPanel = useCallback((idx) => {
    const panel = storyboardPanels[idx];
    if (!panel || !panelImages[idx]?.rateLimited) return;
    dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: true, url: null, error: false } });
    generatePanelImage(idx, panel, panelSessionRef.current, storyboardPanels);
  }, [storyboardPanels, panelImages, generatePanelImage]);

  // ── "Retry this frame" / "Generate missing frames" ─────────────────────────
  // A frame that failed for a connection reason (or was never generated because the tab was suspended / closed first) can be asked for again.
  // The server gave a failed attempt back, and a request that never arrived never counted, so this is a normal first attempt for that panel.
  // (If the server DID render it and only the answer was lost, this counts as one of the comic's replacements — QUOTA_PANEL_REGEN then says so.)
  const retryOne = useCallback((idx) => new Promise((resolve) => {
    const panel = panelsRef.current[idx];
    if (!panel || panel.isLocked || !panel.visual || panelImagesRef.current[idx]?.loading) { resolve(); return; }
    if (!panelSessionRef.current) panelSessionRef.current = makeSessionId();
    storyboardActiveRef.current = true;
    dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: true, url: null, error: false } });
    const guard = setTimeout(resolve, FETCH_TIMEOUT_MS.panel + 8000);        // never hang the pool on a path that does not settle
    generatePanelImage(idx, panel, panelSessionRef.current, panelsRef.current, () => { clearTimeout(guard); resolve(); }, 1);
  }), [generatePanelImage]);

  const retryFrame = useCallback((idx) => { retryOne(idx); }, [retryOne]);

  // RESUME_CONCURRENCY (2) frames at a time, so a resume never looks like a burst
  const runPool = useCallback(async (indexes) => {
    const queue = [...indexes];
    const worker = async () => { while (queue.length) { await retryOne(queue.shift()); } };
    await Promise.all(Array.from({ length: Math.min(RESUME_CONCURRENCY, queue.length) }, worker));
  }, [retryOne]);

  const generateMissingFrames = useCallback(() => {
    const list = missingFrames(panelImagesRef.current, unlockedRef.current);
    if (list.length) runPool(list);
  }, [runPool]);

  // Back in the foreground: frames of a comic generated in THIS session that failed while the page was suspended get one more chance, once each.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible' || !freshComicRef.current || !storyboardActiveRef.current) return;
      const todo = missingFrames(panelImagesRef.current, unlockedRef.current).filter((i) => !visRetriedRef.current.has(i));
      if (!todo.length) return;
      todo.forEach((i) => visRetriedRef.current.add(i));
      runPool(todo);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [runPool]);

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
      const { data } = await fetchJson('/api/generate-poster', {
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
      }, FETCH_TIMEOUT_MS.panel);   // a timeout / network error lands in the catch below: the old image stays
      if (!storyboardActiveRef.current) return;  // user closed the storyboard mid-flight

      // The server is the authority on the replacement budget: when it says the budget is
      // used up, stop offering "Replace" for this comic.
      if (data.code === CODES.QUOTA_PANEL_REGEN) setRegensLeft(0);

      // A placeholder/failure must NOT replace a good image or burn a replacement.
      if (!data.success || !data.imageUrl || data.isPlaceholder) {
        if (data.code === CODES.CONTENT_BLOCKED || data.code === CODES.CONTENT_REFUSED || data.code === CODES.CONTENT_CHECK_UNAVAILABLE) setComicNotice(getMsg(data.code, lang));
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
          onPanelsGeneratedRef.current?.(merged, { comicSeed: comicSeedRef.current, sessionId: panelSessionRef.current, unlocked: unlockedRef.current });
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
    setComicNotice('');
    setStoryboardLoading(true);
    setStoryboardError('');
    setStoryboardErrorCode('');

    try {
      // 62 s ceiling (the route is killed at 60 s): a hung request becomes a normal, retryable error instead of an endless spinner.
      const { status, data } = await fetchJson('/api/generate-storyboard', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          script: cleanScript, lang, genre, comicStyle,
          heroDescriptor: heroDescriptor || undefined,
          // Lets the server decide this comic's provider mode (comic:mode:<seed>)
          // once here, instead of racing the decision per panel — comicSeedRef was
          // already generated above but never sent to this endpoint before.
          comicSeed: comicSeedRef.current,
        }),
      }, FETCH_TIMEOUT_MS.storyboard, (c) => { storyboardAbortRef.current = c; });

      // User cancelled while the text request was in flight — drop the result.
      if (storyboardCancelledRef.current) return;

      if (status === 403) {
        onAuthRequired?.('comic');
        return;
      }

      if (data.success && data.panels?.length > 0) {
        const unlocked = typeof data.unlockedPanels === 'number'
          ? data.unlockedPanels
          : data.panels.length;

        storyboardActiveRef.current = true;
        freshComicRef.current = true;
        visRetriedRef.current = new Set();
        unlockedRef.current = unlocked;
        // The server may have issued the seed (older clients) — panel requests must carry it.
        if (typeof data.comicSeed === 'string' && data.comicSeed) comicSeedRef.current = data.comicSeed;
        const serverRegenLimit = Number.isFinite(data.regenLimit) ? data.regenLimit : REGEN_LIMIT;
        setRegenLimit(serverRegenLimit);
        setRegensLeft(serverRegenLimit);
        setStoryboardPanels(data.panels);
        setUnlockedPanels(unlocked);
        setShowStoryboard(true);
        track('Storyboard Generated', { genre, language: lang });

        // Unique session ID scopes all R2 keys for this generation run (and later replaces).
        const sessionId = makeSessionId();
        panelSessionRef.current = sessionId;

        // Persist panel text to history immediately (imageUrl: null per panel), TOGETHER with the comic's session (seed, id, unlocked count):
        // even if the tab is suspended or closed before the images finish, reopening the entry can resume the missing frames.
        onPanelsGeneratedRef.current?.(data.panels.map(p => ({ ...p, imageUrl: null })), { comicSeed: comicSeedRef.current, sessionId, unlocked });
        generateStoryboardImages(data.panels, unlocked, sessionId);

      } else {
        const code = data.code || CODES.STORYBOARD_FAIL;
        setStoryboardErrorCode(code);
        setStoryboardError(getMsg(code, lang));
      }
    } catch {
      if (storyboardCancelledRef.current) return;
      const code = (typeof navigator !== 'undefined' && navigator.onLine)
        ? CODES.STORYBOARD_FAIL
        : CODES.NETWORK_OFFLINE;
      setStoryboardErrorCode(code);
      setStoryboardError(getMsg(code, lang));
    } finally {
      storyboardAbortRef.current = null;
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
    storyboardAbortRef.current?.abort();   // frees the connection too (the route may still finish on the server)
    setStoryboardLoading(false);
    setShowStoryboard(false);
    setStoryboardPanels([]);
    setUnlockedPanels(0);
    setStoryboardError('');
    setStoryboardErrorCode('');
    dispatchPanelImages({ type: 'RESET' });
    track('Storyboard Cancelled', { genre, language: lang });
  }, [genre, lang]);

  // The comic's server session is gone (24 h) or unusable: the only way forward is a new comic (the user's explicit choice — it uses a comic).
  const startNewComic = useCallback(() => {
    closeStoryboard();
    generateStoryboard();
  }, [closeStoryboard, generateStoryboard]);

  const missingCount = missingFrames(panelImages, unlockedPanels).length;
  const sessionExpired = anySessionExpired(panelImages, unlockedPanels);

  return {
    retryFrame, generateMissingFrames, startNewComic, missingCount, sessionExpired,
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
    retryRateLimitedPanel,
    regensLeft,
    regenLimit,
    comicNotice,
    closeStoryboard,
    cancelStoryboard,
    isQuotaError,
  };
}
