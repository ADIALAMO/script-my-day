/**
 * Admin gate for the NEW waitlist route (the older admin routes keep their own inline copies — deliberately untouched).
 *   - valid x-admin-key HEADER (never a URL parameter)            -> allowed
 *   - signed-in session whose e-mail is in ADMIN_EMAILS            -> allowed
 *   - signed in, not an admin                                      -> 403 {error}
 *   - no session and no valid key                                  -> 401 {error}
 * Sends the 401/403 itself (no data, no detail) and returns false; returns true when allowed.
 */
import { getServerSession } from 'next-auth/next';
import { authOptions } from './auth.js';
import { isAdminRequest } from './api-utils.js';

export function isAllowedAdminSession(email) {
  if (!email || !process.env.ADMIN_EMAILS) return false;
  const allowed = process.env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(String(email).toLowerCase());
}

export async function requireAdmin(req, res) {
  if (isAdminRequest(req)) return true;
  let email = null;
  try { email = (await getServerSession(req, res, authOptions))?.user?.email || null; } catch { email = null; }
  if (isAllowedAdminSession(email)) return true;
  res.status(email ? 403 : 401).json({ error: email ? 'Admin access required.' : 'Authentication required.' });
  return false;
}
