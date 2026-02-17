import { useEffect, useRef } from 'react';

export function useBackgroundAudio(activeGenre, isMusicMuted) {
  const audioRef = useRef(null);

  useEffect(() => {
    const audio = document.getElementById('main-bg-music');
    if (!audio) return;
    audioRef.current = audio;

    // 1. פונקציה לשחרור החסימה של הדפדפן באינטראקציה ראשונה
    const handleInteraction = () => {
      if (audio.paused && !isMusicMuted) {
        audio.play().catch(err => console.log("Still blocked:", err));
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