/**
 * Per-model circuit breaker for the SCRIPT cascade (lib/story-service.js).
 *
 * Why: when a model answers HTTP 429 (quota / rate limit) every following request used to ask it again first. A 429 is
 * fast (~150–500 ms), so the cost is small per request — but it is a wasted call against the provider's quota every
 * time, and an extra hop. After a 429 the model is now skipped for a while.
 *
 * Same safety pattern as lib/circuit-breaker.js (images) and lib/alert-throttle.js, but a SEPARATE module: the image
 * breaker is hard-wired to the `circuit:img:` prefix and a fixed PROVIDERS list.
 *   • Redis keys:  circuit:script:<model-id>          → {openUntil, kind}   (SET NX EX = the TTL is the pause)
 *                  circuit:script:strikes:<model-id>  → number of consecutive 429 "re-openings" (TTL strikeTtlSec)
 *   • Only an HTTP 429 trips it. Timeouts, 5xx, empty answers, config errors never do.
 *   • FAIL-OPEN: every Redis call is capped (SCRIPT_CIRCUIT.redisBudgetMs, 500 ms); on timeout/error the breaker uses
 *     per-instance memory only and the cascade proceeds exactly as if no breaker existed. It can never block a request
 *     by itself being broken, and it never throws.
 *   • Half-open is implicit: when the pause (the key's TTL) ends, the next request simply tries the model again. A 429
 *     on that first call after a pause (no success in between) is the "2nd consecutive 429" → longer pause (escalate).
 *     A success deletes both keys.
 *
 * 429 CLASSIFICATION (minute vs day) — READ THIS BEFORE TRUSTING THE DAY PATH:
 *   Google's free-tier 429 body can carry `error.details[].violations[].quotaId`, e.g. "...PerDay..." vs "...PerMinute...".
 *   NO real 429 body with those details has ever been captured in this repo (tools/quality-eval stored only the first
 *   160 chars of `error.message`, "You exceeded your current quota, please check your plan and billing details…", which
 *   is identical for both kinds). So the day path is an UNVERIFIED assumption and deliberately conservative:
 *     - 'day' only if the body text mentions "PerDay" and does NOT mention "PerMinute"; anything else (no body, truncated,
 *       other wording, mixed) gets the per-minute pause (labelled 'minute' or 'unknown', see classify429).
 *     - Google's daily quota resets at midnight PACIFIC time, not UTC → the pause runs to the next America/Los_Angeles
 *       midnight, capped at 24 h and at least one minute. (DST-change days can be off by an hour; harmless.)
 *   Even if classification never fires, the 60 s pause + escalate-to-15-min path still stops the repeated asking.
 */
import redis from './redis.js';
import { SCRIPT_CIRCUIT } from '../config/limits.js';

const PREFIX = 'circuit:script:';
const circuitKey = (m) => `${PREFIX}${m}`;
const strikesKey = (m) => `${PREFIX}strikes:${m}`;

// Per-instance fallback + warm cache: model -> { openUntil, strikes, strikesUntil }
const memory = new Map();

/**
 * 'day'     — body names a per-day quota and not a per-minute one.
 * 'minute'  — body names a per-minute limit.
 * 'unknown' — neither is recognisable (no body, truncated, other wording, e.g. the plain "You exceeded your current
 *             quota…" message). Treated exactly like 'minute' for the pause; the label only exists so the first real
 *             alert shows which path was taken.
 */
export function classify429(bodyText) {
  const t = String(bodyText ?? '');
  const day = /PerDay/i.test(t), minute = /PerMinute/i.test(t);
  if (day && !minute) return 'day';
  return minute ? 'minute' : 'unknown';
}

/** Milliseconds until the next midnight in America/Los_Angeles, clamped to [60 s, 24 h]. */
export function msUntilPacificMidnight(now = Date.now()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(now));
    const get = (t) => parseInt(parts.find((p) => p.type === t)?.value ?? '0', 10);
    const elapsed = ((get('hour') % 24) * 3600 + get('minute') * 60 + get('second')) * 1000; // some ICU builds print midnight as "24"
    return Math.min(86_400_000, Math.max(60_000, 86_400_000 - elapsed));
  } catch {
    return 6 * 3600_000; // Intl unavailable: a conservative few hours, never a whole day
  }
}

// Runs one Redis step under the cap. Resolves { ok, value }; never rejects.
async function capped(fn) {
  let timer;
  try {
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('redis timeout')), SCRIPT_CIRCUIT.redisBudgetMs); });
    return { ok: true, value: await Promise.race([fn(), timeout]) };
  } catch (e) {
    return { ok: false, error: e };
  } finally {
    clearTimeout(timer);
  }
}

const parseState = (v) => {
  if (!v) return null;
  try { return typeof v === 'object' ? v : JSON.parse(v); } catch { return null; }
};

/**
 * Loads the circuit state for `models` (one MGET, capped) and returns a per-request handle.
 * @param {string[]} models
 */
export async function loadScriptCircuit(models) {
  const now0 = Date.now();
  const openFromRedis = new Set();
  const strikesFromRedis = new Map();
  const seen = new Set();       // models whose Redis state existed at load → success must clean it up
  const pending = [];

  if (SCRIPT_CIRCUIT.enabled && models.length) {
    // Everything already known to be open in this instance? Skip the Redis round-trip entirely.
    const allOpenLocally = models.every((m) => (memory.get(m)?.openUntil ?? 0) > now0);
    if (!allOpenLocally) {
      const r = await capped(() => redis.mget(...models.map(circuitKey), ...models.map(strikesKey)));
      if (r.ok && Array.isArray(r.value)) {
        const now = Date.now();
        models.forEach((m, i) => {
          const st = parseState(r.value[i]);
          if (st?.openUntil && st.openUntil > now) { openFromRedis.add(m); seen.add(m); }
          const n = parseInt(r.value[models.length + i], 10);
          if (n > 0) { strikesFromRedis.set(m, n); seen.add(m); }
        });
      } else if (!r.ok) {
        console.warn(`⚠️ Script circuit read failed — using per-instance state only: ${r.error?.message}`);
      }
    }
  }

  const strikesOf = (m) => {
    const mem = memory.get(m);
    const memStrikes = mem && (mem.strikesUntil ?? 0) > Date.now() ? mem.strikes : 0;
    return Math.max(memStrikes, strikesFromRedis.get(m) ?? 0);
  };

  return {
    /** true → skip this model (it answered 429 recently). */
    isOpen(model) {
      if (!SCRIPT_CIRCUIT.enabled) return false;
      return openFromRedis.has(model) || (memory.get(model)?.openUntil ?? 0) > Date.now();
    },

    /**
     * Report a failed call. Only HTTP 429 does anything. Returns { opened, kind } — opened is true when THIS call opened
     * the circuit (so the caller can alert exactly once); the Redis write is queued and settled by flush().
     * @param {string} model
     * @param {{status?: number, bodyText?: string, escalate?: boolean}} info  escalate: apply the 2-consecutive-429 rule
     */
    recordFailure(model, { status, bodyText = '', escalate = false } = {}) {
      if (!SCRIPT_CIRCUIT.enabled || status !== 429) return { opened: false };
      const now = Date.now();
      const mem = memory.get(model);
      if (this.isOpen(model)) return { opened: false }; // a request that started before the pause: don't double count

      const kind = classify429(bodyText);
      const strikes = strikesOf(model);
      const ttlMs = kind === 'day' ? msUntilPacificMidnight(now)
                  : escalate && strikes >= 1 ? SCRIPT_CIRCUIT.escalatedOpenMs
                  : SCRIPT_CIRCUIT.rpmOpenMs;
      const countsAsStrike = escalate && kind !== 'day';
      memory.set(model, {
        openUntil: now + ttlMs,
        strikes: countsAsStrike ? strikes + 1 : (mem?.strikes ?? 0),
        strikesUntil: countsAsStrike ? now + SCRIPT_CIRCUIT.strikeTtlSec * 1000 : (mem?.strikesUntil ?? 0),
      });
      console.warn(`⚠️ Script circuit OPEN: ${model} (HTTP 429, ${kind}) — skipped for ${Math.round(ttlMs / 1000)}s`);

      pending.push((async () => {
        // SET NX: of several concurrent requests that all just saw the 429, exactly one writes (and counts the strike).
        const set = await capped(() => redis.set(circuitKey(model), { openUntil: now + ttlMs, kind }, { nx: true, ex: Math.max(1, Math.ceil(ttlMs / 1000)) }));
        if (set.ok && set.value !== null && set.value !== undefined && countsAsStrike) {
          await capped(async () => { await redis.incr(strikesKey(model)); await redis.expire(strikesKey(model), SCRIPT_CIRCUIT.strikeTtlSec); });
        }
      })());
      return { opened: true, kind };
    },

    /** Report a success: clears whatever state this model had. No Redis traffic in the normal (healthy) case. */
    recordSuccess(model) {
      if (!SCRIPT_CIRCUIT.enabled) return;
      const had = memory.delete(model) || seen.has(model);
      if (had) pending.push(capped(() => redis.del(circuitKey(model), strikesKey(model))));
    },

    /** Settles queued Redis writes, bounded by the Redis cap. Never throws. */
    async flush() {
      if (!pending.length) return;
      let timer;
      try {
        await Promise.race([Promise.allSettled(pending), new Promise((res) => { timer = setTimeout(res, SCRIPT_CIRCUIT.redisBudgetMs); })]);
      } finally { clearTimeout(timer); pending.length = 0; }
    },
  };
}

/** Test helper: forget all per-instance state. */
export function _resetScriptCircuitForTests() { memory.clear(); }
