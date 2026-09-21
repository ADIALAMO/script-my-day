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
  // Only the callback/email and error routes matter for the "configuration"
  // repro — log the raw cookie header + the exact callback-url cookie value
  // so we can see whether it arrives double-encoded. REMOVE once root-caused.
  if (req.url?.includes('/callback/email') || req.url?.includes('/error')) {
    const cookieHeader = req.headers?.cookie || '(none)';
    console.error(`[AUTH-DEBUG][instance:${INSTANCE_ID}] raw Cookie header: ${cookieHeader}`);
    console.error(`[AUTH-DEBUG][instance:${INSTANCE_ID}] parsed callback-url cookie: ${JSON.stringify(req.cookies?.['__Secure-next-auth.callback-url'])}`);
  }
  return handler(req, res);
}
