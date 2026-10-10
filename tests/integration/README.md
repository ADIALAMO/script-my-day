# Local integration suite (real route handlers, zero real services)

> הרצה מקומית של ה-handlers האמיתיים של ה-API מול Redis מדומה וספקים מדומים. אין שום קריאה לשירות חיצוני.

```bash
npm run test:integration            # all scenarios (≈20 s)
node --test tests/integration/05-identity.test.js     # one file
npm test                            # the fast unit tests (tests/*.test.js) — unchanged
```
Requires Node ≥ 22.15 (uses `module.registerHooks` and `node:test` mock timers). Each `*.test.js` runs in its own
process. Per-run artefacts (scenario rows, call counts, the cost table) go to `tests/integration/.results/` (git-ignored).

## What is real and what is fake

| Layer | In this suite |
|---|---|
| API route handlers (`pages/api/*.js`) | **the real files, unmodified**, called with fake `req`/`res` |
| NextAuth, JWT sessions, `@upstash/redis`, `@upstash/ratelimit` | **real libraries** |
| Redis | in-process **fake Upstash REST server** on 127.0.0.1 (`lib/fake-upstash.mjs`): the real clients talk to it over HTTP, so no production code is swapped. Single-threaded command execution = atomic; TTLs follow the mocked clock; the sliding-window Lua script of `@upstash/ratelimit` is emulated (`00-infra` proves it) |
| Paid providers (Gemini, OpenRouter text/Klein/Grok/Gemini-image/moderation, Cohere, Cloudflare Workers AI, Pollinations, HuggingFace) | local mocks in `lib/providers.mjs` that **count every call per provider** (`providers.counts`) |
| Telegram, SMTP (nodemailer), R2/S3 | recorders (`providers.telegram`, `mails`, `providers.s3puts`) — the SDK senders are patched, nothing is sent |
| Time | `node:test` mock `Date` (UTC): `ctx.setNow()` / `ctx.advance()` cross day and month boundaries |
| Environment | `process.env` is **purged** and only `tests/integration/test.env` (fake values) is loaded. Your real env / `.env.local` / Vercel values are never read |

## Safety guard
`setup.mjs → boot()` patches `net.Socket.connect` and `dns.*` and replaces `globalThis.fetch`. Any connection to a host
other than localhost throws `NETWORK GUARD` **and is recorded**; every file's `afterAll()` fails the run if the record is
not empty. Providers are served by the fetch router; an unknown host is a violation.

## Writing a scenario
```js
const ctx = await boot({ file: 'my-file', env: { DAILY_IMAGE_BUDGET: '0.028' }, nodeEnv: 'production' });
after(() => ctx.afterAll());
const handler = await ctx.route('generate-script');           // import the real pages/api route AFTER boot()
ctx.scenario('X1', 'title', 'expected result', async () => {   // state is reset before every scenario
  const u = await ctx.makeUser('x1', 'paid');                  // free | paid | adminGranted | admin | vip
  const r = await ctx.invoke(handler, { body, cookies: u.cookies, ip: '198.51.100.7' });
  assert.equal(r.status, 200);
  return { actual: '…', evidence: '…' };                       // provider-call diff is recorded automatically
});
```
Use a **unique user label per scenario** (the rate limiter keeps a per-process in-memory block cache keyed by identifier).
To switch the per-minute limiter off (to test pure quota atomicity) make the fake refuse EVAL: `fake.control.failCommands.add('EVAL')` —
the app treats that as an Upstash outage and fails open, exactly as in production.

## Known harness quirks (not app bugs)
* `next-auth` is imported once in `boot()` before any route: plain Node resolves its CJS default export differently depending on import order; webpack does not care.
* `pages/api/og.js` contains JSX in a `.js` file → a load hook compiles it with `sucrase` (already in `node_modules`).
* `@vercel/og` tries to fetch Google Fonts for glyphs the loaded font lacks (e.g. Hebrew); the guard blocks it, so og rendering is only asserted for Latin text. Hebrew rendering is in the manual checklist.
* The Google OAuth round-trip (openid-client → accounts.google.com) cannot run offline; only its non-network surface is covered.

## Scenario map
`00` harness self-test · `01` A auth · `02` B scripts · `03` C poster · `04` D/E comics · `05` F identity · `06` G atomicity ·
`07` H budgets · `08` I magic link · `09` J proxy-image/og · `10` K billing · `11` L plan · `12` M cost.
A failing scenario means the code no longer matches the documented behaviour; read its title and the assertion message to see which limit or budget changed.
