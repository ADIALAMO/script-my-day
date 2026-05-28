import { useReducer, useEffect, useCallback, useRef } from 'react';

const STORAGE_KEY = 'lifescript_history';
const MAX_ENTRIES = 20;

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

  // Skip persisting the initial render — data came FROM localStorage; writing
  // it back immediately would be a no-op but wastes a serialisation cycle.
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
    } catch {
      // localStorage quota exceeded — silently skip
    }
  }, [history]);

  // Returns the new entry's id so callers can later call updateEntry
  // with the same id (e.g. to attach a poster URL after generation).
  const addEntry = useCallback((fields) => {
    const id = `ls_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    dispatch({ type: 'ADD', payload: { id, createdAt: Date.now(), ...fields } });
    return id;
  }, []);

  const updateEntry = useCallback((id, patch) => {
    if (!id) return;
    dispatch({ type: 'UPDATE', id, patch });
  }, []);

  const deleteEntry = useCallback((id) => {
    dispatch({ type: 'DELETE', id });
  }, []);

  return { history, addEntry, updateEntry, deleteEntry };
}
