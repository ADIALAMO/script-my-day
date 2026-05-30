import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Drives the character-by-character typewriter animation for the script display.
 * Owns all display text, typing state, auto-scroll, and the skip action.
 *
 * @param {Object}   opts
 * @param {string}   opts.cleanScript       - The fully parsed script text to animate.
 * @param {Function} opts.setIsTypingGlobal - Parent callback to sync typing state upward.
 * @param {Function} opts.playSound         - Typewriter sound callback fired per character.
 */
export function useTypewriter({ cleanScript, setIsTypingGlobal, playSound }) {
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const scrollRef          = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const pauseTimerRef      = useRef(null);
  const timerRef           = useRef(null);

  // Main typing effect — re-runs every time a new cleanScript arrives.
  useEffect(() => {
    if (!cleanScript) return;

    // Clear previous animation and reset display before starting.
    clearTimeout(timerRef.current);
    setDisplayText('');
    setIsTyping(true);
    setIsTypingGlobal?.(true);

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

      if (i > 15 && scrollRef.current && !isAutoScrollPaused.current) {
        scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
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

  /** Call from the scroll container's onWheel handler to pause auto-scroll temporarily. */
  const handleScroll = useCallback(() => {
    isAutoScrollPaused.current = true;
    clearTimeout(pauseTimerRef.current);
    pauseTimerRef.current = setTimeout(() => {
      isAutoScrollPaused.current = false;
    }, 4000);
  }, []);

  return { displayText, isTyping, skip, scrollRef, handleScroll };
}
