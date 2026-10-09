/**
 * In-memory fake of the Upstash Redis REST API (the real @upstash/redis and @upstash/ratelimit
 * clients talk to it over HTTP on 127.0.0.1, so NO production code is swapped or patched).
 *
 * Atomicity: every command (and every pipeline) is executed synchronously inside ONE event-loop
 * turn of the HTTP handler, so commands from concurrent clients can never interleave — exactly the
 * guarantee Redis gives. tests/integration/00-infra.test.js proves it with a concurrent INCR storm.
 *
 * Time comes from Date.now() (which the tests mock), so TTLs follow the fake clock.
 * Supports what the app + libraries use: strings, counters, TTLs, sets, sorted sets, GETDEL, MGET,
 * EVAL/EVALSHA for @upstash/ratelimit's sliding-window script (emulated, see evalSlidingWindow).
 */
import http from 'node:http';

export async function createFakeUpstash() {
  const strings = new Map();   // key -> string
  const sets = new Map();      // key -> Set
  const zsets = new Map();     // key -> Map(member -> score)
  const expiry = new Map();    // key -> epoch ms
  const stats = { commands: {}, total: 0 };
  const control = { failCommands: new Set(), downEverything: false };

  const now = () => Date.now();
  const alive = (k) => {
    const e = expiry.get(k);
    if (e !== undefined && now() >= e) { strings.delete(k); sets.delete(k); zsets.delete(k); expiry.delete(k); return false; }
    return strings.has(k) || sets.has(k) || zsets.has(k);
  };
  const del = (k) => { const had = alive(k); strings.delete(k); sets.delete(k); zsets.delete(k); expiry.delete(k); return had; };
  const num = (v) => { const n = parseInt(v, 10); if (!Number.isFinite(n) || String(n) !== String(v).trim()) throw new Error('ERR value is not an integer or out of range'); return n; };

  function evalSlidingWindow(keys, args) {
    // Emulates @upstash/ratelimit v2 slidingWindowLimitScript (read from node_modules; see README).
    const [currentKey, previousKey, dynamicLimitKey] = keys;
    const tokens = Number(args[0]); const nowMs = Number(args[1]); const windowMs = Number(args[2]); const incrementBy = Number(args[3]);
    let effectiveLimit = tokens;
    if (dynamicLimitKey) { if (alive(dynamicLimitKey)) effectiveLimit = Number(strings.get(dynamicLimitKey)); }
    let cur = alive(currentKey) ? Number(strings.get(currentKey)) : 0;
    let prev = alive(previousKey) ? Number(strings.get(previousKey)) : 0;
    const pct = (nowMs % windowMs) / windowMs;
    prev = Math.floor((1 - pct) * prev);
    if (incrementBy > 0 && prev + cur >= effectiveLimit) return [-1, effectiveLimit];
    const nv = (alive(currentKey) ? Number(strings.get(currentKey)) : 0) + incrementBy;
    strings.set(currentKey, String(nv));
    if (nv === incrementBy) expiry.set(currentKey, now() + windowMs * 2 + 1000);
    return [effectiveLimit - (nv + prev), effectiveLimit];
  }

  function exec(cmdArr) {
    const [cmdRaw, ...a] = cmdArr.map((x) => (typeof x === 'number' ? String(x) : x));
    const cmd = String(cmdRaw).toUpperCase();
    stats.commands[cmd] = (stats.commands[cmd] || 0) + 1; stats.total++;
    if (control.failCommands.has(cmd)) throw new Error(`ERR simulated failure of ${cmd}`);
    switch (cmd) {
      case 'PING': return 'PONG';
      case 'GET': return alive(a[0]) && strings.has(a[0]) ? strings.get(a[0]) : null;
      case 'SET': {
        const [k, v, ...opt] = a; let ex = null, nx = false, xx = false, keepttl = false, get = false;
        for (let i = 0; i < opt.length; i++) {
          const o = String(opt[i]).toUpperCase();
          if (o === 'EX') ex = now() + Number(opt[++i]) * 1000;
          else if (o === 'PX') ex = now() + Number(opt[++i]);
          else if (o === 'EXAT') ex = Number(opt[++i]) * 1000;
          else if (o === 'PXAT') ex = Number(opt[++i]);
          else if (o === 'NX') nx = true; else if (o === 'XX') xx = true; else if (o === 'KEEPTTL') keepttl = true; else if (o === 'GET') get = true;
        }
        const exists = alive(k);
        const old = exists && strings.has(k) ? strings.get(k) : null;
        if ((nx && exists) || (xx && !exists)) return get ? old : null;
        strings.set(k, v); sets.delete(k); zsets.delete(k);
        if (ex !== null) expiry.set(k, ex); else if (!keepttl) expiry.delete(k);
        return get ? old : 'OK';
      }
      case 'SETNX': { if (alive(a[0])) return 0; strings.set(a[0], a[1]); return 1; }
      case 'MGET': return a.map((k) => (alive(k) && strings.has(k) ? strings.get(k) : null));
      case 'GETDEL': { const v = alive(a[0]) && strings.has(a[0]) ? strings.get(a[0]) : null; del(a[0]); return v; }
      case 'DEL': return a.reduce((n, k) => n + (del(k) ? 1 : 0), 0);
      case 'EXISTS': return a.reduce((n, k) => n + (alive(k) ? 1 : 0), 0);
      case 'INCR': case 'INCRBY': case 'DECR': case 'DECRBY': {
        const by = cmd === 'INCR' ? 1 : cmd === 'DECR' ? -1 : cmd === 'INCRBY' ? num(a[1]) : -num(a[1]);
        const cur = alive(a[0]) && strings.has(a[0]) ? num(strings.get(a[0])) : 0;
        strings.set(a[0], String(cur + by)); return cur + by;
      }
      case 'EXPIRE': case 'PEXPIRE': case 'EXPIREAT': case 'PEXPIREAT': {
        if (!alive(a[0])) return 0; const n = Number(a[1]);
        expiry.set(a[0], cmd === 'EXPIRE' ? now() + n * 1000 : cmd === 'PEXPIRE' ? now() + n : cmd === 'EXPIREAT' ? n * 1000 : n); return 1;
      }
      case 'TTL': { if (!alive(a[0])) return -2; const e = expiry.get(a[0]); return e === undefined ? -1 : Math.ceil((e - now()) / 1000); }
      case 'PTTL': { if (!alive(a[0])) return -2; const e = expiry.get(a[0]); return e === undefined ? -1 : e - now(); }
      case 'SADD': { alive(a[0]); const s = sets.get(a[0]) || new Set(); let n = 0; for (const m of a.slice(1)) if (!s.has(m)) { s.add(m); n++; } sets.set(a[0], s); return n; }
      case 'SREM': { alive(a[0]); const s = sets.get(a[0]); if (!s) return 0; let n = 0; for (const m of a.slice(1)) if (s.delete(m)) n++; return n; }
      case 'SCARD': { alive(a[0]); return sets.get(a[0])?.size ?? 0; }
      case 'SMEMBERS': { alive(a[0]); return [...(sets.get(a[0]) || [])]; }
      case 'SISMEMBER': { alive(a[0]); return sets.get(a[0])?.has(a[1]) ? 1 : 0; }
      case 'ZADD': { alive(a[0]); const z = zsets.get(a[0]) || new Map(); let i = 1, nx = false; while (['NX', 'XX', 'GT', 'LT', 'CH'].includes(String(a[i]).toUpperCase())) { if (String(a[i]).toUpperCase() === 'NX') nx = true; i++; } let n = 0; for (; i < a.length; i += 2) { if (nx && z.has(a[i + 1])) continue; if (!z.has(a[i + 1])) n++; z.set(a[i + 1], Number(a[i])); } zsets.set(a[0], z); return n; }
      case 'ZCARD': { alive(a[0]); return zsets.get(a[0])?.size ?? 0; }
      case 'ZSCORE': { alive(a[0]); const v = zsets.get(a[0])?.get(a[1]); return v === undefined ? null : String(v); }
      case 'ZREM': { alive(a[0]); const z = zsets.get(a[0]); if (!z) return 0; let n = 0; for (const m of a.slice(1)) if (z.delete(m)) n++; return n; }
      case 'ZRANGE': { alive(a[0]); const z = [...(zsets.get(a[0]) || [])].sort((x, y) => x[1] - y[1]); const rev = a.some((x) => String(x).toUpperCase() === 'REV'); if (rev) z.reverse(); const s = Number(a[1]); let e = Number(a[2]); if (e < 0) e = z.length + e; return z.slice(s < 0 ? z.length + s : s, e + 1).map((x) => x[0]); }
      case 'EVALSHA': throw new Error('NOSCRIPT No matching script. Please use EVAL.');
      case 'EVAL': {
        const [script, nk, ...rest] = a; const n = Number(nk); const keys = rest.slice(0, n); const args = rest.slice(n);
        if (script.includes('requestsInPreviousWindow') && script.includes('dynamicLimitKey')) return evalSlidingWindow(keys, args);
        throw new Error('ERR the fake Redis only emulates the sliding-window script; add support before using another one');
      }
      default: throw new Error(`ERR unknown command '${cmdRaw}' (fake Redis)`);
    }
  }

  const b64 = (v) => (typeof v === 'string' ? (v === 'OK' ? v : Buffer.from(v, 'utf8').toString('base64')) : Array.isArray(v) ? v.map(b64) : v);

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (control.downEverything) { res.writeHead(503, { 'content-type': 'application/json' }); return res.end('{"error":"simulated outage"}'); }
      const enc = (req.headers['upstash-encoding'] || '') === 'base64';
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null');
      const one = (cmd) => { try { const r = exec(cmd); return { result: enc ? b64(r) : r }; } catch (e) { return { error: e.message }; } };
      let out;
      if (req.url.startsWith('/pipeline')) out = body.map(one);
      else if (req.url.startsWith('/multi-exec')) out = body.map(one);
      else out = one(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(out));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    stats,
    control,
    /** direct inspection helpers for assertions (bypass the HTTP layer) */
    get: (k) => (alive(k) && strings.has(k) ? strings.get(k) : null),
    num: (k) => (alive(k) && strings.has(k) ? Number(strings.get(k)) : 0),
    ttl: (k) => exec(['TTL', k]),
    keys: (prefix = '') => [...strings.keys(), ...sets.keys(), ...zsets.keys()].filter((k) => k.startsWith(prefix) && alive(k)),
    set: (k, v, exSeconds) => exec(exSeconds ? ['SET', k, String(v), 'EX', exSeconds] : ['SET', k, String(v)]),
    del: (k) => del(k),
    exec,
    flush() { strings.clear(); sets.clear(); zsets.clear(); expiry.clear(); stats.commands = {}; stats.total = 0; },
    close: () => new Promise((r) => server.close(r)),
  };
}
