/**
 * Rate limits for NextAuth magic-link sign-in e-mails (POST /api/auth/signin/email).
 *
 * Applied in pages/api/auth/[...nextauth].js BEFORE NextAuth runs, so a refused request never
 * touches the SMTP server. Two sliding windows (config/limits.js AUTH_EMAIL_LIMITS):
 *   • per client IP        — stops one machine spraying many addresses
 *   • per target ADDRESS   — stops mail-bombing one inbox / exhausting the sender quota
 *
 * No account-existence leak: both limits apply to ANY string, whether or not an account exists,
 * and the response is identical either way. Redis trouble falls back to an in-process limiter
 * (per serverless instance) instead of failing fully open.
 *
 * The 429 body carries a `url` with ?error=RateLimited because next-auth/react's signIn() parses
 * `new URL(data.url)` and would otherwise throw; the sign-in modal reads `status === 429`.
 */
import { createHash } from 'crypto';
import { enforceRateLimit } from './rate-limit.js';
import { extractTrustedIp } from './api-utils.js';
import { AUTH_EMAIL_LIMITS } from '../config/limits.js';

const HOUR_MS = 60 * 60 * 1000;

export function isEmailSignin(req) {
  const p = req.query?.nextauth;
  return req.method === 'POST' && Array.isArray(p) && p[0] === 'signin' && p[1] === 'email';
}

/** NextAuth's normalisation (lowercase, trim, drop ",…" after the domain) + strip "+tag" from the local part. */
export function normalizeEmailForLimit(raw) {
  if (typeof raw !== 'string') return null;
  let [local, domain] = raw.toLowerCase().trim().split('@');
  if (!local || !domain) return null;
  domain = domain.split(',')[0];
  local = local.split('+')[0];
  return `${local}@${domain}`;
}

function errorUrl(req) {
  const base = (process.env.NEXTAUTH_URL || `https://${req.headers?.host || 'localhost'}`).replace(/\/$/, '');
  return `${base}/api/auth/signin?error=RateLimited`;
}

/** Returns true when the request was refused (a 429 has been sent): the caller must return. */
export async function limitMagicLink(req, res) {
  const extraBody = { url: errorUrl(req) };

  const ip = extractTrustedIp(req);
  if (await enforceRateLimit(req, res, 'auth-email-ip', {
    identifier: `ip:${ip}`,
    extraBody,
    fallback: { max: AUTH_EMAIL_LIMITS.perIpPerHour, windowMs: HOUR_MS },
  })) return true;

  const addr = normalizeEmailForLimit(req.body?.email);
  if (addr) {
    const digest = createHash('sha256').update(addr).digest('hex').slice(0, 32);
    if (await enforceRateLimit(req, res, 'auth-email-addr', {
      identifier: `e:${digest}`, // hashed: no address in Redis keys
      extraBody,
      fallback: { max: AUTH_EMAIL_LIMITS.perEmailPerHour, windowMs: HOUR_MS },
    })) return true;
  }
  return false;
}
