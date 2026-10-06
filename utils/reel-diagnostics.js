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

// Stages that must NEVER be evicted by the rolling cap below — the one-off
// early stages (carrying mount's comicSource/data-URI census, the panel/audio
// decode timings) plus the three terminal stages. Only 'frame' (the periodic
// progress marker, many per reel) is actually meant to roll. A full 7-panel
// reel at the current marker cadence produces ~19 total steps — under the cap
// today — but pinning these explicitly means that stays true even if panel
// count or marker frequency changes later, instead of relying on that margin.
const PINNED_STAGES = new Set([
  'tap', 'mount', 'generate-start', 'panels-decoded', 'audio-decoded', 'recorder-start',
  'reel-finished', 'reel-error', 'reel-cancelled',
]);
const MAX_ROLLING_STEPS = 24; // 'frame' markers only

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
    // Cap only the ROLLING (non-pinned) steps — i.e. 'frame' markers — so the
    // one-off early/terminal stages above are never the ones evicted in a
    // late crash during a long render.
    const pinned = trail.steps.filter(s => PINNED_STAGES.has(s.stage));
    let rolling = trail.steps.filter(s => !PINNED_STAGES.has(s.stage));
    if (rolling.length > MAX_ROLLING_STEPS) rolling = rolling.slice(-MAX_ROLLING_STEPS);
    trail.steps = [...pinned, ...rolling].sort((a, b) => a.ts - b.ts);
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
