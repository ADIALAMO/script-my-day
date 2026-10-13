import { useCallback, useEffect, useRef, useState } from 'react';
import { isTourDone, markTourDone, readChapters, markChapterDone, setAutoOff } from '../utils/tour-state.js';
import { autoStartDecision, hasPriorActivity, cookieBannerPending, chapterAutoEligible } from '../utils/tour-logic.js';
import { CHAPTERS, MILESTONE_CHAPTER, chapterById } from '../constants/tour.js';

const START_DELAY_MS = 1200;
const POLL_MS = 400;
const MAX_WAIT_FOR_ANCHOR_MS = 8000;
const MAX_QUEUE_WAIT_MS = 30000;
// screen milestone -> the stage it proves was reached (the '-shown' ones also cover a poster / comic reopened from History)
const STAGE_OF = { 'typing-start': 'script', 'poster-done': 'poster', 'poster-shown': 'poster', 'comic-done': 'comic', 'comic-shown': 'comic' };

const storage = () => { try { return window.localStorage; } catch { return null; } };
const anchorVisible = (name) => {
  const el = document.querySelector(`[data-tour="${name}"]`);
  const r = el?.getBoundingClientRect();
  return !!r && r.width > 0 && r.height > 0;
};

/**
 * phase: 'idle' | 'pending' (first-run chapter 1 waiting for a quiet moment — the "How it works" card stays hidden) | 'running'.
 * blocked = a dialog / lightbox / generation is active. Chapter 1 auto-starts only on a device with no history and no script on screen.
 * Chapters 2-4 start from a milestone (notify): typewriter start, poster finished, comic finished — only for a user who FINISHED chapter 1
 * (never after a skip), once each, and only when nothing is blocking.
 */
export function useGuidedTour({ blocked, hasScript, historyCount }) {
  const [phase, setPhase] = useState('idle');
  const [chapter, setChapter] = useState(1);
  const [queued, setQueued] = useState(null);
  const [manual, setManual] = useState(false);          // started from the Guide menu (steps do not wait for anchors that are not on screen)
  const [reached, setReached] = useState({ script: false, poster: false, comic: false }); // stages reached in this session
  const live = useRef({ blocked, hasScript, historyCount });
  live.current = { blocked, hasScript, historyCount };
  const chapterRef = useRef(1);
  chapterRef.current = chapter;

  // decide chapter-1 eligibility once, right after mount
  useEffect(() => {
    const st = storage();
    if (isTourDone(st) || hasPriorActivity(st, live.current.historyCount)) return;
    setPhase('pending');
  }, []);

  useEffect(() => {
    if (phase !== 'pending') return undefined;
    const t0 = Date.now();
    const id = setInterval(() => {
      const st = storage();
      const l = live.current;
      const anchor = anchorVisible('journal');
      const d = autoStartDecision({
        done: isTourDone(st), priorActivity: hasPriorActivity(st, l.historyCount), hasScript: l.hasScript,
        blocked: l.blocked, cookiePending: cookieBannerPending(st),
        ready: Date.now() - t0 >= START_DELAY_MS && anchor,
      });
      if (d === 'start') { setChapter(1); setManual(false); setPhase('running'); }
      else if (d === 'abandon') setPhase('idle');
      else if (!anchor && Date.now() - t0 > MAX_WAIT_FOR_ANCHOR_MS && !l.blocked) setPhase('idle');
    }, POLL_MS);
    return () => clearInterval(id);
  }, [phase]);

  // a milestone queued a chapter: start it at the first quiet moment (give up after a while)
  useEffect(() => {
    if (queued == null || phase !== 'idle') return undefined;
    const t0 = Date.now();
    const id = setInterval(() => {
      if (!chapterAutoEligible(readChapters(storage()), queued) || Date.now() - t0 > MAX_QUEUE_WAIT_MS) { setQueued(null); return; }
      if (!live.current.blocked) { setChapter(queued); setManual(false); setQueued(null); setPhase('running'); }
    }, 300);
    return () => clearInterval(id);
  }, [queued, phase]);

  // a dialog / generation appearing mid-chapter closes it without recording it
  useEffect(() => { if (phase === 'running' && blocked) setPhase('idle'); }, [phase, blocked]);

  const returnFocus = () => setTimeout(() => {
    try { document.querySelector('[data-tour="guide"]')?.focus({ preventScroll: true }); } catch { /* ignore */ }
  }, 0);

  /** a screen milestone ('typing-start' | 'poster-done' | 'comic-done') — starts the matching chapter if this user is eligible */
  const notify = useCallback((name) => {
    const stage = STAGE_OF[name];
    if (stage) setReached((r) => (r[stage] ? r : { ...r, [stage]: true }));
    const id = MILESTONE_CHAPTER[name];
    if (id && chapterAutoEligible(readChapters(storage()), id)) setQueued(id);
  }, []);

  const start = useCallback((id = 1) => {
    if (live.current.blocked || !chapterById(id)) return;
    setQueued(null);
    setChapter(id);
    setManual(true);
    setPhase('running');
  }, []);

  /** kind 'done' = finished the chapter; anything else (Skip, Esc, Android Back) = skip: permanent, no chapter auto-starts any more */
  const finish = useCallback((kind) => {
    const st = storage();
    if (kind === 'done') {
      markChapterDone(chapterRef.current, st);
      if (chapterRef.current === 1) markTourDone(st);
    } else {
      markTourDone(st);
      setAutoOff(st);
    }
    setPhase('idle');
    returnFocus();
  }, []);
  const abort = useCallback(() => { setPhase('idle'); returnFocus(); }, []);

  return {
    phase, chapter, manual, reached, running: phase === 'running',
    holdHowTo: phase === 'pending' || (phase === 'running' && chapter === 1),
    start, finish, abort, notify,
  };
}
