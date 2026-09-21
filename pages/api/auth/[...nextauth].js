import _NextAuth from 'next-auth';
import { authOptions, INSTANCE_ID } from '../../../lib/auth.js';

const NextAuth = _NextAuth.default ?? _NextAuth;
const handler = NextAuth(authOptions);

// TEMPORARY: logs every request to this route with the cold-start instance
// ID from lib/auth.js, so failures can be correlated to which serverless
// instance (and thus which buildAdapter() outcome) handled them. Wraps
// rather than replaces the real handler. REMOVE once root-caused.
export default async function wrappedHandler(req, res) {
  console.error(`[AUTH-DEBUG][instance:${INSTANCE_ID}] ${req.method} ${req.url}`);
  return handler(req, res);
}
