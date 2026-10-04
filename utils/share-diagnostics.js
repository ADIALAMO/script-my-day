/**
 * TEMPORARY diagnostic aid for the Android native-share investigation.
 * Grep "TEMP DIAGNOSTIC (share-bug)" across the repo to find every call site —
 * all of them should be removed together once the bug is found/fixed.
 *
 * Fire-and-forget: reportShareAttempt() NEVER throws and is NEVER awaited by
 * its callers. It posts a compact JSON payload to /api/share-diagnostic,
 * which forwards it to the admin Telegram (same pattern as feedback.js).
 * Gated to native (Capacitor) only — the web/iOS Safari path already works
 * per the original bug report, so there's no reason to generate noise there.
 */
import { Capacitor } from '@capacitor/core';
import { isCapacitorNative } from './platform.js';

let appInfoCache = null;
async function getAppInfo() {
  if (appInfoCache) return appInfoCache;
  try {
    const { App } = await import('@capacitor/app');
    appInfoCache = await App.getInfo(); // { name, id, build, version }
  } catch {
    appInfoCache = null;
  }
  return appInfoCache;
}

/**
 * surface: 'poster' | 'comic-panel' | 'comic-all' | 'reel' | 'share-files'
 * outcome: short machine-readable string, e.g. 'guard-blocked', 'native-success',
 *          'native-thrown', 'file-never-resolved', 'shared-false', 'shared-null'
 * steps:   optional [{ step, ms }] trace (ms = elapsed since the previous step)
 * error:   optional { name, message } — never pass a raw Error/stack (keeps payload small)
 * extra:   optional small object of surface-specific details (e.g. fileSize)
 */
export function reportShareAttempt(args) {
  // Everything — including the native-platform check itself — is inside this
  // try/catch. Guarantees the function can NEVER throw synchronously into the
  // real share flow, no matter what (even a Capacitor API misbehaving).
  try {
    const { surface, outcome, steps, error, extra } = args || {};
    if (typeof window === 'undefined' || !isCapacitorNative()) return; // web/iOS — not the bug, skip
    (async () => {
      try {
        const appInfo = await getAppInfo();
        const payload = {
          ts: new Date().toISOString(),
          surface,
          outcome,
          steps: steps || [],
          error: error || null,
          extra: extra || null,
          platform: Capacitor.getPlatform(),
          appVersion: appInfo?.version || null,
          appBuild: appInfo?.build || null,
          userAgent: navigator.userAgent,
        };
        await fetch('/api/share-diagnostic', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } catch {
        // Best-effort only — a failed diagnostic report must never surface to the user
        // or affect the actual share flow in any way.
      }
    })();
  } catch {
    // See comment above — this function must never throw, period.
  }
}
