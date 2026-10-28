// Fire-and-forget count of a client-side Star Yourself failure (POST /api/character-event). Sends ONLY one of two fixed words — no file name, type, size,
// image data or identifier. Never throws, never blocks the UI.
const EVENTS = new Set(['decode_failed', 'heic_detected']);

export function sendCharacterEvent(event) {
  if (!EVENTS.has(event) || typeof fetch !== 'function') return;
  try {
    fetch('/api/character-event', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event }), keepalive: true }).catch(() => {});
  } catch { /* advisory only */ }
}
