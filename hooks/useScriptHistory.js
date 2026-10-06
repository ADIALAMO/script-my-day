import { useReducer, useEffect, useCallback, useRef, useState } from 'react';

const STORAGE_KEY = 'lifescript_history';
const MAX_ENTRIES = 20;

function isDataUri(v) {
  return typeof v === 'string' && v.startsWith('data:');
}

// Rough "how much of this entry is a leftover data: URI" weight, used only to
// pick which entries to strip first when a save is over quota — not a precise
// byte count, just enough to prefer the biggest offenders.
function entryWeight(entry) {
  let w = 0;
  if (isDataUri(entry.posterUrl)) w += entry.posterUrl.length;
  if (Array.isArray(entry.panels)) {
    for (const p of entry.panels) if (isDataUri(p?.imageUrl)) w += p.imageUrl.length;
  }
  return w;
}

// Returns a NEW entry with every data: URI field nulled out. Used only to
// build a smaller candidate for localStorage — never applied to the live
// `history` state the UI renders from, so a user never loses what they can
// currently see just because persistence is tight on space.
function stripDataUris(entry) {
  const next = { ...entry };
  if (isDataUri(next.posterUrl)) next.posterUrl = '';
  if (Array.isArray(next.panels)) {
    next.panels = next.panels.map(p => (isDataUri(p?.imageUrl) ? { ...p, imageUrl: null } : p));
  }
  return next;
}

// ─── Reducer ─────────────────────────────────────────────────────────────────
function reducer(state, action) {
  switch (action.type) {
    case 'INIT':
      return action.payload;
    case 'ADD':
      // Newest first; hard-cap at MAX_ENTRIES (drops the oldest)
      return [action.payload, ...state].slice(0, MAX_ENTRIES);
    case 'UPDATE':
      return state.map(e => e.id === action.id ? { ...e, ...action.patch } : e);
    case 'DELETE':
      return state.filter(e => e.id !== action.id);
    default:
      return state;
  }
}

// Lazy initializer — runs once at mount, synchronously reads localStorage.
// Returning [] on the server (no window) is safe because HomePage is
// guarded by `if (!mounted) return null` so this hook never runs SSR.
function initFromStorage() {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
export function useScriptHistory() {
  const [history, dispatch] = useReducer(reducer, undefined, initFromStorage);

  // True only when the most recent persistence attempt could not fit ANYTHING
  // (not even the single entry currently being written) into localStorage —
  // see the retry/prune cascade below. Does not affect the live `history`
  // state the UI renders; it only means the current session's work may not
  // survive a reload.
  const [saveFailed, setSaveFailed] = useState(false);

  // Skip persisting the initial render — data came FROM localStorage; writing
  // it back immediately would be a no-op but wastes a serialisation cycle.
  const isFirstRender = useRef(true);

  // The id of whichever entry addEntry/updateEntry most recently touched —
  // never a candidate for stripping or dropping below, so the save path can
  // never destroy the very thing the user just did.
  const lastTouchedIdRef = useRef(null);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const attempt = (candidate) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(candidate));
        return true;
      } catch {
        return false;
      }
    };

    if (attempt(history)) { setSaveFailed(false); return; }

    // Over quota. Strip leftover data: URIs from OTHER entries — largest
    // first — one at a time, retrying after each, before ever dropping
    // anything. The entry just written is never touched here.
    const protectedId = lastTouchedIdRef.current;
    const strippable = history
      .filter(e => e.id !== protectedId && entryWeight(e) > 0)
      .sort((a, b) => entryWeight(b) - entryWeight(a));

    let working = history;
    for (const target of strippable) {
      working = working.map(e => (e.id === target.id ? stripDataUris(e) : e));
      if (attempt(working)) { setSaveFailed(false); return; }
    }

    // Still over quota even with every stray data URI stripped — drop the
    // oldest OTHER entries one at a time (last resort), oldest first.
    const droppable = working.filter(e => e.id !== protectedId);
    for (let cut = droppable.length - 1; cut >= 0; cut--) {
      const keepIds = new Set([protectedId, ...droppable.slice(0, cut).map(e => e.id)]);
      const trimmed = working.filter(e => keepIds.has(e.id));
      if (attempt(trimmed)) { setSaveFailed(false); return; }
    }

    // Couldn't persist even a single entry.
    setSaveFailed(true);
  }, [history]);

  // Returns the new entry's id so callers can later call updateEntry
  // with the same id (e.g. to attach a poster URL after generation).
  const addEntry = useCallback((fields) => {
    const id = `ls_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    lastTouchedIdRef.current = id;
    dispatch({ type: 'ADD', payload: { id, createdAt: Date.now(), ...fields } });
    return id;
  }, []);

  const updateEntry = useCallback((id, patch) => {
    if (!id) return;
    lastTouchedIdRef.current = id;
    dispatch({ type: 'UPDATE', id, patch });
  }, []);

  const deleteEntry = useCallback((id) => {
    dispatch({ type: 'DELETE', id });
  }, []);

  return { history, addEntry, updateEntry, deleteEntry, saveFailed };
}
