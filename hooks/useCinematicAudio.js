import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Cinematic sound effects — typewriter click and camera-flash shutter.
 *
 * Uses HTMLAudioElement + cloneNode() instead of Web Audio API.
 * Rationale: AudioContext has well-known React lifecycle conflicts —
 * the effect cleanup closes the context, any subsequent decodeAudioData
 * or resume() call throws InvalidStateError. HTMLAudioElement carries none
 * of that baggage: no context to close, no resume() dance, and the browser's
 * user-activation state persists across async boundaries so play() works
 * anywhere after the first real user gesture on the page.
 *
 * cloneNode() creates a new element sharing the same decoded media resource
 * from the browser's cache, enabling rapid overlapping playback without
 * re-fetching or re-decoding the file on every click.
 */
export function useCinematicAudio() {
  const [isMuted, setIsMuted] = useState(false);
  const isMutedRef    = useRef(false);
  const lastClickRef  = useRef(0);
  const typewriterRef = useRef(null); // source element — never played directly
  const flashRef      = useRef(null);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    const tw = new Audio('/audio/typewriter.m4a');
    tw.preload = 'auto';
    typewriterRef.current = tw;

    const fl = new Audio('/audio/camera-flash.wav');
    fl.preload = 'auto';
    flashRef.current = fl;

    return () => {
      // Release media resources without touching any AudioContext.
      tw.src = '';
      fl.src = '';
    };
  }, []);

  /**
   * Typewriter click — throttled to ≤12 clicks/s.
   * Cloning the source element lets rapid-fire calls overlap without
   * reloading the file; each clone is GC'd when its playback ends.
   */
  const playSound = useCallback(() => {
    const now = Date.now();
    if (now - lastClickRef.current < 80) return;
    lastClickRef.current = now;
    if (isMutedRef.current || !typewriterRef.current) return;

    const s = /** @type {HTMLAudioElement} */ (typewriterRef.current.cloneNode());
    s.volume = 0.38;
    s.play().catch(() => {}); // silently ignore — fires fine after any user gesture
  }, []);

  /**
   * Camera-flash shutter — single shot with a 2.5 s fade-out.
   * Starts playback at 0.5 s into the file (skips the silent lead-in),
   * then ramps volume down to near-zero via a lightweight interval.
   */
  const playFlashSound = useCallback(() => {
    if (isMutedRef.current || !flashRef.current) return;

    const s = /** @type {HTMLAudioElement} */ (flashRef.current.cloneNode());
    s.currentTime = 0.5; // skip silent lead-in, matching original Web Audio offset
    s.volume = 0.9;
    s.play().catch(() => {});

    // Fade 0.9 → 0 over 2.5 s in 80 ms steps (mirrors the old gain ramp).
    const start = Date.now();
    const timer = setInterval(() => {
      const t = (Date.now() - start) / 2500;
      if (t >= 1) {
        clearInterval(timer);
        try { s.pause(); } catch {}
        return;
      }
      try { s.volume = Math.max(0, 0.9 * (1 - t)); } catch { clearInterval(timer); }
    }, 80);
  }, []);

  return { isMuted, setIsMuted, playSound, playFlashSound };
}
