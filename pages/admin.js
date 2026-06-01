import { getServerSession } from 'next-auth/next';
import { authOptions } from '../lib/auth.js';
import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import {
  Shield, Users, Activity, Check, AlertCircle,
  Loader2, ArrowLeft, RefreshCw, Film,
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

// ── Page component ─────────────────────────────────────────────────────────────
export default function AdminDashboard({ adminEmail }) {
  // Provider health
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(true);

  // Tier management
  const [targetEmail, setTargetEmail] = useState('');
  const [selectedTier, setSelectedTier] = useState('pro');
  const [tierStatus, setTierStatus] = useState(null); // null | 'loading' | { success, message }

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

  useEffect(() => { fetchHealth(); }, [fetchHealth]);

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
                  {['free', 'pro'].map(t => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setSelectedTier(t)}
                      className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition-all border ${
                        selectedTier === t
                          ? t === 'pro'
                            ? 'bg-amber-500/15 border-amber-500/40 text-amber-400'
                            : 'bg-sky-500/15 border-sky-500/40 text-sky-400'
                          : 'bg-white/[0.03] border-white/8 text-white/25 hover:text-white/50 hover:border-white/15'
                      }`}
                    >
                      {t}
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
                  `Set ${selectedTier} tier`
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
