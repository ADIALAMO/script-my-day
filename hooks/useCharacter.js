import { useState, useEffect, useCallback } from 'react';

// localStorage keys — mirror the existing `lifescript_device_id` convention.
const LS_KEY        = 'lifescript_character_url';
const LS_GENDER_KEY = 'lifescript_character_gender';

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
 * Owns the Identity Track character state, shared by both the poster and
 * storyboard generation hooks.
 *
 * Persistence is two-layered:
 *   1. localStorage  — instant restore on the same device (zero network).
 *   2. GET /api/character — authoritative restore across devices / cache clears,
 *      so a returning user never re-runs the paid two-stage upload pipeline.
 *
 * `starring` is the per-session toggle. `activeCharacterUrl` is the value the
 * generation hooks should actually send: the URL only when a character exists
 * AND starring is on — otherwise null (→ cheap standard generation path).
 */
export function useCharacter() {
  const [characterImageUrl, setCharacterImageUrl] = useState('');
  const [starring, setStarring] = useState(true);
  const [status, setStatus]     = useState('idle'); // idle | loading | ready | error
  const [error, setError]       = useState('');
  const [gender, setGenderState] = useState('neutral'); // 'male' | 'female' | 'neutral'

  // Persist the gender choice so the disambiguation descriptor survives reloads.
  const setGender = useCallback((g) => {
    setGenderState(g);
    if (typeof window !== 'undefined') localStorage.setItem(LS_GENDER_KEY, g);
  }, []);

  // ── Restore on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const cachedGender = localStorage.getItem(LS_GENDER_KEY);
    if (cachedGender && GENDER_DESCRIPTOR[cachedGender]) setGenderState(cachedGender);

    const cached = localStorage.getItem(LS_KEY);
    if (cached) { setCharacterImageUrl(cached); setStatus('ready'); }

    // Backend restore (authoritative). Survives a cache wipe / device switch.
    (async () => {
      try {
        const r = await fetch('/api/character');
        if (!r.ok) return;
        const d = await r.json();
        if (d?.characterImageUrl) {
          setCharacterImageUrl(d.characterImageUrl);
          setStatus('ready');
          localStorage.setItem(LS_KEY, d.characterImageUrl);
        }
      } catch {
        /* offline — the localStorage value (if any) stands */
      }
    })();
  }, []);

  // ── Upload (the one-time, paid, two-stage pipeline) ─────────────────────────
  const uploadCharacter = useCallback(async (selfieBase64) => {
    setStatus('loading');
    setError('');
    try {
      const deviceId = localStorage.getItem('lifescript_device_id') || '';
      const r = await fetch('/api/upload-character', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
        body:    JSON.stringify({ selfieBase64 }),
      });
      const d = await r.json();

      if (r.status === 403) {
        setStatus('error');
        setError('NEEDS_PRO');
        return { ok: false, code: 'NEEDS_PRO' };
      }
      if (d.success && d.characterImageUrl) {
        setCharacterImageUrl(d.characterImageUrl);
        setStarring(true);
        setStatus('ready');
        localStorage.setItem(LS_KEY, d.characterImageUrl);
        return { ok: true, characterImageUrl: d.characterImageUrl };
      }
      setStatus('error');
      setError(d.code || 'SERVER_ERROR');
      return { ok: false, code: d.code || 'SERVER_ERROR' };
    } catch {
      setStatus('error');
      setError('NETWORK_OFFLINE');
      return { ok: false, code: 'NETWORK_OFFLINE' };
    }
  }, []);

  // ── Forget the character on this client (does not delete from R2/Redis) ─────
  const clearCharacter = useCallback(() => {
    setCharacterImageUrl('');
    setStatus('idle');
    setError('');
    if (typeof window !== 'undefined') localStorage.removeItem(LS_KEY);
  }, []);

  // Only inject the reference when a character is ready AND the user wants it.
  const activeCharacterUrl = (status === 'ready' && starring) ? characterImageUrl : null;

  // Dynamic protagonist descriptor — non-null only when the Identity Track is active,
  // so the storyboard route injects the HERO IDENTITY block with the correct gender.
  const heroDescriptor = activeCharacterUrl ? GENDER_DESCRIPTOR[gender] : null;

  return {
    characterImageUrl,
    activeCharacterUrl,
    heroDescriptor,
    starring,
    setStarring,
    gender,
    setGender,
    status,
    error,
    uploadCharacter,
    clearCharacter,
  };
}
