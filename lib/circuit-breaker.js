import { nextMidnightUTC } from './api-utils.js';

// All circuit state is stored under this Redis key prefix to avoid
// colliding with the 'usage:' quota namespace.
const KEY_PREFIX = 'circuit:img:';

// Canonical names must match the PROVIDER_KEY map below.
const PROVIDERS = ['gemini', 'huggingface', 'cloudflare', 'openrouter', 'pollinations'];

// Maps provider runner function.name → circuit key segment.
// Keeping this in the module ensures generate-poster.js never has to
// hard-code provider name strings — it just passes provider.name.
export const PROVIDER_KEY = {
  runGemini:          'gemini',
  runHuggingFace:     'huggingface',
  runCloudflareAI:    'cloudflare',
  runOpenRouterKlein: 'openrouter',
  runPollinationsFlux:'pollinations',
};

// Status-aware open durations in milliseconds.
// null means "open until next UTC midnight" (daily-credit exhaustion).
const OPEN_DURATION_MS = {
  429: 45_000,   // rate-limit burst window
  402: null,     // credits exhausted — reset at midnight
  403: null,     // same pattern as 402
  503: 20_000,   // upstream overload / cold-start
};
const DEFAULT_OPEN_MS = 15_000;

function circuitKey(name) {
  return `${KEY_PREFIX}${name}`;
}

// Parses the first 4xx/5xx HTTP status code out of an error message string.
// Provider functions throw errors like "Gemini 429: ..." or "HF 503: ...".
// Returns the code as a number, or null when no HTTP code is present
// (e.g. "GEMINI_API_KEY not configured" — config errors must not trip the circuit).
export function extractStatusCode(message) {
  const m = message && message.match(/\b([45]\d{2})\b/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Returns a Set of provider names currently in OPEN state.
 *
 * Single MGET across all five providers — one Redis round-trip (~5ms).
 * On any Redis failure the function returns an empty Set so the caller
 * proceeds with the full cascade (fail-open, not fail-closed).
 */
export async function getOpenProviders(redis) {
  try {
    const keys   = PROVIDERS.map(circuitKey);
    const values = await redis.mget(...keys);
    const now    = Date.now();
    const open   = new Set();

    values.forEach((v, i) => {
      if (!v) return;
      // Upstash auto-deserializes JSON; guard against raw-string fallback.
      const state = typeof v === 'object' ? v : JSON.parse(v);
      if (state.openUntil && now < state.openUntil) open.add(PROVIDERS[i]);
    });

    return open;
  } catch (e) {
    console.warn(`⚠️ Circuit breaker read failed — using full cascade: ${e.message}`);
    return new Set();
  }
}

/**
 * Marks a provider OPEN in Redis with a status-aware TTL.
 *
 * No-op when statusCode is null: config errors (missing env vars, bad model IDs)
 * should not trip the circuit because they are not transient provider failures.
 */
export async function recordFailure(redis, name, statusCode) {
  if (!statusCode) return;
  try {
    const hasDuration  = Object.prototype.hasOwnProperty.call(OPEN_DURATION_MS, statusCode);
    const durationMs   = hasDuration ? OPEN_DURATION_MS[statusCode] : DEFAULT_OPEN_MS;
    const openUntilMs  = durationMs === null
      ? nextMidnightUTC() * 1000
      : Date.now() + durationMs;
    const ttlSeconds   = Math.max(1, Math.ceil((openUntilMs - Date.now()) / 1000));

    await redis.set(
      circuitKey(name),
      { openUntil: openUntilMs, lastError: statusCode },
      { ex: ttlSeconds }
    );
    console.log(`🔴 Circuit OPEN: ${name} (HTTP ${statusCode}) → ${ttlSeconds}s`);
  } catch (e) {
    console.warn(`⚠️ Circuit breaker write failed for ${name}: ${e.message}`);
  }
}

/**
 * Clears the circuit state for a provider, marking it CLOSED.
 * Called immediately after a successful provider response.
 */
export async function recordSuccess(redis, name) {
  try {
    await redis.del(circuitKey(name));
  } catch (e) {
    console.warn(`⚠️ Circuit breaker clear failed for ${name}: ${e.message}`);
  }
}

/**
 * Returns a full status snapshot of all five providers.
 * Used exclusively by /api/provider-health.
 */
export async function getAllCircuitStates(redis) {
  try {
    const keys   = PROVIDERS.map(circuitKey);
    const values = await redis.mget(...keys);
    const now    = Date.now();

    return PROVIDERS.reduce((acc, name, i) => {
      const raw = values[i];
      if (!raw) {
        acc[name] = { status: 'CLOSED' };
        return acc;
      }
      const state  = typeof raw === 'object' ? raw : JSON.parse(raw);
      const isOpen = Boolean(state.openUntil && now < state.openUntil);

      acc[name] = {
        status: isOpen ? 'OPEN' : 'CLOSED',
        ...(isOpen && {
          openUntil:   new Date(state.openUntil).toISOString(),
          remainingMs: state.openUntil - now,
          lastError:   state.lastError,
        }),
      };
      return acc;
    }, {});
  } catch (e) {
    return PROVIDERS.reduce((acc, name) => {
      acc[name] = { status: 'UNKNOWN', error: e.message };
      return acc;
    }, {});
  }
}
