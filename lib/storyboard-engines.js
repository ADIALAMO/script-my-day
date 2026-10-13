// Engine scheduling for the storyboard route (pure timing logic, no I/O — unit-tested in tests/storyboard-engines.test.js).
// The cascade used to run engines strictly one after another with no shared deadline: three slow, unparseable answers cost ~45 s of the
// route's 60 s. Now: every attempt gets min(cap, time left); a hedge starts if the leader is slow OR as soon as it fails; nothing starts
// when too little time is left; and the whole stage ends at one deadline so the route can answer (and release the comic quota) in time.

export const ENGINE_DEADLINE_MS = 38000;   // the engine stage must be over this long after the request started
export const ATTEMPT_CAP_MS = 12000;       // one model call never gets longer than this...
export const MIN_ATTEMPT_MS = 3000;        // ...and is not started with less than this left
export const HEDGE_DELAY_MS = 4000;        // the hedge joins the race after this long if the leader has not answered
export const ROUTE_HARD_MS = 55000;        // the route answers (success or clean failure) before this

/** timeout for the next attempt, or 0 when there is not enough time left to start one */
export function attemptTimeout(deadlineAt, now = Date.now(), { cap = ATTEMPT_CAP_MS, min = MIN_ATTEMPT_MS } = {}) {
  const left = deadlineAt - now;
  if (left < min) return 0;
  return Math.min(cap, left);
}

/**
 * Race `tasks` ([{ run: () => Promise<result|null>, delayMs }]) — the first non-null result wins. A task starts after its delay, or immediately
 * once every earlier-started task has already failed (a failed leader never makes the hedge wait). Resolves null when all tasks failed.
 * `run` must not throw (a throw counts as a failure).
 */
export function raceWithHedge(tasks) {
  return new Promise((resolve) => {
    if (!tasks.length) { resolve(null); return; }
    let settled = false;
    let started = 0;
    let finished = 0;
    const timers = [];
    const startTask = (i) => {
      if (settled || i >= tasks.length) return;
      if (started > i) return;
      started = i + 1;
      Promise.resolve().then(() => tasks[i].run()).catch(() => null).then((r) => {
        finished += 1;
        if (settled) return;
        if (r != null) { settled = true; timers.forEach(clearTimeout); resolve(r); return; }
        if (finished === started) {            // everything started so far has failed: bring the next one in NOW
          if (started < tasks.length) startTask(started);
          else { settled = true; timers.forEach(clearTimeout); resolve(null); }
        }
      });
    };
    startTask(0);
    for (let i = 1; i < tasks.length; i++) {
      timers.push(setTimeout(() => startTask(i), Math.max(0, tasks[i].delayMs ?? 0)));
    }
  });
}

/** run attempts one after another until one returns a result; each gets attemptTimeout(deadline). attempts: [(timeoutMs) => Promise<result|null>] */
export async function runUntilDeadline(attempts, deadlineAt, now = () => Date.now()) {
  for (const attempt of attempts) {
    const t = attemptTimeout(deadlineAt, now());
    if (!t) return null;
    const r = await attempt(t).catch(() => null);
    if (r != null) return r;
  }
  return null;
}
