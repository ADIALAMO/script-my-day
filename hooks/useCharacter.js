import { useState, useEffect, useRef, useCallback } from 'react';
import { createCharacterStore } from '../utils/character-store.js';

// Maps the user's gender choice → the protagonist descriptor injected into the
// storyboard prompt so Gemini leads every panel with the right hero and Grok
// applies the face to them (never a secondary character). 'neutral' stays
// gender-agnostic while still disambiguating the focal subject.
const GENDER_DESCRIPTOR = {
  male:    'male hero',
  female:  'female hero',
  neutral: 'main hero',
};

/**
 * Owns the Identity Track character state, shared by both the poster and storyboard generation hooks.
 * All state and rules live in utils/character-store.js (one definition of `hasCharacter`, persisted `starring`, restore-vs-mutation ordering); this hook only
 * binds that store to React. `activeCharacterUrl` is what the generation hooks send: the URL only when a character exists AND starring is on, else null
 * (→ cheap standard generation path).
 *
 * `gender` is the lifted single source of truth from `useGender` (set in ScriptForm before the script is generated).
 */
export function useCharacter(gender = 'neutral') {
  const storeRef = useRef(null);
  if (!storeRef.current) {
    let storage = null;
    try { if (typeof window !== 'undefined') storage = window.localStorage; } catch { /* blocked storage: the store still works in memory */ }
    storeRef.current = createCharacterStore({ storage, getFetch: () => globalThis.fetch.bind(globalThis) });
  }
  const store = storeRef.current;
  const [snap, setSnap] = useState(store.getState());
  useEffect(() => {
    const off = store.subscribe(setSnap);
    store.restore();
    return off;
  }, [store]);

  const uploadCharacter = useCallback((selfieBase64, consent = false) => store.upload(selfieBase64, consent), [store]);
  const confirmAdult = useCallback(() => store.confirmAdult(), [store]);
  const removeCharacter = useCallback(() => store.remove(), [store]);
  const clearCharacter = useCallback(() => store.clear(), [store]);
  const dismissCharacterExpired = useCallback(() => store.dismissExpired(), [store]);
  const setStarring = useCallback((v) => store.setStarring(v), [store]);

  const heroDescriptor = snap.activeCharacterUrl ? GENDER_DESCRIPTOR[gender] : null;

  return {
    characterImageUrl: snap.url,
    hasCharacter: snap.hasCharacter,
    activeCharacterUrl: snap.activeCharacterUrl,
    heroDescriptor,
    starring: snap.starring,
    setStarring,
    status: snap.status,
    error: snap.error,
    uploadCharacter,
    characterExpired: snap.expired,
    dismissCharacterExpired,
    adultConfirmed: snap.adultConfirmed === true,
    confirmAdult,
    clearCharacter,
    removeCharacter,
  };
}
