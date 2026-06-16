import { Redis } from '@upstash/redis';

// Lightweight stub returned when Upstash credentials are absent.
// Its methods throw a catchable error so the quota try/catch in each
// API route logs a warning and fails open — no broken 500s.
function createOfflineStub(reason) {
  const fail = () => { throw new Error(`Redis unavailable: ${reason}`); };
  const stubPipeline = { incr() { return this; }, expireat() { return this; }, exec: fail };
  return { get: fail, set: fail, incr: fail, del: fail, getdel: fail, mget: fail, srem: fail, sadd: fail, scard: fail, pipeline: () => stubPipeline };
}

const g = /** @type {any} */ (global);

if (!g._redisClient) {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    console.warn('⚠️  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set — quota tracking disabled');
    g._redisClient = createOfflineStub('Upstash credentials not configured');
  } else {
    g._redisClient = new Redis({ url, token });
  }
}

export default g._redisClient;
