import { getServerSession } from 'next-auth/next';
import { authOptions } from '../../../lib/auth.js';
import { isAdminRequest } from '../../../lib/api-utils.js';
import redis from '../../../lib/redis.js';

// ── Cost constants (mirrors of the private kill-switch rates) ────────────────────
// Kept in sync with lib/circuit-breaker.js (KLEIN_COST_USD) and lib/identity.js
// (IDENTITY_MAX_COST_USD). Pricing every call at the worst case makes the dollar
// figures a TRUE upper bound on real spend — we can only undershoot.
const KLEIN_COST_USD     = 0.0035; // per paid faceless image (OpenRouter Klein)
const IDENTITY_COST_USD  = 0.06;   // per identity call (Grok worst case)

function isAllowedAdminSession(email) {
  if (!email || !process.env.ADMIN_EMAILS) return false;
  const allowed = process.env.ADMIN_EMAILS
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.toLowerCase());
}

// num(x) → safe integer (Upstash may return string | number | null).
const num = (v) => parseInt(v, 10) || 0;

// Builds a { used, max, usd, budgetUsd, pct } block for a daily $-budget.
// max/budgetUsd are null when no budget env is configured (protection is opt-in).
function budgetBlock(used, budgetEnv, costPerCall) {
  const budgetUsd = parseFloat(budgetEnv);
  const hasBudget = Number.isFinite(budgetUsd) && budgetUsd > 0;
  const max = hasBudget ? Math.floor(budgetUsd / costPerCall) : null;
  return {
    used,
    usd: +(used * costPerCall).toFixed(2),
    max,
    budgetUsd: hasBudget ? budgetUsd : null,
    pct: hasBudget && max > 0 ? Math.min(100, Math.round((used / max) * 100)) : null,
  };
}

// Live OpenRouter account balance (real $ left on the prepaid key).
// Returns null on any failure — the dashboard degrades gracefully to the
// internal Redis counters, which are the authoritative kill-switch source anyway.
async function fetchOpenRouterCredits() {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return null;
  try {
    const r = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const { data } = await r.json();
    const total = Number(data?.total_credits) || 0;
    const usage = Number(data?.total_usage) || 0;
    return {
      totalCredits: +total.toFixed(2),
      totalUsage:   +usage.toFixed(2),
      remaining:    +(total - usage).toFixed(2),
    };
  } catch {
    return null; // network / timeout / shape mismatch → no balance card
  }
}

/**
 * GET /api/admin/stats
 *
 * Single Source of Truth for the admin dashboard. One mget for every global
 * counter (O(1) — independent of user count, never scans), one SCARD for the
 * Pro member set, and one parallel fetch to OpenRouter for the live balance.
 *
 * Auth (either): x-admin-key header (ADMIN_SECRET_KEY) OR a session whose email
 * is in ADMIN_EMAILS — same gate as /admin and set-tier.
 */
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const session = await getServerSession(req, res, authOptions);
  if (!isAdminRequest(req) && !isAllowedAdminSession(session?.user?.email)) {
    return res.status(403).json({ error: 'Admin access required.' });
  }

  const today = new Date().toISOString().split('T')[0];

  // Every counter read in ONE mget — order matters, mapped by index below.
  const keys = [
    'stats:users:total',                    // 0
    `stats:script:global:${today}`,         // 1
    'stats:script:total',                   // 2
    `stats:poster:global:${today}`,         // 3
    'stats:poster:total',                   // 4
    `stats:comic:global:${today}`,          // 5
    'stats:comic:total',                    // 6
    `usage:image:paid:global:${today}`,     // 7  (paid faceless image count)
    `usage:identity:global:${today}`,       // 8  (identity call count)
  ];

  const [countersR, proCountR, openrouter] = await Promise.allSettled([
    redis.mget(...keys),
    redis.scard('stats:pro:members'),
    fetchOpenRouterCredits(),
  ]);

  // Fail-open: a Redis blip yields zeros, never a 500 — the dashboard still renders.
  const c = countersR.status === 'fulfilled' && Array.isArray(countersR.value)
    ? countersR.value.map(num)
    : new Array(keys.length).fill(0);
  const proCount = proCountR.status === 'fulfilled' ? num(proCountR.value) : 0;
  const orBalance = openrouter.status === 'fulfilled' ? openrouter.value : null;

  const usersTotal = c[0];

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    redisOk:   countersR.status === 'fulfilled',
    users: {
      total: usersTotal,
      pro:   proCount,
      free:  Math.max(0, usersTotal - proCount),
    },
    activity: {
      script: { today: c[1], total: c[2] },
      poster: { today: c[3], total: c[4] },
      comic:  { today: c[5], total: c[6] },
    },
    budget: {
      image:    budgetBlock(c[7], process.env.DAILY_IMAGE_BUDGET,    KLEIN_COST_USD),
      identity: budgetBlock(c[8], process.env.DAILY_IDENTITY_BUDGET, IDENTITY_COST_USD),
      openrouter: orBalance, // live prepaid balance, or null if unreachable
    },
  });
}
