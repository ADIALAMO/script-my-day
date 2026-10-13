// The "Create script" flow as a small state machine (pure; no React, no DOM; unit-tested in tests/script-flow.test.js).
//
//   idle ──tap──▶ generating ──script arrives──▶ awaiting-output ──ScriptOutput starts typing──▶ typing ──typing ends / is skipped──▶ idle
//
// The button is LOCKED in every phase except idle: from the tap (synchronously — `phase` is a plain field, not React state, so a second tap in the same frame sees it)
// until the typewriter has FINISHED. Anything that ends the attempt without a typed script (error, quota, cancel/abort, a script opened from History, ScriptOutput
// unmounting) unlocks it. A script that appears without typing (History) never locks.
//
// An existing script (idle + a script on screen) turns a tap into a confirmation first: nothing is sent and nothing is cleared until the user continues.
//
// Why `awaiting-output` exists: between "the script arrived" and "ScriptOutput mounted and started typing" the page is neither generating nor typing; unlocking there let a
// second tap through, and the exiting previous ScriptOutput reports a stale "typing ended" in that window — which is ignored.
export const AWAIT_OUTPUT_MS = 8000;   // watchdog: if the output never starts typing (it failed to mount) the lock must not stay forever

export function createScriptFlow({ onStart, schedule = setTimeout, cancelSchedule = clearTimeout, awaitMs = AWAIT_OUTPUT_MS } = {}) {
  let phase = 'idle';
  let pending = null;          // { entry, genre } waiting for the overwrite confirmation
  let timer = null;
  let state = { phase, locked: false, confirming: false };
  const listeners = new Set();
  const publish = () => {
    state = { phase, locked: phase !== 'idle', confirming: !!pending };
    for (const l of listeners) l(state);
  };
  const clearTimer = () => { if (timer !== null) { cancelSchedule(timer); timer = null; } };
  const setPhase = (p) => {
    if (p === phase) return;
    phase = p; clearTimer();
    if (p === 'awaiting-output') timer = schedule(() => { timer = null; if (phase === 'awaiting-output') { phase = 'idle'; publish(); } }, awaitMs);
  };

  function start(entry, genre) {
    if (phase !== 'idle') return false;     // synchronous lock: the second tap of a double-tap ends here
    pending = null;
    setPhase('generating'); publish();
    onStart?.(entry, genre);
    return true;
  }

  return {
    getState: () => state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },

    /** the user tapped Create script. Returns 'started' | 'confirm' | 'ignored' */
    request(entry, genre, { hasScript = false } = {}) {
      if (phase !== 'idle' || pending) return 'ignored';
      if (hasScript) { pending = { entry, genre }; publish(); return 'confirm'; }
      return start(entry, genre) ? 'started' : 'ignored';
    },
    /** "Continue" in the overwrite dialog */
    confirm() { if (!pending) return false; const { entry, genre } = pending; return start(entry, genre); },
    /** cancel / Escape / Back / backdrop: nothing changes, nothing was sent */
    cancel() { if (!pending) return false; pending = null; publish(); return true; },

    /** the request returned a script (it will be typed) */
    scriptReady() { if (phase === 'generating') { setPhase('awaiting-output'); publish(); } },
    /** ScriptOutput's typewriter: true = started, false = finished / skipped / unmounted */
    outputTyping(on) {
      if (on && phase === 'awaiting-output') { setPhase('typing'); publish(); }
      else if (!on && phase === 'typing') { setPhase('idle'); publish(); }
      // `false` while generating / awaiting-output is the previous output's stale report: ignored on purpose
    },
    /** the attempt ended without a script to type: error, quota, auth prompt, abort, cancel (the fetch's `finally` calls this too; a no-op once a script is on its way) */
    generationEnded() { if (phase === 'generating') { setPhase('idle'); publish(); } },
    /** a script is shown without typing (History) or the screen was cleared: never locked */
    scriptReplaced() { if (phase !== 'idle') { setPhase('idle'); } pending = null; publish(); },
  };
}
