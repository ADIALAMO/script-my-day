import { useEffect, useRef } from 'react';

export function useBackgroundAudio(activeGenre, isMusicMuted) {
  const audioRef = useRef(null);
  // handleInteraction is (re)attached on every activeGenre/isMusicMuted change
  // (see the effect below) but only fires whenever the next real click/touch
  // happens, which can be well after that. Reading isMusicMuted directly would
  // close over the value from whenever THIS listener instance was attached,
  // not the current one — confirmed as a real bug: tapping mute (which
  // triggers this same click) could read the pre-toggle "unmuted" value and
  // call play(), starting audio instead of muting it. The ref is always current.
  const isMusicMutedRef = useRef(isMusicMuted);
  useEffect(() => { isMusicMutedRef.current = isMusicMuted; }, [isMusicMuted]);

  useEffect(() => {
    const audio = document.getElementById('main-bg-music');
    if (!audio) return;
    audioRef.current = audio;

    // 1. פונקציה לשחרור החסימה של הדפדפן באינטראקציה ראשונה
    const handleInteraction = () => {
      if (audio.paused && !isMusicMutedRef.current) {
        audio.play().catch(() => {});
      }
      // הסרת המאזינים ברגע שהצלחנו "להעיר" את הסאונד
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };

    window.addEventListener('click', handleInteraction);
    window.addEventListener('touchstart', handleInteraction);

    // 2. ניהול החלפת הקבצים לפי ז'אנר
    const fileName = activeGenre ? `${activeGenre}_bg.m4a` : 'neutral_bg.m4a'; // הוספתי ברירת מחדל ניטרלית אם אין ז'אנר

    if (!audio.src.endsWith(fileName)) {
      audio.pause();
      audio.src = `/audio/${fileName}`;
      audio.load();
      audio.loop = true;
      audio.volume = isMusicMuted ? 0 : 0.5;

      // ניסיון השמעה (עלול להיחסם, לכן יש לנו את ה-Interaction למעלה)
      // Known limitation, out of scope for now: this runs inside a useEffect
      // reacting to activeGenre, not synchronously inside the genre-pill's own
      // click handler — same category as the flash-sound bug fixed earlier,
      // so this specific call is likely blocked on a genre switch even though
      // it was triggered by a real tap. handleInteraction above is the actual
      // gesture-synchronous path that (re)starts playback in that case.
      audio.play().catch(() => {});
    } else {
      audio.volume = isMusicMuted ? 0 : 0.5;
    }

    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('touchstart', handleInteraction);
    };
  }, [activeGenre, isMusicMuted]);

  return audioRef;
}