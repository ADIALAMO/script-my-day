import { useState, useEffect, useCallback } from 'react';

// Single source of truth for the protagonist's gender across ALL three outputs
// (script → poster → comic). Lifted up to the page so ScriptForm can set it
// *before* the script is generated and ScriptOutput can reuse the same value for
// the Identity Track — no more split identity between script and comic.
//
// Persistence mirrors the original useCharacter convention: a *manual* choice is
// remembered across reloads/sessions. An *auto-suggestion* from the morphology
// detector is applied to the live UI but never persisted and never overrides a
// choice the user already made.
const LS_GENDER_KEY = 'lifescript_character_gender';
const VALID = ['male', 'female', 'neutral'];

export function useGender() {
  const [gender, setGenderState] = useState('neutral');
  // True once the user picks a pill OR a persisted choice is restored. Locks out
  // further auto-suggestions, and lets the UI tell a confirmed pick from an
  // unconfirmed auto-detection. State (not a ref) so the hint re-renders.
  const [genderTouched, setTouched] = useState(false);

  // Restore a previously confirmed choice (authoritative).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const cached = localStorage.getItem(LS_GENDER_KEY);
    if (cached && VALID.includes(cached)) {
      setGenderState(cached);
      setTouched(true);
    }
  }, []);

  // Manual pick — persists and locks out auto-suggestions.
  const setGender = useCallback((g) => {
    if (!VALID.includes(g)) return;
    setTouched(true);
    setGenderState(g);
    if (typeof window !== 'undefined') localStorage.setItem(LS_GENDER_KEY, g);
  }, []);

  // Auto-suggestion from the detector — applied only while the user hasn't chosen,
  // and intentionally NOT persisted (only a deliberate tap should survive reloads).
  const suggestGender = useCallback((g) => {
    if (!VALID.includes(g)) return;
    setTouched((touched) => {
      if (!touched) setGenderState(g);
      return touched;
    });
  }, []);

  return { gender, setGender, suggestGender, genderTouched };
}

export default useGender;
