import { useState, useEffect, useCallback } from 'react';

// localStorage keys — mirrors the existing `lifescript_device_id` convention.
const LS_KEY          = 'lifescript_character_url';
const LS_STARRING_KEY = 'lifescript_character_starring';

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
 * `starring` is persisted (LS_STARRING_KEY), not a per-session default: the
 * FIRST time a character becomes ready on this device — a fresh upload, or a
 * cache/backend restore with no prior preference on record (e.g. an existing
 * user from before this persistence existed) — it defaults ON, since the
 * whole point of uploading is to be in the poster. Every explicit toggle
 * after that is remembered and respected on every later visit/upload.
 * `activeCharacterUrl` is the value the generation hooks should actually
 * send: the URL only when a character exists AND starring is on — otherwise
 * null (→ cheap standard generation path).
 *
 * `gender` is no longer owned here — it is the lifted single source of truth from
 * `useGender` (set in ScriptForm before the script is even generated) and is
 * passed in so the storyboard's HERO IDENTITY block matches the script's hero.
 */
export function useCharacter(gender = 'neutral') {
  const [characterImageUrl, setCharacterImageUrl] = useState('');
  const [starring, setStarringState] = useState(false);
  const [status, setStatus]     = useState('idle'); // idle | loading | ready | error
  const [error, setError]       = useState('');

  // Every explicit toggle (from the UI, or the defaulting logic below) is
  // persisted immediately — this is what makes it "remember the user's last
  // choice" instead of resetting on every mount. Supports the same functional-
  // updater calling convention as the raw useState setter it replaces.
  const setStarring = useCallback((value) => {
    setStarringState((prev) => {
      const next = typeof value === 'function' ? value(prev) : value;
      if (typeof window !== 'undefined') {
        try { localStorage.setItem(LS_STARRING_KEY, next ? '1' : '0'); } catch { /* ignore */ }
      }
      return next;
    });
  }, []);

  // First time ever a character becomes ready on this device (no persisted
  // preference yet) → default starring ON. A later re-upload or restore with
  // a preference already on record leaves it untouched.
  const defaultStarringOnIfUnset = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem(LS_STARRING_KEY) !== null) return; // user already made a choice
    setStarring(true);
  }, [setStarring]);

  // ── Restore on mount ────────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storedStarring = localStorage.getItem(LS_STARRING_KEY);
    if (storedStarring !== null) setStarringState(storedStarring === '1');

    const cached = localStorage.getItem(LS_KEY);
    if (cached) { setCharacterImageUrl(cached); setStatus('ready'); defaultStarringOnIfUnset(); }

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
          defaultStarringOnIfUnset();
        }
      } catch {
        /* offline — the localStorage value (if any) stands */
      }
    })();
  }, [defaultStarringOnIfUnset]);

  // ── Upload (the one-time, paid, two-stage pipeline) ─────────────────────────
  const uploadCharacter = useCallback(async (selfieBase64, consent = false) => {
    setStatus('loading');
    setError('');
    try {
      const deviceId = localStorage.getItem('lifescript_device_id') || '';
      const r = await fetch('/api/upload-character', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'x-device-id': deviceId },
        body:    JSON.stringify({ selfieBase64, consent }),
      });
      const d = await r.json();

      if (r.status === 403) {
        setStatus('error');
        setError('NEEDS_PRO');
        return { ok: false, code: 'NEEDS_PRO' };
      }
      if (d.success && d.characterImageUrl) {
        setCharacterImageUrl(d.characterImageUrl);
        setStatus('ready');
        localStorage.setItem(LS_KEY, d.characterImageUrl);
        defaultStarringOnIfUnset();
        return { ok: true, characterImageUrl: d.characterImageUrl };
      }
      setStatus('error');
      setError(d.code || 'SERVER_ERROR');
      return { ok: false, code: d.code || 'SERVER_ERROR', limit: d.limit, resetsAt: d.resetsAt };
    } catch {
      setStatus('error');
      setError('NETWORK_OFFLINE');
      return { ok: false, code: 'NETWORK_OFFLINE' };
    }
  }, [defaultStarringOnIfUnset]);

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
    status,
    error,
    uploadCharacter,
    clearCharacter,
  };
}
