import { getServerSession } from 'next-auth/next';
import { Redis } from '@upstash/redis';
import { UpstashRedisAdapter } from '@next-auth/upstash-redis-adapter';
import { extractIdentifier } from './api-utils.js';

// ── Webpack interop fix ────────────────────────────────────────────────────────
// Both providers export `{ default: fn }`. Under Next.js 15 / Webpack 5 the
// namespace import itself is handed to the call site instead of the inner fn.
// The `.default ?? module` pattern works in both bundled and CJS environments.
import _Google      from 'next-auth/providers/google';
import _Email       from 'next-auth/providers/email';
import _Credentials from 'next-auth/providers/credentials';
const GoogleProvider      = _Google.default      ?? _Google;
const EmailProvider       = _Email.default       ?? _Email;
const CredentialsProvider = _Credentials.default ?? _Credentials;

// ── Upstash adapter ───────────────────────────────────────────────────────────
// EmailProvider requires a token store to persist the magic link secret between
// the "send" request and the callback click. We reuse the existing Upstash
// instance for this — no extra infrastructure needed.
//
// Behaviour when Upstash credentials are absent (e.g. local dev without .env):
//   Google OAuth  → works (no adapter needed for OAuth)
//   Email magic link → fails at send time with a clear server-side warning
function buildAdapter() {
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    console.warn('⚠️  UpstashRedisAdapter disabled — UPSTASH credentials not set. Email magic links will not work.');
    return undefined;
  }
  // Separate instance from lib/redis.js to avoid the offline stub interfering
  // with the adapter's writes. Both share the same Upstash project.
  return UpstashRedisAdapter(new Redis({ url, token }));
}

// ── NextAuth configuration ─────────────────────────────────────────────────────
// Imported by both pages/api/auth/[...nextauth].js and getSessionAndTier() so
// authOptions stays in a single place.
//
// Session strategy: JWT — tier is NOT encoded in the token because it becomes
// stale after a Stripe payment. Each API call does one Redis GET to resolve
// the live tier. The adapter is present only for verification token storage.
//
// Required environment variables:
//
//   Google OAuth:
//     GOOGLE_CLIENT_ID          — from console.cloud.google.com
//     GOOGLE_CLIENT_SECRET      — same
//
//   Email magic link (SMTP — any provider works):
//     EMAIL_SERVER_HOST         — e.g. smtp.resend.com  | smtp.sendgrid.net
//     EMAIL_SERVER_PORT         — e.g. 465 (SSL)        | 587 (TLS)
//     EMAIL_SERVER_USER         — e.g. resend           | apikey
//     EMAIL_SERVER_PASSWORD     — your SMTP API key / password
//     EMAIL_FROM                — e.g. LifeScript Studio <noreply@lifescript.app>
//
//   Session:
//     NEXTAUTH_SECRET           — openssl rand -base64 32
//     NEXTAUTH_URL              — https://your-domain.vercel.app
//
//   Admin dashboard (/admin):
//     ADMIN_EMAILS              — comma-separated list of authorised admin email addresses
//                                 e.g. you@example.com,colleague@example.com
//     ADMIN_SECRET_KEY          — secret for x-admin-key header (curl / script access)
export const authOptions = {
  adapter: buildAdapter(),

  providers: [
    GoogleProvider({
      clientId:     process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),

    EmailProvider({
      // Standard nodemailer SMTP object — swap host/port/user/pass for any
      // provider. Resend and SendGrid both work with these four variables.
      server: {
        host: process.env.EMAIL_SERVER_HOST,
        port: Number(process.env.EMAIL_SERVER_PORT) || 587,
        secure: Number(process.env.EMAIL_SERVER_PORT) === 465, // true for port 465 (SSL)
        auth: {
          user: process.env.EMAIL_SERVER_USER,
          pass: process.env.EMAIL_SERVER_PASSWORD,
        },
      },
      from: process.env.EMAIL_FROM || 'LifeScript Studio <noreply@lifescript.app>',

      // Magic link expiry: 10 minutes (NextAuth default is 24h — intentionally shorter
      // here for security since we're a creative app, not an enterprise tool).
      maxAge: 10 * 60,
    }),

    // ── PWA relay-exchange provider ───────────────────────────────────────────
    // Used exclusively to materialise a NextAuth session inside the iOS PWA
    // sandbox after the user has authenticated via magic link in external Safari.
    //
    // Flow: Safari opens magic link → NextAuth callback runs in Safari → our
    // /auth-relay-complete page writes a {status:'verified', userId, email}
    // entry to Redis under the relay_token key (TTL: 90 s). The PWA polls
    // /api/auth/relay-status, detects 'verified', then calls
    // signIn('relay-exchange', { relayToken }) here. authorize() reads and
    // atomically deletes the Redis entry, returns the user, and NextAuth sets a
    // JWT session cookie in the PWA's WKWebView cookie jar. One-time use.
    CredentialsProvider({
      id: 'relay-exchange',
      name: 'PWA Relay',
      credentials: {
        relayToken: { type: 'text' },
      },
      async authorize(credentials) {
        const { relayToken } = credentials ?? {};
        if (!relayToken || typeof relayToken !== 'string' || relayToken.length > 64) return null;
        try {
          const redis = await getRedis();
          // Read then delete: not a single GETDEL call so the offline stub's
          // get/del interface is honoured. The sub-millisecond race window is
          // acceptable for a human-paced UI flow.
          const raw = await redis.get(`relay:${relayToken}`);
          if (!raw) return null;
          await redis.del(`relay:${relayToken}`);
          const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (data?.status !== 'verified' || !data.userId || !data.email) return null;
          return { id: data.userId, email: data.email };
        } catch (err) {
          console.error('relay-exchange authorize error:', err.message);
          return null;
        }
      },
    }),
  ],

  session: { strategy: 'jwt' },

  // ── Lifecycle events ────────────────────────────────────────────────────────
  // Fires on every sign-in; `isNewUser` is true only the first time the adapter creates
  // the account. We drop a short-lived Redis flag so the NEXT /api/me call (already made
  // on load to resolve tier) can surface `justSignedUp` to the browser, where the GA4
  // `sign_up` event fires with correct client-side attribution (the _ga cookie lives in
  // the browser, so a server-side GA call would mis-attribute). Best-effort; never blocks
  // auth on a Redis hiccup.
  events: {
    async signIn({ user, account, isNewUser }) {
      if (!isNewUser || !user?.id) return;
      try {
        const redis = await getRedis();
        await redis.set(`signup:fresh:${user.id}`, account?.provider || 'unknown', { ex: 600 });
      } catch (e) {
        console.warn(`⚠️ signup flag skipped (Redis): ${e.message}`);
      }
    },
  },

  callbacks: {
    async jwt({ token, account, user }) {
      if (account) {
        // user.id is set by the adapter on the first sign-in and is a stable UUID
        // for all providers. We fall back to providerAccountId for dev environments
        // where the adapter is absent (Google sub, or email address for Email provider).
        token.uid      = user?.id ?? account.providerAccountId;
        token.provider = account.provider;
      }
      return token;
    },
    async session({ session, token }) {
      // Expose uid on the client session so API routes can call session.user.id
      // without having to decode the JWT themselves.
      session.user.id = token.uid;
      return session;
    },
  },

  pages: {
    // No custom sign-in page — auth is triggered via our AuthModal.
    signIn: '/',
    // After the magic link email is sent, redirect back home so our modal can
    // show the "check your inbox" confirmation state client-side.
    verifyRequest: '/?magic=sent',
  },

  secret: process.env.NEXTAUTH_SECRET,
};

// ── Session + tier resolver ───────────────────────────────────────────────────
// Called by every API route quota gate. Returns a unified context object.
//
// Return shape:
//   { userId, tier: 'anonymous'|'free'|'pro', identifier, email }
//
// identifier is the Redis quota key segment:
//   authenticated → "u:{userId}"   (stable across devices and providers)
//   anonymous     → device-id / IP fallback (unchanged behaviour)

// Lazy import redis to avoid the offline stub interfering with the adapter instance.
async function getRedis() {
  const mod = await import('./redis.js');
  return mod.default;
}

export async function getSessionAndTier(req, res) {
  const session = await getServerSession(req, res, authOptions);

  if (session?.user?.id) {
    const userId = session.user.id;
    let tier = 'free';
    try {
      const redis  = await getRedis();
      const stored = await redis.get(`user:tier:${userId}`);
      if (stored === 'pro') tier = 'pro';
      else if (stored === 'admin') tier = 'admin';
    } catch {
      // Redis unavailable — fail open to 'free' so a paying user is not blocked.
    }
    return { userId, tier, identifier: `u:${userId}`, email: session.user.email, name: session.user.name };
  }

  // No session — anonymous guest.
  return {
    userId:     null,
    tier:       'anonymous',
    identifier: extractIdentifier(req, req.body?.deviceId),
    email:      null,
  };
}
