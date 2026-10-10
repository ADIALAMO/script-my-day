/**
 * Virtual clock for timing tests of async code: replaces setTimeout/clearTimeout/performance.now/Date.now with a
 * discrete-event scheduler, so a 50-second cascade "runs" instantly and deterministically. No network, no real waiting.
 *   const clock = installVirtualClock();   // returns { run(promise), advance(ms), now(), restore() }
 * `run(promise)` drives virtual time forward (firing timers in order) until the promise settles.
 */
export function installVirtualClock({ epoch = Date.parse('2026-10-11T12:00:00Z') } = {}) {
  const real = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, perfNow: performance.now, dateNow: Date.now, setImmediate: globalThis.setImmediate };
  let now = 0, seq = 0, timers = [];

  globalThis.setTimeout = (fn, ms = 0, ...args) => { const t = { at: now + Math.max(0, ms), id: ++seq, fn: () => fn(...args), dead: false }; timers.push(t); return t; };
  globalThis.clearTimeout = (t) => { if (t) t.dead = true; };
  performance.now = () => now;
  Date.now = () => epoch + now;

  const drain = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => real.setImmediate(r)); };

  return {
    now: () => now,
    advance(ms) { now += ms; },
    async run(promise) {
      let done = false, value, error;
      promise.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
      for (;;) {
        await drain();
        if (done) { if (error) throw error; return value; }
        timers = timers.filter((t) => !t.dead);
        if (!timers.length) throw new Error('virtual clock: promise pending with no timers left (deadlock)');
        timers.sort((a, b) => a.at - b.at || a.id - b.id);
        const t = timers.shift();
        now = Math.max(now, t.at);
        t.fn();
      }
    },
    restore() {
      globalThis.setTimeout = real.setTimeout; globalThis.clearTimeout = real.clearTimeout;
      performance.now = real.perfNow; Date.now = real.dateNow;
    },
  };
}
