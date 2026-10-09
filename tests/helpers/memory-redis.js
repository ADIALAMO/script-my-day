/**
 * Tiny in-memory stand-in for the Upstash client — just the commands the app uses.
 * Install BEFORE importing any lib module:   global._redisClient = createMemoryRedis();
 * (lib/redis.js reuses an existing global client). No network, no real data.
 */
export function createMemoryRedis() {
  const store = new Map();
  const expiries = new Map(); // key -> unix seconds (recorded, not enforced)
  const num = (v) => (v === undefined ? 0 : parseInt(v, 10) || 0);

  const api = {
    _store: store,
    _expiries: expiries,
    async get(k) { return store.has(k) ? store.get(k) : null; },
    async set(k, v, opts = {}) {
      if (opts.nx && store.has(k)) return null;
      store.set(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
      if (opts.ex) expiries.set(k, Math.floor(Date.now() / 1000) + opts.ex);
      return 'OK';
    },
    async incr(k) { const n = num(store.get(k)) + 1; store.set(k, String(n)); return n; },
    async decr(k) { const n = num(store.get(k)) - 1; store.set(k, String(n)); return n; },
    async del(...ks) { let c = 0; for (const k of ks) { if (store.delete(k)) c++; expiries.delete(k); } return c; },
    async expire(k, s) { expiries.set(k, Math.floor(Date.now() / 1000) + s); return 1; },
    async expireat(k, ts) { expiries.set(k, ts); return 1; },
    async mget(...ks) { return ks.map((k) => (store.has(k) ? store.get(k) : null)); },
    async getdel(k) { const v = store.has(k) ? store.get(k) : null; store.delete(k); return v; },
    pipeline() {
      const ops = [];
      const p = {
        incr: (k) => { ops.push(() => api.incr(k)); return p; },
        decr: (k) => { ops.push(() => api.decr(k)); return p; },
        expireat: (k, t) => { ops.push(() => api.expireat(k, t)); return p; },
        expire: (k, s) => { ops.push(() => api.expire(k, s)); return p; },
        set: (k, v, o) => { ops.push(() => api.set(k, v, o)); return p; },
        del: (k) => { ops.push(() => api.del(k)); return p; },
        async exec() { const out = []; for (const op of ops) out.push(await op()); return out; },
      };
      return p;
    },
  };
  return api;
}
