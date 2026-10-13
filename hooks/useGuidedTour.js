import { useCallback, useEffect, useRef, useState } from 'react';
import { isTourDone, markTourDone } from '../utils/tour-state.js';
import { autoStartDecision, hasPriorActivity, cookieBannerPending, resolveSteps } from '../utils/tour-logic.js';
import { TOUR_STEPS } from '../constants/tour.js';

const START_DELAY_MS = 1200;
const POLL_MS = 400;
const MAX_WAIT_FOR_ANCHOR_MS = 8000;

const storage = () => { try { return window.localStorage; } catch { return null; } };
const firstAnchorVisible = () => resolveSteps(TOUR_STEPS.slice(0, 1), (a) => {
  const el = document.querySelector(`[data-tour="${a}"]`);
  return el ? el.getBoundingClientRect() : null;
}).length > 0;

/**
 * phase: 'idle' | 'pending' (first-run, waiting for a quiet moment — the "How it works" card stays hidden) | 'running'.
 * blocked = a dialog / lightbox / generation is active. Auto-start only on a device with no history and no script on screen.
 */
export function useGuidedTour({ blocked, hasScript, historyCount }) {
  const [phase, setPhase] = useState('idle');
  const live = useRef({ blocked, hasScript, historyCount });
  live.current = { blocked, hasScript, historyCount };

  // decide eligibility once, right after mount
  useEffect(() => {
    const st = storage();
    if (isTourDone(st) || hasPriorActivity(st, live.current.historyCount)) return;
    setPhase('pending');
  }, []);

  useEffect(() => {
    if (phase !== 'pending') return undefined;
    const t0 = Date.now();
    let anchorSince = 0;
    const id = setInterval(() => {
      const st = storage();
      const l = live.current;
      const anchor = firstAnchorVisible();
      if (anchor && !anchorSince) anchorSince = Date.now();
      const d = autoStartDecision({
        done: isTourDone(st), priorActivity: hasPriorActivity(st, l.historyCount), hasScript: l.hasScript,
        blocked: l.blocked, cookiePending: cookieBannerPending(st),
        ready: Date.now() - t0 >= START_DELAY_MS && anchor,
      });
      if (d === 'start') setPhase('running');
      else if (d === 'abandon') setPhase('idle');
      else if (!anchor && Date.now() - t0 > MAX_WAIT_FOR_ANCHOR_MS && !l.blocked) setPhase('idle');
    }, POLL_MS);
    return () => clearInterval(id);
  }, [phase]);

  // a dialog / generation appearing mid-tour closes it without marking it done
  useEffect(() => { if (phase === 'running' && blocked) setPhase('idle'); }, [phase, blocked]);

  const returnFocus = () => setTimeout(() => {
    try { document.querySelector('[data-tour="guide"]')?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }, 0);

  const start = useCallback(() => { if (!live.current.blocked) setPhase('running'); }, []);
  const finish = useCallback(() => { markTourDone(storage()); setPhase('idle'); returnFocus(); }, []);
  const abort = useCallback(() => { setPhase('idle'); returnFocus(); }, []);

  return { phase, running: phase === 'running', holdHowTo: phase !== 'idle', start, finish, abort };
}
