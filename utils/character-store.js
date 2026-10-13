/**
 * Client-side "Star Yourself" character state — ONE store, ONE definition of "has a character" (hooks/useCharacter.js is a thin React wrapper).
 *
 *   hasCharacter   = a character URL is known. Nothing else: not "status === ready", not "a request is running", not "the last upload failed".
 *                    The chip / Star toggle, the generation hooks and the modal all read this, so they can never disagree.
 *   starring       = the user wants the face in the poster/comic. Persisted. A fresh upload is an explicit opt-in → it ALWAYS turns starring on; removing the
 *                    character forgets the preference (the next character starts from the default, ON). A restore keeps the user's persisted choice.
 *   phase/error    = the progress of the current request only. A failed re-upload leaves the existing character (and the button) exactly as they were.
 *
 * Persistence: localStorage (instant, same device) + GET /api/character (authoritative). A slow restore answer never overwrites a newer local
 * change (upload / remove), which is what used to resurrect a just-removed character.
 */
export const LS_URL = 'lifescript_character_url';
export const LS_STARRING = 'lifescript_character_starring';
const LS_DEVICE = 'lifescript_device_id';

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

export function createCharacterStore({ storage = null, fetchFn = null, getFetch } = {}) {
  const get = (k) => (storage ? safe(() => storage.getItem(k)) : null);
  const set = (k, v) => { if (storage) safe(() => storage.setItem(k, v)); };
  const del = (k) => { if (storage) safe(() => storage.removeItem(k)); };
  const doFetch = (...a) => (fetchFn || getFetch?.() || globalThis.fetch)(...a);

  let seq = 0;   // bumped by every local mutation (upload success / remove / clear); a restore that started earlier is discarded
  let state = { url: '', phase: 'idle', error: '', starring: false };
  const listeners = new Set();
  const view = () => ({
    ...state,
    hasCharacter: !!state.url,
    // compat with the modal: 'loading' while a request runs, otherwise derived from the URL alone
    status: state.phase === 'loading' ? 'loading' : state.url ? 'ready' : state.error ? 'error' : 'idle',
    activeCharacterUrl: state.url && state.starring ? state.url : null,
  });
  let snapshot = view();
  const commit = (patch) => { state = { ...state, ...patch }; snapshot = view(); for (const l of listeners) l(snapshot); };

  const persistStarring = (on) => set(LS_STARRING, on ? '1' : '0');
  const defaultStarringOnIfUnset = () => { if (get(LS_STARRING) === null) { persistStarring(true); return true; } return false; };

  return {
    getState: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    setStarring(value) {
      const next = typeof value === 'function' ? !!value(state.starring) : !!value;
      persistStarring(next); commit({ starring: next });
    },

    /** local cache first (instant), then the server (authoritative; survives a cache wipe / device switch) */
    async restore() {
      const mine = seq;
      const pref = get(LS_STARRING);
      const cached = get(LS_URL);
      if (cached) { defaultStarringOnIfUnset(); commit({ url: cached, phase: 'idle', error: '', starring: get(LS_STARRING) === '1' }); }
      else if (pref !== null) commit({ starring: pref === '1' });
      try {
        const r = await doFetch('/api/character');
        if (!r.ok) return;
        const d = await r.json();
        if (seq !== mine) return;   // the user uploaded / removed in the meantime: that is newer than this answer
        if (d?.characterImageUrl) {
          set(LS_URL, d.characterImageUrl); defaultStarringOnIfUnset();
          commit({ url: d.characterImageUrl, phase: 'idle', error: '', starring: get(LS_STARRING) === '1' });
        }
      } catch { /* offline — the cached value (if any) stands */ }
    },

    async upload(selfieBase64, consent = false, adult = false) {
      commit({ phase: 'loading', error: '' });
      try {
        const r = await doFetch('/api/upload-character', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-device-id': get(LS_DEVICE) || '' },
          body: JSON.stringify({ selfieBase64, consent, adult }),
        });
        const d = await r.json();
        if (r.status === 403) { commit({ phase: 'error', error: 'NEEDS_PRO' }); return { ok: false, code: 'NEEDS_PRO' }; }
        if (d.success && d.characterImageUrl) {
          seq += 1;
          set(LS_URL, d.characterImageUrl);
          persistStarring(true);   // a new character is an explicit opt-in: the button is ON right away, whatever an earlier choice was
          commit({ url: d.characterImageUrl, phase: 'idle', error: '', starring: true });
          return { ok: true, characterImageUrl: d.characterImageUrl };
        }
        commit({ phase: 'error', error: d.code || 'SERVER_ERROR' });
        return { ok: false, code: d.code || 'SERVER_ERROR', limit: d.limit, resetsAt: d.resetsAt };
      } catch {
        commit({ phase: 'error', error: 'NETWORK_OFFLINE' });
        return { ok: false, code: 'NETWORK_OFFLINE' };
      }
    },

    /** "Remove my character": server first (owner only), then forget it here */
    async remove() {
      try {
        const r = await doFetch('/api/character', { method: 'DELETE' });
        const d = await r.json().catch(() => ({}));
        if (r.ok && d.success) {
          this.clear();
          return { ok: true, partial: d.partial === true, status: d.status || 'removed', failed: Number(d.failed) || 0 };
        }
        return { ok: false, code: d.code || (r.status === 429 ? 'RATE_LIMITED' : 'SERVER_ERROR') };
      } catch { return { ok: false, code: 'NETWORK_OFFLINE' }; }
    },

    /** forget the character on this client only (the server is not touched); the starring preference is forgotten with it */
    clear() {
      seq += 1;
      del(LS_URL); del(LS_STARRING);
      commit({ url: '', phase: 'idle', error: '', starring: false });
    },
  };
}
