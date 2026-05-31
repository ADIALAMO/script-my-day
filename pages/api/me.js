import { getSessionAndTier } from '../../lib/auth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { userId, tier, email } = await getSessionAndTier(req, res);
  return res.status(200).json({
    authenticated: !!userId,
    tier,
    email,
  });
}
