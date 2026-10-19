/**
 * Shared-device privacy: scripts, the creator name and the "Star Yourself" character link live only in this browser's localStorage, so they must not
 * outlive the person who signed out. Called by the account menu's "Sign out" BEFORE signOut(). Cookie consent, the guided-tour flags, the debug/variant flags
 * and the "reported" hide-list are device settings, not personal content: they stay.
 */
export const PERSONAL_KEYS = [
  'lifescript_history',            // saved scripts, posters, comic panels (raw journal text)
  'lifescript_producer_name',      // the creator credit
  'lifescript_character_url',      // link to the user's Character Sheet
  'lifescript_character_starring',
  'lifescript_character_gender',
];

function store(storage) {
  if (storage) return storage;
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** true when at least one saved production is on this device (so the menu can say what sign-out removes) */
export function hasSavedHistory(storage) {
  try {
    const raw = store(storage)?.getItem('lifescript_history');
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) && parsed.length > 0;
  } catch { return false; }
}

/** removes the personal keys; never throws (private mode / blocked storage) */
export function clearPersonalLocalData(storage) {
  const s = store(storage);
  if (!s) return;
  for (const k of PERSONAL_KEYS) { try { s.removeItem(k); } catch { /* ignore */ } }
}

export const SIGN_OUT_CONFIRM = {
  he: 'ההתנתקות תמחק ממכשיר זה את התסריטים וההיסטוריה השמורים בו. להמשיך?',
  en: 'Signing out removes the saved scripts and history stored on this device. Continue?',
};
