import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Manages the Web Audio API context, sound-buffer loading, and playback
 * for the two cinematic sound effects: typewriter click and camera flash.
 *
 * Key design decisions:
 *   - `playSound` is throttled to ≤12 clicks/s so a rapid typing loop never
 *     floods the audio thread with hundreds of BufferSourceNode instances.
 *   - Neither callback attempts an async `AudioContext.resume()` inline —
 *     that would stall tight loops. The context is instead unlocked lazily
 *     on the first user interaction (click / touchstart / mousemove).
 */
export function useCinematicAudio() {
  const [isMuted, setIsMuted] = useState(false);

  const audioContextRef = useRef(null);
  const audioBufferRef  = useRef(null);
  const flashBufferRef  = useRef(null);
  const isMutedRef      = useRef(false);
  // Throttle gate: tracks the last ms a typewriter click was emitted.
  const lastClickRef    = useRef(0);

  // Keep the ref in sync so callbacks never read stale state.
  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  // Initialise AudioContext and pre-decode both sound files.
  useEffect(() => {
    let unlockFn = null;

    const initAudio = async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!audioContextRef.current) audioContextRef.current = new AudioCtx();

        const [typeBuf, flashBuf] = await Promise.all([
          fetch('/audio/typewriter.m4a')
            .then(r => r.arrayBuffer())
            .then(ab => audioContextRef.current.decodeAudioData(ab)),
          fetch('/audio/camera-flash.wav')
            .then(r => r.arrayBuffer())
            .then(ab => audioContextRef.current.decodeAudioData(ab)),
        ]);

        audioBufferRef.current = typeBuf;
        flashBufferRef.current = flashBuf;

        // Attempt an immediate resume; if blocked, the gesture listener below handles it.
        audioContextRef.current.resume().catch(() => {});

        // Lazy unlock — required on iOS and policy-strict browsers.
        const unlock = () => {
          if (audioContextRef.current?.state !== 'running') {
            audioContextRef.current?.resume().catch(() => {});
          }
          window.removeEventListener('click',      unlock);
          window.removeEventListener('touchstart', unlock);
          window.removeEventListener('mousemove',  unlock);
        };
        unlockFn = unlock;
        window.addEventListener('click',      unlock);
        window.addEventListener('touchstart', unlock);
        window.addEventListener('mousemove',  unlock);
      } catch (e) {
        console.warn('Audio engine failed to initialise:', e.message);
      }
    };

    initAudio();

    return () => {
      if (unlockFn) {
        window.removeEventListener('click',      unlockFn);
        window.removeEventListener('touchstart', unlockFn);
        window.removeEventListener('mousemove',  unlockFn);
      }
      audioContextRef.current?.close().catch(() => {});
    };
  }, []);

  /**
   * Typewriter click — throttled to one emission per 80 ms (≈12/s max).
   * Skips silently if the AudioContext is not yet in the 'running' state
   * to avoid async resume() calls inside the tight typing loop.
   */
  const playSound = useCallback(() => {
    const now = Date.now();
    if (now - lastClickRef.current < 80) return;       // throttle gate
    lastClickRef.current = now;

    if (isMutedRef.current) return;
    if (!audioBufferRef.current || !audioContextRef.current) return;
    if (audioContextRef.current.state !== 'running') return; // skip, don't try async resume

    const ctx    = audioContextRef.current;
    const source = ctx.createBufferSource();
    const gain   = ctx.createGain();
    source.buffer = audioBufferRef.current;
    gain.gain.setValueAtTime(0.38, ctx.currentTime); // lower than 0.6 — less audio fatigue
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(0);
  }, []);

  /**
   * Camera-flash shutter — used once per poster reveal.
   * Not throttled (single shot) and handles a suspended context gracefully.
   */
  const playFlashSound = useCallback(() => {
    if (isMutedRef.current) return;
    if (!flashBufferRef.current || !audioContextRef.current) return;

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (ctx.state !== 'running') return;

    const source = ctx.createBufferSource();
    const gain   = ctx.createGain();
    source.buffer = flashBufferRef.current;
    const now = ctx.currentTime;
    gain.gain.setValueAtTime(1.0, now);
    gain.gain.linearRampToValueAtTime(0.1, now + 2.5);
    source.connect(gain);
    gain.connect(ctx.destination);
    source.start(now, 0.5);
  }, []);

  return { isMuted, setIsMuted, playSound, playFlashSound };
}
