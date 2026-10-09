import _NextAuth from 'next-auth';
import { authOptions } from '../../../lib/auth.js';
import { isEmailSignin, limitMagicLink } from '../../../lib/auth-email-limit.js';

const NextAuth = _NextAuth.default ?? _NextAuth;
const nextAuthHandler = NextAuth(authOptions);

// Sign-in e-mails are rate limited per IP and per address BEFORE NextAuth runs (see
// lib/auth-email-limit.js); every other auth route passes straight through.
export default async function handler(req, res) {
  if (isEmailSignin(req) && await limitMagicLink(req, res)) return;
  return nextAuthHandler(req, res);
}
