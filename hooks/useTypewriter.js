import { useState, useEffect, useRef, useCallback } from 'react';

// How close to the bottom still counts as "following" — within this, the
// auto-scroll stays active; past it, the user is considered to have
// deliberately moved away and auto-scroll stays off until they scroll back.
const BOTTOM_THRESHOLD_PX = 40;

/**
 * Drives the character-by-character typewriter animation for the script display.
 * Owns all display text, typing state, auto-scroll, and the skip action.
 *
 * @param {Object}   opts
 * @param {string}   opts.cleanScript       - The fully parsed script text to animate.
 * @param {Function} opts.setIsTypingGlobal - Parent callback to sync typing state upward.
 * @param {Function} opts.playSound         - Typewriter sound callback fired per character.
 * @param {boolean}  [opts.instant]         - Show the full text immediately (saved/history scripts):
 *                                            no animation, no sound, no auto-scroll, never "typing".
 */
export function useTypewriter({ cleanScript, setIsTypingGlobal, playSound, instant = false }) {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const scrollRef          = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const timerRef           = useRef(null);

  // Main typing effect — re-runs every time a new cleanScript arrives.
  useEffect(() => {
    if (!cleanScript) return;

    // Instant path: a script the user already has (opened from history) is shown whole,
    // right away. Nothing animates, so there is no sound, no auto-scroll to fight, and
    // the global typing flag stays false. Any previous animation is cancelled first.
    if (instant) {
      clearTimeout(timerRef.current);
      setIsTyping(false);
      setIsTypingGlobal?.(false);
      isAutoScrollPaused.current = false;
      if (scrollRef.current) scrollRef.current.scrollTop = 0;
      return;
    }

    // Clear previous animation and reset display before starting.
    clearTimeout(timerRef.current);
    setDisplayText('');
    setIsTyping(true);
    setIsTypingGlobal?.(true);
    isAutoScrollPaused.current = false; // a fresh script always starts followed

    let i = 0;
    const typeChar = () => {
      if (i >= cleanScript.length) {
        setIsTyping(false);
        setIsTypingGlobal?.(false);
        return;
      }

      setDisplayText(cleanScript.substring(0, i + 1));

      // Fire on every non-whitespace character — the 80 ms throttle gate inside
      // playSound() controls density (≤12/s).  Removing the old `i % 2 === 0`
      // guard means the sound is always simultaneous with the character appearing,
      // not offset by an arbitrary even/odd index.
      if (cleanScript[i] && !/\s/.test(cleanScript[i])) {
        playSound();
      }

      // behavior: 'auto' — NOT 'smooth'. A SMOOTH scrollTo re-issued every 40ms
      // is a repeating animation that fights the user's own scroll momentum
      // (confirmed: dragging mid-animation visibly stutters against the next
      // queued smooth-scroll). An instant jump either lands before the next
      // user gesture starts or doesn't persist long enough to fight one. This
      // only works because the container no longer sets CSS scroll-behavior:
      // smooth (see ScriptOutput.jsx) — scrollTo's 'auto' means "use the
      // element's CSS scroll-behavior", so it would silently still animate if
      // that CSS property were still set.
      if (i > 15 && scrollRef.current && !isAutoScrollPaused.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'auto' });
      }

      i++;
      timerRef.current = setTimeout(typeChar, 40);
    };

    typeChar();

    return () => {
      clearTimeout(timerRef.current);
      setIsTypingGlobal?.(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanScript]);

  /** Immediately completes the animation — shows full script and stops the timer. */
  const skip = useCallback(() => {
    clearTimeout(timerRef.current);
    setDisplayText(cleanScript);
    setIsTyping(false);
    setIsTypingGlobal?.(false);
  }, [cleanScript, setIsTypingGlobal]);

  // Immediate pause — wired to onWheel/onTouchStart/onPointerDown on the
  // scroll container, so auto-scroll stops the INSTANT the user starts
  // interacting via any input method, before any scroll delta even registers.
  // This is what stops the fight with user-driven momentum at its source;
  // handleScrollPosition below (input-agnostic, position-based) is what keeps
  // it paused — or resumes it — for as long as the interaction continues.
  const pauseAutoScroll = useCallback(() => {
    isAutoScrollPaused.current = true;
  }, []);

  // Position-based pause/resume — call from the scroll container's onScroll.
  // Input-agnostic: fires for touch, wheel, keyboard, scrollbar dragging, and
  // assistive tech alike, since all of them move scrollTop the same way.
  // Pauses once the user is more than BOTTOM_THRESHOLD_PX from the bottom;
  // resumes only once they're back within it — matching "resume only if the
  // user scrolls back to the bottom", not a timer. No separate flag is needed
  // to distinguish this from the typewriter's OWN programmatic scrolls: those
  // always land exactly at the bottom, so this check naturally evaluates to
  // "not paused" immediately afterward either way.
  const handleScrollPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    isAutoScrollPaused.current = distanceFromBottom > BOTTOM_THRESHOLD_PX;
  }, []);

  // In instant mode the text is derived, not stored, so there is no empty first frame.
  return {
    displayText: instant ? cleanScript : displayText,
    isTyping: instant ? false : isTyping,
    skip, scrollRef, pauseAutoScroll, handleScrollPosition,
  };
}
