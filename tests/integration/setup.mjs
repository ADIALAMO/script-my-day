/**
 * Test harness for the LOCAL integration suite (tests/integration/*.test.js).
 *
 * `boot()` must run before any application module is imported. It:
 *   1. purges process.env and loads ONLY tests/integration/test.env (fake values) + the overrides given
 *   2. starts the in-process fake Upstash REST server and points UPSTASH_REDIS_REST_URL at it
 *   3. installs a network guard: any connection to a host other than localhost throws AND is recorded;
 *      afterAll() fails the run if even one was attempted
 *   4. replaces globalThis.fetch with a router that serves every external provider from local mocks
 *   5. patches the S3 client and nodemailer so R2 uploads and e-mails are recorded, never sent
 *   6. registers module hooks so the app's extensionless imports (and the JSX in pages/api/og.js)
 *      load in plain Node — no production file is modified
 *   7. mocks Date (UTC) so day/month boundaries can be crossed deterministically
 * No production code is changed or monkey-patched except the two third-party senders in (5).
 */
import { registerHooks, createRequire } from 'node:module';
import net from 'node:net';
import dns from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mock, test } from 'node:test';
import { Readable } from 'node:stream';
import assert from 'node:assert/strict';
import { createFakeUpstash } from './lib/fake-upstash.mjs';
import { createProviders } from './lib/providers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const KEEP_ENV = new Set(['PATH', 'HOME', 'TMPDIR', 'TERM', 'LANG', 'LC_ALL', 'USER', 'SHELL', 'TZ']);
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const isLocal = (h) => LOCAL.has(String(h || '').toLowerCase());

export async function boot({ env = {}, nodeEnv = 'test', startAt = '2026-10-15T12:00:00.000Z', file = 'unknown' } = {}) {
  // 1. hermetic env -----------------------------------------------------------------------------
  for (const k of Object.keys(process.env)) if (!KEEP_ENV.has(k) && !k.startsWith('NODE_TEST')) delete process.env[k];
  process.loadEnvFile(path.join(HERE, 'test.env'));
  process.env.TZ = 'UTC';
  process.env.NODE_ENV = nodeEnv;
  Object.assign(process.env, env);

  // 2. fake Upstash -----------------------------------------------------------------------------
  const fake = await createFakeUpstash();
  process.env.UPSTASH_REDIS_REST_URL = fake.url;

  // 3. network guard ----------------------------------------------------------------------------
  const violations = [];
  const violate = (what) => { violations.push(what); throw new Error(`NETWORK GUARD: blocked outbound connection to ${what}`); };
  const origConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    let host; let a0 = args[0];
    if (Array.isArray(a0)) a0 = a0[0];            // net.connect() hands over the normalised [options, cb] tuple
    if (a0 && typeof a0 === 'object' && !Array.isArray(a0)) host = a0.path ? 'unix-socket' : (a0.host ?? 'localhost');
    else if (typeof a0 === 'string' && Number.isNaN(Number(a0))) host = 'unix-socket';
    else host = typeof args[1] === 'string' ? args[1] : 'localhost';
    if (host !== 'unix-socket' && !isLocal(host)) violate(`${host} (net.Socket.connect)`);
    return origConnect.apply(this, args);
  };
  for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6']) {
    const orig = dns[fn];
    dns[fn] = function guardedDns(hostname, ...rest) { if (!isLocal(hostname)) { try { violate(`${hostname} (dns.${fn})`); } catch (e) { const cb = rest.find((x) => typeof x === 'function'); if (cb) return cb(e); throw e; } } return orig.call(this, hostname, ...rest); };
  }

  // 4. providers + fetch router -----------------------------------------------------------------
  const providers = createProviders();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async function routedFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith('data:')) return realFetch(input, init);
    let u; try { u = new URL(url); } catch { violate(`${url} (unparseable fetch URL)`); }
    if (isLocal(u.hostname)) return realFetch(input, init);
    const handled = await providers.handle(url, init ?? (typeof input === 'object' ? { body: undefined } : {}));
    if (handled) return handled;
    providers.unexpected.push(url);
    violate(`${u.hostname} (fetch ${u.pathname})`);
  };

  // 5. senders ----------------------------------------------------------------------------------
  const require = createRequire(import.meta.url);
  const { S3Client } = await import('@aws-sdk/client-s3');
  S3Client.prototype.send = async function recordedSend(cmd) { providers.s3puts.push({ key: cmd?.input?.Key, bytes: cmd?.input?.Body?.length ?? 0 }); return {}; };
  const mails = [];
  const nodemailerPaths = new Set();
  for (const from of [ROOT, path.dirname(require.resolve('next-auth'))]) {
    const p = createRequire(path.join(from, 'x.js')).resolve('nodemailer'); nodemailerPaths.add(p);
  }
  for (const p of nodemailerPaths) {
    const nm = createRequire(import.meta.url)(p);
    nm.createTransport = () => ({ sendMail: async (msg) => { mails.push(msg); return { accepted: [msg.to], rejected: [], pending: [], response: 'mock' }; } });
  }

  // 6. module hooks -----------------------------------------------------------------------------
  const sucraseDir = fs.readdirSync(path.join(ROOT, 'node_modules/.pnpm')).find((d) => d.startsWith('sucrase@'));
  const sucrase = sucraseDir ? require(path.join(ROOT, 'node_modules/.pnpm', sucraseDir, 'node_modules/sucrase')) : null;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try { return nextResolve(specifier, context); } catch (e) {
        const rel = specifier.startsWith('.') || specifier.startsWith('/');
        if (rel && context.parentURL?.startsWith('file://') && !context.parentURL.includes('/node_modules/')) {
          for (const suffix of ['.js', '.jsx', '/index.js']) { try { return nextResolve(specifier + suffix, context); } catch { /* next */ } }
        }
        if (specifier.startsWith('next/') && !specifier.endsWith('.js')) { try { return nextResolve(specifier + '.js', context); } catch { /* fall through */ } }   // next/og has no exports map
        throw e;
      }
    },
    load(url, context, nextLoad) {
      if (sucrase && url.startsWith('file://') && /\/pages\/api\/og\.js$/.test(url)) {
        const src = fs.readFileSync(fileURLToPath(url), 'utf8');
        const out = sucrase.transform(src, { transforms: ['jsx'], jsxRuntime: 'automatic', production: true }).code;
        return { format: 'module', source: out, shortCircuit: true };
      }
      return nextLoad(url, context);
    },
  });

  // 7. clock ------------------------------------------------------------------------------------
  mock.timers.enable({ apis: ['Date'], now: new Date(startAt) });
  const setNow = (iso) => mock.timers.setTime(new Date(iso).getTime());
  const advance = (ms) => mock.timers.tick(ms);

  // ---- HTTP fakes -----------------------------------------------------------------------------
  function makeReq({ method = 'POST', url = '/', headers = {}, body, query = {}, cookies = {}, ip = '198.51.100.10' } = {}) {
    const h = { 'x-real-ip': ip, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])) };
    if (Object.keys(cookies).length) h.cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ');
    return { method, url, headers: h, body, query, cookies, socket: { remoteAddress: ip }, connection: { remoteAddress: ip } };
  }
  function makeRes() {
    const res = {
      statusCode: 200, headers: {}, body: undefined, sent: false, headersSent: false,
      status(c) { this.statusCode = c; return this; },
      setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; },
      getHeader(k) { return this.headers[String(k).toLowerCase()]; },
      getHeaders() { return this.headers; },
      removeHeader(k) { delete this.headers[String(k).toLowerCase()]; },
      writeHead(c, h = {}) { this.statusCode = c; for (const [k, v] of Object.entries(h)) this.setHeader(k, v); return this; },
      json(b) { this.body = b; this.sent = true; this.headersSent = true; return this; },
      send(b) { this.body = b; this.sent = true; this.headersSent = true; return this; },
      end(b) { if (b !== undefined && this.body === undefined) this.body = b; this.sent = true; this.headersSent = true; return this; },
      redirect(a, b) { this.statusCode = typeof a === 'number' ? a : 302; this.setHeader('location', typeof a === 'number' ? b : a); this.sent = true; return this; },
      on() { return this; }, once() { return this; }, emit() { return true; }, write() { return true; },
    };
    return res;
  }
  /** Runs a real Next API route handler and returns what it would have sent. */
  async function invoke(handler, opts = {}) {
    const req = opts.stream ? Object.assign(Readable.from([Buffer.from(opts.stream)]), makeReq(opts)) : makeReq(opts);
    const res = makeRes();
    await handler(req, res);
    return { status: res.statusCode, body: res.body, headers: res.headers, res };
  }

  // ---- sessions & users -----------------------------------------------------------------------
  await import('next-auth');                       // initialise next-auth's CJS graph first (Node-ESM interop order quirk; webpack does not care)
  const { encode } = await import('next-auth/jwt');
  async function sessionFor({ id, email, name }) {
    const token = await encode({ token: { name, email, sub: id, uid: id }, secret: process.env.NEXTAUTH_SECRET, maxAge: 90 * 24 * 3600 });   // long-lived: tests jump the fake clock by days/months
    return { cookies: { 'next-auth.session-token': token } };
  }
  const plan = await import('../../lib/plan.js');
  /**
   * kind: 'free' | 'paid' | 'adminGranted' | 'admin' | 'vip'
   *  paid          → Pro via the payment path (plan.grantPaidPro)
   *  adminGranted  → Pro granted from the admin dashboard (plan.setTierByAdmin)
   *  admin         → tier admin (stored)
   *  vip           → free in Redis, Pro through PRO_ALLOWLIST (email)
   */
  async function makeUser(label, kind = 'free') {
    const id = `${label}-${kind}`;
    const email = kind === 'vip' ? 'vip@test.example' : `${label}@test.example`;
    if (kind === 'paid') await plan.grantPaidPro(id, `cus_${id}`);
    if (kind === 'adminGranted') await plan.setTierByAdmin(id, 'pro', 'boss@test.example');
    if (kind === 'admin') await plan.setTierByAdmin(id, 'admin', 'boss@test.example');
    const s = await sessionFor({ id, email, name: label });
    return { id, identifier: `u:${id}`, email, kind, ...s };
  }
  const anonymous = (ip = '198.51.100.99') => ({ id: null, identifier: ip, kind: 'anonymous', cookies: {}, ip });
  const adminKeyHeader = { 'x-admin-key': process.env.ADMIN_SECRET };

  // ---- app routes -----------------------------------------------------------------------------
  const route = async (name) => (await import(`../../pages/api/${name}.js`)).default;

  // ---- scenario recorder ----------------------------------------------------------------------
  const rows = [];
  /** clean slate between scenarios: empty Redis, zero provider counters, no mails, clock back to start */
  function fresh() { fake.flush(); fake.control.failCommands.clear(); fake.control.downEverything = false; providers.reset(); providers.unexpected.length = 0; mails.length = 0; setNow(startAt); }
  function scenario(id, title, expected, fn, { keepState = false } = {}) {
    return test(`${id} — ${title}`, async () => {
      if (!keepState) fresh();
      const before = { ...providers.counts };
      try {
        const r = (await fn()) || {};
        const calls = Object.fromEntries(Object.entries(providers.counts).map(([k, v]) => [k, v - (before[k] || 0)]).filter(([, v]) => v));
        rows.push({ id, title, expected, actual: r.actual ?? 'as expected', pass: true, evidence: r.evidence ?? '', calls });
      } catch (e) {
        const calls = Object.fromEntries(Object.entries(providers.counts).map(([k, v]) => [k, v - (before[k] || 0)]).filter(([, v]) => v));
        rows.push({ id, title, expected, actual: String(e.message).split('\n')[0].slice(0, 400), pass: false, evidence: String(e.stack || '').split('\n').slice(1, 3).join(' | ').slice(0, 300), calls });
        throw e;
      }
    });
  }
  async function afterAll() {
    const dir = path.join(HERE, '.results'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${file}.json`), JSON.stringify({ file, rows, networkViolations: violations, unexpectedFetches: providers.unexpected, redisCommands: fake.stats.total }, null, 1));
    await fake.close();
    assert.deepEqual(violations, [], `network guard triggered: ${violations.join(', ')}`);
  }

  return { fake, providers, mails, fresh, startAt, setNow, advance, invoke, makeReq, makeRes, makeUser, anonymous, adminKeyHeader, route, scenario, afterAll, plan, violations, env: process.env, ROOT };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
