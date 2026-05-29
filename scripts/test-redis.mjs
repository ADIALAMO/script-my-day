/**
 * Standalone Redis connectivity diagnostic.
 * Run from the project root:
 *
 *   node scripts/test-redis.mjs
 *
 * It performs four independent checks so you can see exactly where the
 * failure occurs — DNS, TCP, Auth, or Redis command level — without any
 * Next.js / API-route context in the way.
 */

import dns     from 'dns/promises';
import net     from 'net';
import { createRequire } from 'module';
import { readFileSync }  from 'fs';
import { resolve }       from 'path';

const require = createRequire(import.meta.url);
const Redis   = require('ioredis');

// ─── 1. Resolve REDIS_URL ────────────────────────────────────────────────────
// Priority: env var already in process.env (set by Next.js / your shell)
// Fallback:  read .env.local directly so the script works standalone too.

function readEnvFile(filePath) {
  try {
    const lines = readFileSync(filePath, 'utf8').split('\n');
    for (const line of lines) {
      const m = line.match(/^REDIS_URL\s*=\s*["']?(.+?)["']?\s*$/);
      if (m) return m[1].trim();
    }
  } catch {}
  return null;
}

const RAW_URL =
  process.env.REDIS_URL ||
  readEnvFile(resolve(process.cwd(), '.env.local')) ||
  readEnvFile(resolve(process.cwd(), '.env'));

if (!RAW_URL) {
  console.error('\n❌  REDIS_URL not found in environment or .env/.env.local\n');
  process.exit(1);
}

// Strip surrounding quotes that dotenv adds in some editors
const REDIS_URL = RAW_URL.replace(/^["']|["']$/g, '');

let parsedUrl;
try {
  parsedUrl = new URL(REDIS_URL);
} catch (e) {
  console.error(`\n❌  REDIS_URL is malformed: ${e.message}`);
  console.error(`    Raw value: ${REDIS_URL.replace(/:([^@]+)@/, ':[REDACTED]@')}`);
  process.exit(1);
}

const HOST     = parsedUrl.hostname;
const PORT     = parseInt(parsedUrl.port, 10) || 6379;
const PROTOCOL = parsedUrl.protocol; // 'redis:' or 'rediss:'
const USE_TLS  = PROTOCOL === 'rediss:';

const SAFE_URL = REDIS_URL.replace(/:([^@]+)@/, ':[REDACTED]@');

console.log('\n══════════════════════════════════════════════════════════');
console.log('  Redis Connectivity Diagnostic');
console.log('══════════════════════════════════════════════════════════');
console.log(`  URL      : ${SAFE_URL}`);
console.log(`  Host     : ${HOST}`);
console.log(`  Port     : ${PORT}`);
console.log(`  Protocol : ${PROTOCOL}  (TLS: ${USE_TLS})`);
console.log(`  Username : ${parsedUrl.username || '(none)'}`);
console.log(`  Password : ${parsedUrl.password ? '[SET — ' + parsedUrl.password.length + ' chars]' : '[NOT SET]'}`);
console.log('══════════════════════════════════════════════════════════\n');

let overallOk = true;

// ─── Check 1: DNS resolution ─────────────────────────────────────────────────
console.log('Check 1 — DNS Resolution');
let resolvedIp = null;
try {
  // System resolver
  const sysResult = await dns.lookup(HOST).catch(() => null);

  // Public resolver (Google 8.8.8.8) — rules out local DNS cache
  const pubResolver = new dns.Resolver();
  pubResolver.setServers(['8.8.8.8', '1.1.1.1']);
  const pubResult = await new Promise((res) =>
    pubResolver.resolve4(HOST, (err, addrs) => res(err ? null : addrs))
  );

  if (sysResult) {
    resolvedIp = sysResult.address;
    console.log(`  ✅ System DNS  : ${resolvedIp}`);
  } else {
    console.log(`  ❌ System DNS  : ENOTFOUND`);
    overallOk = false;
  }

  if (pubResult) {
    console.log(`  ✅ Google DNS  : ${pubResult[0]}`);
    if (!resolvedIp) resolvedIp = pubResult[0];
  } else {
    console.log(`  ❌ Google DNS  : ENOTFOUND`);
    overallOk = false;
  }

  if (!sysResult && !pubResult) {
    console.log(`
  ⚠️  DIAGNOSIS: The hostname "${HOST}" does not exist in public DNS.
      This means one of the following:
        a) The Redis instance was deleted or its free trial expired.
        b) The instance ID / port number in the URL is wrong.
        c) The instance is on a private network (VPC) not reachable from the internet.

  ➜  ACTION: Log into your Redis provider dashboard and verify the instance
             still exists. Copy the fresh endpoint URL from there.
`);
  }
} catch (e) {
  console.log(`  ❌ DNS error   : ${e.message}`);
  overallOk = false;
}

// ─── Check 2: TCP connectivity ────────────────────────────────────────────────
console.log('\nCheck 2 — TCP Connection');
if (!resolvedIp && !overallOk) {
  console.log(`  ⏭  Skipped (DNS failed — no IP to connect to)\n`);
} else {
  await new Promise((done) => {
    const sock = net.createConnection({ host: HOST, port: PORT, timeout: 6000 });

    sock.on('connect', () => {
      console.log(`  ✅ TCP connected to ${HOST}:${PORT}`);
      sock.destroy();
      done();
    });

    sock.on('timeout', () => {
      console.log(`  ❌ TCP timeout after 6s
  ⚠️  DIAGNOSIS: Port ${PORT} is reachable by DNS but blocked by a firewall
      or the service is not listening.
  ➜  ACTION: Check if your ISP / office network blocks non-standard ports.
             Try a mobile hotspot to rule out local firewall.`);
      overallOk = false;
      sock.destroy();
      done();
    });

    sock.on('error', (e) => {
      const reason =
        e.code === 'ECONNREFUSED' ? `port ${PORT} refused — nothing listening there` :
        e.code === 'ENETUNREACH'  ? 'network unreachable' :
        e.message;
      console.log(`  ❌ TCP error: ${reason}`);
      overallOk = false;
      sock.destroy();
      done();
    });
  });
}

// ─── Check 3: TLS handshake (only for rediss://) ─────────────────────────────
if (USE_TLS) {
  console.log('\nCheck 3 — TLS Handshake');
  const tls = await import('tls');
  await new Promise((done) => {
    const sock = tls.connect(
      { host: HOST, port: PORT, rejectUnauthorized: false, timeout: 6000 },
      () => {
        console.log(`  ✅ TLS connected — cipher: ${sock.getCipher()?.name}`);
        console.log(`  ✅ Cert valid  : ${sock.authorized} (rejectUnauthorized=false so auth errors won't block)`);
        sock.destroy();
        done();
      }
    );
    sock.on('error', (e) => {
      console.log(`  ❌ TLS error: ${e.message}`);
      overallOk = false;
      sock.destroy();
      done();
    });
    sock.on('timeout', () => {
      console.log(`  ❌ TLS timeout`);
      overallOk = false;
      sock.destroy();
      done();
    });
    sock.setTimeout(6000);
  });
} else {
  console.log('\nCheck 3 — TLS Handshake');
  console.log(`  ⏭  Skipped (protocol is redis://, not rediss://)`);
  console.log(`     Note: Redis Cloud and most managed providers also support TLS.`);
  console.log(`     If plain TCP keeps failing, try changing redis:// → rediss://`);
}

// ─── Check 4: Redis PING + AUTH ───────────────────────────────────────────────
console.log('\nCheck 4 — Redis PING');
if (!overallOk) {
  console.log(`  ⏭  Skipped (earlier checks failed — fix those first)\n`);
} else {
  const client = new Redis(REDIS_URL, {
    connectTimeout : 6000,
    lazyConnect    : false,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy  : () => null,
    tls: USE_TLS ? { rejectUnauthorized: false } : undefined,
  });

  client.on('error', () => {}); // suppress duplicate console output

  try {
    const pong = await client.ping();
    console.log(`  ✅ PING → ${pong}`);

    const info    = await client.info('server');
    const version = info.match(/redis_version:(\S+)/)?.[1];
    const mode    = info.match(/redis_mode:(\S+)/)?.[1];
    console.log(`  ✅ Redis version : ${version}`);
    console.log(`  ✅ Mode          : ${mode}`);

    const dbSize = await client.dbsize();
    console.log(`  ✅ DB size       : ${dbSize} keys`);

    // Quick write/read/delete round-trip
    const KEY = `__diag_test_${Date.now()}`;
    await client.set(KEY, '1', 'EX', 10);
    const val = await client.get(KEY);
    await client.del(KEY);
    console.log(`  ✅ Write/read    : ${val === '1' ? 'OK' : 'MISMATCH — got: ' + val}`);

  } catch (e) {
    const reason =
      e.message.includes('WRONGPASS') || e.message.includes('NOAUTH') ?
        `Authentication failed — check username/password in REDIS_URL` :
      e.message.includes('LOADING') ?
        `Redis is loading dataset — wait a moment and retry` :
      e.message;
    console.log(`  ❌ ${reason}`);
    overallOk = false;
  } finally {
    client.disconnect();
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════');
if (overallOk) {
  console.log('  ✅  All checks passed — Redis is reachable and healthy');
} else {
  console.log('  ❌  One or more checks failed — see ⚠️  DIAGNOSIS notes above');
  console.log('\n  Quick fixes to try:');
  console.log('  1. Log into your Redis provider and confirm the instance exists');
  console.log('  2. Copy the fresh endpoint URL from the dashboard');
  console.log('  3. Update REDIS_URL in .env.local (not .env)');
  console.log('  4. Try changing redis:// → rediss:// if using a managed provider');
  console.log('  5. If on a restricted network, test from a mobile hotspot\n');
}
console.log('══════════════════════════════════════════════════════════\n');
