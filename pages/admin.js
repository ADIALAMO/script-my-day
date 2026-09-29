import { getServerSession } from 'next-auth/next';
import { authOptions } from '../lib/auth.js';
import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  Shield, Users, Activity, Check, AlertCircle,
  Loader2, ArrowLeft, RefreshCw, Film,
  FileText, Image as ImageIcon, BookOpen, Gauge, Crown, Wallet,
  CreditCard, UserCog, ListChecks, Clock, Search, ChevronLeft, ChevronRight,
} from 'lucide-react';

// ── Server-side auth gate ──────────────────────────────────────────────────────
// This function runs ONLY on the server. No admin logic reaches the client bundle
// unless the session email is in the ADMIN_EMAILS allowlist.
export async function getServerSideProps(context) {
  const session = await getServerSession(context.req, context.res, authOptions);

  if (!session?.user?.email) {
    return { redirect: { destination: '/', permanent: false } };
  }

  const allowed = (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);

  if (!allowed.includes(session.user.email.toLowerCase())) {
    return { redirect: { destination: '/', permanent: false } };
  }

  return {
    props: {
      adminEmail: session.user.email,
      adminName: session.user.name || session.user.email,
    },
  };
}

// ── Status badge ───────────────────────────────────────────────────────────────
function CircuitBadge({ status, remainingMs }) {
  const isOpen   = status === 'OPEN';
  const isUnknown = status === 'UNKNOWN';
  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full shrink-0 ${
        isOpen ? 'bg-red-500' : isUnknown ? 'bg-yellow-500' : 'bg-green-500'
      }`} />
      <span className={`text-xs font-black uppercase tracking-widest ${
        isOpen ? 'text-red-400' : isUnknown ? 'text-yellow-400' : 'text-green-400'
      }`}>
        {status}
      </span>
      {isOpen && remainingMs > 0 && (
        <span className="text-[10px] text-white/25 font-mono">
          ({Math.ceil(remainingMs / 1000)}s)
        </span>
      )}
    </div>
  );
}

// ── Big-number metric tile ──────────────────────────────────────────────────────
function Metric({ icon: Icon, label, value, sub, accent = 'text-[#d4a373]' }) {
  return (
    <div className="bg-black/30 border border-white/8 rounded-xl px-4 py-4">
      <div className="flex items-center gap-1.5 mb-2">
        <Icon size={12} className={accent} />
        <span className="text-[9px] uppercase tracking-[0.2em] text-white/30">{label}</span>
      </div>
      <div className="text-2xl font-black text-white tabular-nums leading-none">
        {value ?? '—'}
      </div>
      {sub != null && <div className="text-[10px] text-white/30 font-mono mt-1.5">{sub}</div>}
    </div>
  );
}

// ── Budget utilisation bar (green → amber → RED as it fills) ──────────────────────
function BudgetBar({ label, block }) {
  const pct      = block?.pct;          // null when no budget env is configured
  const capped   = pct != null;
  const isHot    = capped && pct >= 90;
  const isWarm   = capped && pct >= 70 && pct < 90;
  const barColor = isHot ? 'bg-red-500' : isWarm ? 'bg-amber-400' : 'bg-emerald-500';
  const txtColor = isHot ? 'text-red-400' : isWarm ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-widest text-white/40">{label}</span>
        <span className={`text-[11px] font-mono font-black ${capped ? txtColor : 'text-white/30'}`}>
          {capped ? `${pct}%` : 'no cap'}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        {capped && (
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.max(2, pct)}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between text-[10px] font-mono text-white/30">
        <span>{block?.used ?? 0}{capped ? ` / ${block.max}` : ''} calls</span>
        <span>${block?.usd ?? 0}{capped ? ` / $${block.budgetUsd}` : ' spent'}</span>
      </div>
    </div>
  );
}

// ── Pro source badge ─────────────────────────────────────────────────────────────
// Maps how a user got Pro (lib/pro-source.js + PRO_ALLOWLIST) to a color + label.
const SOURCE_STYLES = {
  stripe:    { label: 'Stripe',    icon: CreditCard,  className: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400' },
  admin:     { label: 'Admin',     icon: UserCog,      className: 'bg-violet-500/15 border-violet-500/30 text-violet-400' },
  allowlist: { label: 'Allowlist', icon: ListChecks,   className: 'bg-sky-500/15 border-sky-500/30 text-sky-400' },
  unknown:   { label: 'Unknown',   icon: AlertCircle,  className: 'bg-white/[0.06] border-white/15 text-white/40' },
};

function SourceBadge({ source }) {
  const s = SOURCE_STYLES[source] || SOURCE_STYLES.unknown;
  const Icon = s.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${s.className}`}>
      <Icon size={10} />
      {s.label}
    </span>
  );
}

// Relative time ("3h ago", "2d ago") for a Pro-grant ISO timestamp. Returns
// null for falsy input — callers render nothing (e.g. allowlist/unknown rows
// with no `since`) rather than a misleading "just now".
function timeAgo(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return null;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${Math.max(mins, 0)}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Page component ─────────────────────────────────────────────────────────────
export default function AdminDashboard({ adminEmail }) {
  // Live stats (users / activity / budget)
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Provider health
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // Tier management
  const [targetEmail, setTargetEmail] = useState('');
  const [selectedTier, setSelectedTier] = useState('pro');
  const [tierStatus, setTierStatus] = useState(null); // null | 'loading' | { success, message }

  // Pro Users — who's Pro, and how
  const [proUsers, setProUsers] = useState(null);
  const [proUsersLoading, setProUsersLoading] = useState(true);

  // All Users — every signup, paginated
  const ALL_USERS_LIMIT = 25;
  const [allUsers, setAllUsers] = useState(null);
  const [allUsersLoading, setAllUsersLoading] = useState(true);
  const [allUsersOffset, setAllUsersOffset] = useState(0);
  const [allUsersTier, setAllUsersTier] = useState('all');
  const [allUsersSearch, setAllUsersSearch] = useState(''); // committed (submitted) search
  const [allUsersSearchInput, setAllUsersSearchInput] = useState(''); // live input value

  const fetchAllUsers = useCallback((offset, tier, email) => {
    setAllUsersLoading(true);
    const params = new URLSearchParams({ limit: String(ALL_USERS_LIMIT), offset: String(offset), tier });
    if (email) params.set('email', email);
    fetch(`/api/admin/users?${params}`)
      .then(r => r.json())
      .then(data => { setAllUsers(data); setAllUsersLoading(false); })
      .catch(err => { setAllUsers({ _error: err.message }); setAllUsersLoading(false); });
  }, []);

  const fetchHealth = useCallback(() => {
    setHealthLoading(true);
    fetch('/api/provider-health')
      .then(r => r.json())
      .then(data => { setHealth(data); setHealthLoading(false); })
      .catch(err => {
        setHealth({ _error: err.message });
        setHealthLoading(false);
      });
  }, []);

  const fetchStats = useCallback(() => {
    setStatsLoading(true);
    fetch('/api/admin/stats')
      .then(r => r.json())
      .then(data => { setStats(data); setStatsLoading(false); })
      .catch(err => { setStats({ _error: err.message }); setStatsLoading(false); });
  }, []);

  const fetchProUsers = useCallback(() => {
    setProUsersLoading(true);
    fetch('/api/admin/pro-users')
      .then(r => r.json())
      .then(data => { setProUsers(data); setProUsersLoading(false); })
      .catch(err => { setProUsers({ _error: err.message }); setProUsersLoading(false); });
  }, []);

  const refreshAll = useCallback(() => {
    fetchHealth(); fetchStats(); fetchProUsers();
    // Keep whatever page/filter/search the admin is currently on rather than
    // resetting to page 0 every 30s — that would be jarring mid-browse.
    fetchAllUsers(allUsersOffset, allUsersTier, allUsersSearch);
  }, [fetchHealth, fetchStats, fetchProUsers, fetchAllUsers, allUsersOffset, allUsersTier, allUsersSearch]);

  // refreshAll's identity changes whenever the All Users filter/page state
  // does (so it always fetches the page the admin is currently looking at).
  // Keep a ref to the latest version so the mount-once interval below never
  // calls a stale closure from whatever state was current on first render.
  const refreshAllRef = useRef(refreshAll);
  useEffect(() => { refreshAllRef.current = refreshAll; }, [refreshAll]);

  // Initial load + 30s auto-refresh for a live, real-time feel. The stats endpoint
  // is O(1) (one mget + one scard + one OpenRouter ping) so polling is cheap.
  useEffect(() => {
    refreshAllRef.current();
    const id = setInterval(() => refreshAllRef.current(), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── All Users: filter/search/pagination handlers ─────────────────────────
  const handleTierFilterChange = (tier) => {
    setAllUsersTier(tier);
    setAllUsersOffset(0);
    fetchAllUsers(0, tier, allUsersSearch);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    const email = allUsersSearchInput.trim();
    setAllUsersSearch(email);
    setAllUsersOffset(0);
    fetchAllUsers(0, allUsersTier, email);
  };

  const handleClearSearch = () => {
    setAllUsersSearchInput('');
    setAllUsersSearch('');
    setAllUsersOffset(0);
    fetchAllUsers(0, allUsersTier, '');
  };

  const handlePrevPage = () => {
    const next = Math.max(0, allUsersOffset - ALL_USERS_LIMIT);
    setAllUsersOffset(next);
    fetchAllUsers(next, allUsersTier, allUsersSearch);
  };

  const handleNextPage = () => {
    const next = allUsersOffset + ALL_USERS_LIMIT;
    setAllUsersOffset(next);
    fetchAllUsers(next, allUsersTier, allUsersSearch);
  };

  const handleSetTier = async (e) => {
    e.preventDefault();
    if (!targetEmail.trim()) return;
    setTierStatus('loading');

    try {
      const res = await fetch('/api/admin/set-tier', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tier: selectedTier, targetEmail: targetEmail.trim() }),
      });
      const data = await res.json();

      if (data.success) {
        setTierStatus({
          success: true,
          message: `${data.email} → ${data.tier.toUpperCase()} (id: ${data.userId.slice(0, 12)}…)`,
        });
        setTargetEmail('');
        fetchProUsers();
        fetchAllUsers(allUsersOffset, allUsersTier, allUsersSearch);
      } else {
        setTierStatus({ success: false, message: data.error || 'Unknown error.' });
      }
    } catch (err) {
      setTierStatus({ success: false, message: err.message });
    }
  };

  const healthEntries = health && !health._error
    ? Object.entries(health)
    : [];

  return (
    <>
      <Head>
        <title>Admin — LifeScript Studio</title>
        {/* Prevent search engines from indexing this page */}
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <div className="min-h-screen bg-[#030712] text-white">

        {/* ── Top bar ─────────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-10 border-b border-white/5 bg-[#030712]/80 backdrop-blur-md px-6 py-4">
          <div className="max-w-3xl mx-auto flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Shield size={15} className="text-[#d4a373]" />
              <span className="font-black text-[11px] tracking-[0.35em] uppercase text-[#d4a373]">
                Admin
              </span>
              <span className="text-white/15 text-xs mx-1">·</span>
              <Film size={13} className="text-white/30" />
              <span className="font-black text-[11px] tracking-[0.25em] uppercase text-white/40">
                LifeScript Studio
              </span>
            </div>

            <div className="flex items-center gap-4">
              <span className="text-[10px] text-white/25 font-mono hidden sm:block">
                {adminEmail}
              </span>
              <Link
                href="/"
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-[#d4a373] transition-colors"
              >
                <ArrowLeft size={12} />
                Home
              </Link>
            </div>
          </div>
        </header>

        <main className="max-w-3xl mx-auto px-6 py-10 space-y-6">

          {/* ── Live toolbar ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-[10px] uppercase tracking-[0.3em] text-white/40 font-black">
                Live · auto-refresh 30s
              </span>
              {stats?.timestamp && (
                <span className="text-[10px] text-white/20 font-mono hidden sm:block">
                  {new Date(stats.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
            <button
              onClick={refreshAll}
              disabled={statsLoading || healthLoading}
              className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-[#d4a373] transition-colors disabled:opacity-30"
            >
              <RefreshCw size={11} className={(statsLoading || healthLoading) ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {stats?._error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/8 border border-red-500/20 text-red-400 text-[11px] font-mono">
              <AlertCircle size={12} className="shrink-0" /> stats: {stats._error}
            </div>
          )}
          {stats && !stats._error && stats.redisOk === false && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-500/8 border border-amber-500/20 text-amber-400 text-[11px] font-mono">
              <AlertCircle size={12} className="shrink-0" /> Redis unreachable — counters shown as 0.
            </div>
          )}

          {/* ── Users ────────────────────────────────────────────────────── */}
          <section className="bg-[#0f1117] border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/5">
              <Users size={14} className="text-[#d4a373]" />
              <h2 className="font-black text-[11px] uppercase tracking-[0.3em] text-white/70">Users</h2>
            </div>
            <div className="p-6 grid grid-cols-3 gap-3">
              <Metric icon={Users} label="Total" value={stats?.users?.total} />
              <Metric icon={Crown} label="Pro"  value={stats?.users?.pro}  accent="text-amber-400" sub="paying / VIP" />
              <Metric icon={Users} label="Free" value={stats?.users?.free} accent="text-sky-400" />
            </div>
          </section>

          {/* ── Activity (creations) ─────────────────────────────────────── */}
          <section className="bg-[#0f1117] border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/5">
              <Activity size={14} className="text-[#d4a373]" />
              <h2 className="font-black text-[11px] uppercase tracking-[0.3em] text-white/70">
                Creations <span className="text-white/25 normal-case tracking-normal">· today / all-time</span>
              </h2>
            </div>
            <div className="p-6 grid grid-cols-3 gap-3">
              <Metric icon={FileText}  label="Scripts" value={stats?.activity?.script?.today}
                      sub={`${stats?.activity?.script?.total ?? 0} total`} />
              <Metric icon={ImageIcon} label="Posters" value={stats?.activity?.poster?.today}
                      sub={`${stats?.activity?.poster?.total ?? 0} total`} accent="text-fuchsia-400" />
              <Metric icon={BookOpen}  label="Comics"  value={stats?.activity?.comic?.today}
                      sub={`${stats?.activity?.comic?.total ?? 0} total`} accent="text-violet-400" />
            </div>
          </section>

          {/* ── Budget & resources ───────────────────────────────────────── */}
          <section className="bg-[#0f1117] border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/5">
              <Gauge size={14} className="text-[#d4a373]" />
              <h2 className="font-black text-[11px] uppercase tracking-[0.3em] text-white/70">
                Daily Budget <span className="text-white/25 normal-case tracking-normal">· resets midnight UTC</span>
              </h2>
            </div>
            <div className="p-6 space-y-6">
              <BudgetBar label="Paid image spend"  block={stats?.budget?.image} />
              <BudgetBar label="Identity spend"    block={stats?.budget?.identity} />

              {/* Live OpenRouter prepaid balance */}
              <div className="flex items-center justify-between pt-4 border-t border-white/5">
                <div className="flex items-center gap-2">
                  <Wallet size={13} className="text-[#d4a373]" />
                  <span className="text-[10px] uppercase tracking-widest text-white/40">OpenRouter balance</span>
                </div>
                {stats?.budget?.openrouter ? (
                  <span className="text-sm font-mono font-black text-emerald-400 tabular-nums">
                    ${stats.budget.openrouter.remaining}
                    <span className="text-white/25 font-normal"> / ${stats.budget.openrouter.totalCredits}</span>
                  </span>
                ) : (
                  <span className="text-[11px] font-mono text-white/25">unavailable</span>
                )}
              </div>
            </div>
          </section>

          {/* ── User Tier Management ─────────────────────────────────────── */}
          <section className="bg-[#0f1117] border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center gap-2.5 px-6 py-4 border-b border-white/5">
              <Users size={14} className="text-[#d4a373]" />
              <h2 className="font-black text-[11px] uppercase tracking-[0.3em] text-white/70">
                User Tier Management
              </h2>
            </div>

            <form onSubmit={handleSetTier} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-2">
                  User Email
                </label>
                <input
                  type="email"
                  value={targetEmail}
                  onChange={e => { setTargetEmail(e.target.value); setTierStatus(null); }}
                  placeholder="user@example.com"
                  required
                  autoComplete="off"
                  className="w-full bg-black/50 border border-white/8 rounded-xl px-4 py-3 text-sm text-white placeholder-white/15 focus:border-[#d4a373]/40 outline-none transition-colors font-mono"
                />
              </div>

              <div>
                <label className="block text-[10px] text-white/30 uppercase tracking-widest mb-2">
                  Target Tier
                </label>
                <div className="flex gap-2">
                  {['free', 'pro', 'admin'].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedTier(t)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${
                        selectedTier === t
                          ? t === 'pro'
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                            : t === 'admin'
                              ? 'bg-violet-500/15 border-violet-500/40 text-violet-400'
                              : 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                          : 'bg-white/[0.03] border-white/8 text-white/25 hover:text-white/50 hover:border-white/15'
                      }`}
                    >
                      {t === 'admin' ? '∞ admin' : t}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={tierStatus === 'loading' || !targetEmail.trim()}
                className="w-full py-3 rounded-xl bg-[#d4a373] text-black font-black text-xs uppercase tracking-widest hover:bg-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {tierStatus === 'loading' ? (
                  <><Loader2 size={13} className="animate-spin" /> Applying…</>
                ) : (
                  selectedTier === 'admin' ? 'Grant ∞ Admin Access' : `Set ${selectedTier} tier`
                )}
              </button>

              {tierStatus && tierStatus !== 'loading' && (
                <div className={`flex items-start gap-2 p-3 rounded-xl text-[11px] font-mono break-all ${
                  tierStatus.success
                    ? 'bg-green-500/8 border border-green-500/20 text-green-400'
                    : 'bg-red-500/8 border border-red-500/20 text-red-400'
                }`}>
                  {tierStatus.success
                    ? <Check size={11} className="mt-px shrink-0" />
                    : <AlertCircle size={11} className="mt-px shrink-0" />}
                  {tierStatus.message}
                </div>
              )}
            </form>
          </section>

          {/* ── Pro Users ─────────────────────────────────────────────────── */}
          <section className="bg-[#0f1117] border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <Crown size={14} className="text-[#d4a373]" />
                <h2 className="font-black text-[11px] uppercase tracking-[0.3em] text-white/70">
                  Pro Users <span className="text-white/25 normal-case tracking-normal">· who, and how</span>
                </h2>
              </div>
              <button
                onClick={fetchProUsers}
                disabled={proUsersLoading}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors disabled:opacity-30"
              >
                <RefreshCw size={11} className={proUsersLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            <div className="p-6">
              {proUsersLoading ? (
                <div className="flex items-center gap-2 text-white/25 text-xs">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              ) : proUsers?._error ? (
                <p className="text-red-400 text-xs font-mono">{proUsers._error}</p>
              ) : !proUsers?.users?.length ? (
                <p className="text-white/20 text-xs">No Pro users yet.</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {proUsers.users.map(u => (
                    <div key={u.userId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="text-sm font-mono text-white/70 truncate">
                          {u.email || u.userId}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {u.by && (
                            <span className="text-[10px] text-white/25 font-mono">by {u.by}</span>
                          )}
                          {timeAgo(u.since) && (
                            <span className="flex items-center gap-1 text-[10px] text-white/25 font-mono">
                              <Clock size={9} /> {timeAgo(u.since)}
                            </span>
                          )}
                          {u.alsoAllowlisted && u.source !== 'allowlist' && (
                            <span className="text-[9px] uppercase tracking-widest text-sky-400/70 font-black">
                              also on PRO_ALLOWLIST
                            </span>
                          )}
                        </div>
                      </div>
                      <SourceBadge source={u.source} />
                    </div>
                  ))}
                </div>
              )}

              {proUsers?.pendingAllowlist?.length > 0 && (
                <div className="mt-6 pt-4 border-t border-white/5">
                  <div className="text-[10px] uppercase tracking-widest text-white/30 mb-2">
                    On PRO_ALLOWLIST, never signed in
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {proUsers.pendingAllowlist.map(email => (
                      <span key={email} className="text-[11px] font-mono text-white/40 bg-white/[0.03] border border-white/8 rounded-full px-2.5 py-1">
                        {email}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* ── All Users ─────────────────────────────────────────────────── */}
          <section className="bg-[#0f1117] border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <Users size={14} className="text-[#d4a373]" />
                <h2 className="font-black text-[11px] uppercase tracking-[0.3em] text-white/70">
                  All Users
                  {allUsers?.total != null && (
                    <span className="text-white/25 normal-case tracking-normal"> · {allUsers.total} total</span>
                  )}
                </h2>
              </div>
              <button
                onClick={() => fetchAllUsers(allUsersOffset, allUsersTier, allUsersSearch)}
                disabled={allUsersLoading}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors disabled:opacity-30"
              >
                <RefreshCw size={11} className={allUsersLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            <div className="p-6 space-y-4">
              {/* Tier filter + search */}
              <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
                <div className="flex gap-2">
                  {['all', 'free', 'pro', 'admin'].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => handleTierFilterChange(t)}
                      className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border ${
                        allUsersTier === t
                          ? 'bg-[#d4a373]/15 border-[#d4a373]/40 text-[#d4a373]'
                          : 'bg-white/[0.03] border-white/8 text-white/25 hover:text-white/50 hover:border-white/15'
                      }`}
                    >
                      {t}
                      {allUsers?.totalByTier && t !== 'all' && (
                        <span className="opacity-60"> · {allUsers.totalByTier[t]}</span>
                      )}
                    </button>
                  ))}
                </div>

                <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
                    <input
                      type="email"
                      value={allUsersSearchInput}
                      onChange={e => setAllUsersSearchInput(e.target.value)}
                      placeholder="exact email…"
                      autoComplete="off"
                      className="bg-black/50 border border-white/8 rounded-lg pl-8 pr-3 py-1.5 text-[11px] text-white placeholder-white/15 focus:border-[#d4a373]/40 outline-none transition-colors font-mono w-44"
                    />
                  </div>
                  {allUsersSearch && (
                    <button
                      type="button"
                      onClick={handleClearSearch}
                      className="text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors"
                    >
                      Clear
                    </button>
                  )}
                </form>
              </div>

              {/* Rows */}
              {allUsersLoading ? (
                <div className="flex items-center gap-2 text-white/25 text-xs">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              ) : allUsers?._error ? (
                <p className="text-red-400 text-xs font-mono">{allUsers._error}</p>
              ) : !allUsers?.users?.length ? (
                <p className="text-white/20 text-xs">
                  {allUsersSearch ? 'No user found for that email.' : 'No users yet.'}
                </p>
              ) : (
                <div className="divide-y divide-white/5">
                  {allUsers.users.map(u => (
                    <div key={u.userId} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="text-sm font-mono text-white/70 truncate">
                          {u.email || u.userId}
                        </div>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span className="text-[10px] uppercase tracking-widest text-white/25 font-black">
                            {u.signupProvider || 'unknown'}
                          </span>
                          <span className="text-[10px] text-white/15">·</span>
                          <span className="text-[10px] text-white/25 font-mono">
                            signed up {timeAgo(u.signupAt) || 'before tracking started'}
                          </span>
                          {u.lastActiveAt && (
                            <span className="flex items-center gap-1 text-[10px] text-white/25 font-mono">
                              <Clock size={9} /> active {timeAgo(u.lastActiveAt)}
                            </span>
                          )}
                          {u.alsoOnAllowlist && (
                            <span className="text-[9px] uppercase tracking-widest text-sky-400/70 font-black">
                              also on PRO_ALLOWLIST
                            </span>
                          )}
                        </div>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded-full border text-[10px] font-black uppercase tracking-widest ${
                        u.tier === 'admin' ? 'bg-violet-500/15 border-violet-500/30 text-violet-400'
                        : u.tier === 'pro' ? 'bg-amber-500/15 border-amber-500/30 text-amber-400'
                        : 'bg-sky-500/15 border-sky-500/30 text-sky-400'
                      }`}>
                        {u.tier}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {!allUsersSearch && (
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={handlePrevPage}
                    disabled={allUsersLoading || allUsersOffset === 0}
                    className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    <ChevronLeft size={12} /> Prev
                  </button>
                  <span className="text-[10px] text-white/20 font-mono">
                    {allUsersOffset + 1}–{allUsersOffset + (allUsers?.users?.length ?? 0)}
                  </span>
                  <button
                    onClick={handleNextPage}
                    disabled={allUsersLoading || !allUsers?.hasMore}
                    className="flex items-center gap-1 text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                  >
                    Next <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>
          </section>

          {/* ── Provider Health ──────────────────────────────────────────── */}
          <section className="bg-[#0f1117] border border-white/8 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
              <div className="flex items-center gap-2.5">
                <Activity size={14} className="text-[#d4a373]" />
                <h2 className="font-black text-[11px] uppercase tracking-[0.3em] text-white/70">
                  Image Provider Circuit Breakers
                </h2>
              </div>
              <button
                onClick={fetchHealth}
                disabled={healthLoading}
                className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-white/25 hover:text-white/50 transition-colors disabled:opacity-30"
              >
                <RefreshCw size={11} className={healthLoading ? 'animate-spin' : ''} />
                Refresh
              </button>
            </div>

            <div className="p-6">
              {healthLoading ? (
                <div className="flex items-center gap-2 text-white/25 text-xs">
                  <Loader2 size={13} className="animate-spin" /> Loading…
                </div>
              ) : health?._error ? (
                <p className="text-red-400 text-xs font-mono">{health._error}</p>
              ) : healthEntries.length === 0 ? (
                <p className="text-white/20 text-xs">No provider data returned.</p>
              ) : (
                <div className="divide-y divide-white/5">
                  {healthEntries.map(([name, state]) => (
                    <div key={name} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                      <span className="text-sm font-mono text-white/50 capitalize">{name}</span>
                      <div className="flex items-center gap-4">
                        {state.status === 'OPEN' && state.openUntil && (
                          <span className="text-[10px] text-white/20 font-mono hidden sm:block">
                            until {new Date(state.openUntil).toLocaleTimeString()}
                          </span>
                        )}
                        <CircuitBadge
                          status={state.status}
                          remainingMs={state.remainingMs ?? 0}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

        </main>
      </div>
    </>
  );
}
