/**
 * TEMP DIAGNOSTIC (reel-crash) — breadcrumb trail for investigating Android
 * reel-generation crashes (the WebView process getting killed, not a
 * catchable JS error). Grep "TEMP DIAGNOSTIC (reel-crash)" to find every
 * call site — all of them, plus this file and pages/api/reel-diagnostic.js,
 * should be removed together once this investigation is closed.
 *
 * Design: each stage is appended to a SHORT trail kept in its own
 * localStorage key — a synchronous write that survives a hard process kill
 * which would drop an in-flight network request. The trail is only ever
 * SENT (via sendBeacon, one message) at a natural endpoint — reel-finished,
 * reel-error, or reel-cancelled — after which it's cleared immediately. If
 * the process is hard-killed before any of those is reached, the key is
 * still sitting in localStorage on the NEXT app launch: recoverOrphanedReelTrail()
 * (called once from pages/_app.js) detects that, sends it tagged
 * "recovered-after-kill", then clears it. Net result: at most ONE Telegram
 * message per reel attempt — not one per breadcrumb stage — to stay well
 * within the existing rate limit even with many testers.
 *
 * No user content is ever included — only stage names, timestamps, counts,
 * byte sizes and booleans.
 */
import { isCapacitorNative } from './platform.js';

const TRAIL_KEY = 'lifescript_reel_trail_temp';
const APP_START_TS = Date.now();

function readTrail() {
  try {
    const raw = localStorage.getItem(TRAIL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeTrail(trail) {
  try {
    localStorage.setItem(TRAIL_KEY, JSON.stringify(trail));
  } catch {
    // best-effort only — never let a diagnostic write break the reel flow
  }
}

function clearTrail() {
  try { localStorage.removeItem(TRAIL_KEY); } catch {}
}

function staticDeviceInfo() {
  if (typeof navigator === 'undefined') return {};
  return {
    userAgent: navigator.userAgent,
    deviceMemory: navigator.deviceMemory ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
  };
}

function memorySnapshot() {
  try {
    const m = typeof performance !== 'undefined' ? performance.memory : null;
    return m ? { usedJSHeapSize: m.usedJSHeapSize, jsHeapSizeLimit: m.jsHeapSizeLimit } : null;
  } catch {
    return null;
  }
}

function send(trail, flag) {
  try {
    const url = '/api/reel-diagnostic';
    const body = JSON.stringify({ flag, trail });
    if (typeof navigator !== 'undefined' && navigator.sendBeacon) {
      navigator.sendBeacon(url, body);
    } else {
      fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    }
  } catch {
    // a diagnostic must never throw into the real reel flow
  }
}

const TERMINAL_STAGES = {
  'reel-finished': 'finished',
  'reel-error': 'error',
  'reel-cancelled': 'cancelled',
};

/**
 * Appends one breadcrumb to the current trail. `extra` is a small, plain
 * object of metadata only (counts, byte sizes, booleans, short strings) —
 * never script text, prompts, or image data. Starts a NEW trail (new
 * sessionId) on 'tap'.
 */
export function reelBreadcrumb(stage, extra = {}) {
  try {
    if (typeof window === 'undefined' || !isCapacitorNative()) return; // this investigation is Android-only

    let trail = readTrail();
    if (stage === 'tap' || !trail) {
      trail = {
        sessionId: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        device: staticDeviceInfo(),
        msSinceAppStart: Date.now() - APP_START_TS,
        steps: [],
      };
    }

    trail.steps.push({ stage, ts: Date.now(), memory: memorySnapshot(), ...extra });
    if (trail.steps.length > 30) trail.steps = trail.steps.slice(-30); // breadcrumb, not a full log
    writeTrail(trail);

    const flag = TERMINAL_STAGES[stage];
    if (flag) {
      send(trail, flag);
      clearTrail();
    }
  } catch {
    // never throw into the reel flow
  }
}

/**
 * Call once at app start (pages/_app.js). A trail left over from a PREVIOUS
 * session never reached reel-finished/reel-error/reel-cancelled — the only
 * three places that clear it — meaning that session ended (almost certainly
 * a hard process kill, since a normal close/cancel is covered by
 * reel-cancelled) mid-reel. Send what was captured, tagged so it's clearly
 * distinguished from a live report, then clear it.
 */
export function recoverOrphanedReelTrail() {
  try {
    if (typeof window === 'undefined' || !isCapacitorNative()) return;
    const trail = readTrail();
    if (!trail) return;
    send(trail, 'recovered-after-kill');
    clearTrail();
  } catch {
    // never throw
  }
}
