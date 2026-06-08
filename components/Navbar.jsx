import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Film, Languages, Clapperboard, LogOut, Crown, ChevronDown, User, CreditCard, Loader2, Gift } from 'lucide-react';
import { useSession, signOut } from 'next-auth/react';
import LaunchTicket from './LaunchTicket';
import ReferralModal from './ReferralModal';
import { BILLING_ENABLED } from '../constants/billing';

// Fetches the current user's tier from the server.
// refreshToken is an external counter; incrementing it triggers a re-fetch.
function useTier(authenticated, refreshToken) {
  const [tier, setTier] = useState('free');
  useEffect(() => {
    if (!authenticated) { setTier('anonymous'); return; }
    fetch('/api/me', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        setTier(d.tier || 'free');
        // GA4 sign_up — fires once per new account (server-flagged), in the browser so the
        // _ga client_id attributes it correctly. `referred` = arrived via an invite link.
        if (d.justSignedUp && typeof window !== 'undefined' && window.gtag) {
          const referred = typeof document !== 'undefined' && document.cookie.includes('ls_ref=');
          window.gtag('event', 'sign_up', { method: d.signupMethod || 'unknown', referred });
        }
      })
      .catch(() => setTier('free'));
  }, [authenticated, refreshToken]);
  return tier;
}

// ── Sub-components ────────────────────────────────────────────────────────────

// The amber "Pro Member" badge with ambient glow.
const ProBadge = ({ isHe }) => (
  <span className="hidden md:flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-[9px] font-black tracking-widest uppercase whitespace-nowrap shadow-[0_0_12px_rgba(245,158,11,0.2)]">
    ✦ {isHe ? 'פרו' : 'Pro'}
  </span>
);

// The muted "Free Plan" badge.
const FreeBadge = ({ isHe }) => (
  <span className="hidden md:inline-block text-[9px] font-bold text-white/25 tracking-widest uppercase whitespace-nowrap">
    {isHe ? 'חינמי' : 'Free'}
  </span>
);

// Dropdown menu rendered via portal so it escapes the navbar's overflow:hidden.
function AvatarDropdown({ session, tier, isHe, anchor, onClose, onUpgradeClick, onInviteClick }) {
  const ref = useRef(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [portalError,   setPortalError]   = useState(null);

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    setPortalError(null);
    try {
      const res  = await fetch('/api/portal', { method: 'POST', credentials: 'include' });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setPortalError(
          data.code === 'NO_CUSTOMER'
            ? (isHe ? 'המנוי עדיין מסתנכרן — נסה שוב עוד רגע.' : 'Subscription syncing — try again in a moment.')
            : (data.error || (isHe ? 'שגיאה בפתיחת הפורטל.' : 'Could not open billing portal.'))
        );
        setPortalLoading(false);
        return;
      }
      // Keep loading active through the navigation so there's no janky reset.
      // Flag the billing round-trip so index.js's pageshow guard reloads cleanly
      // on return from the Stripe portal (and only then — never on a bare PWA
      // foreground restore, which would read as a session loss).
      try { sessionStorage.setItem('ls_checkout_pending', '1'); } catch {}
      window.location.href = data.url;
    } catch {
      setPortalError(isHe ? 'שגיאת רשת — נסה שוב.' : 'Network error. Please try again.');
      setPortalLoading(false);
    }
  };

  // Position the dropdown below the anchor element.
  const [style, setStyle] = useState({});
  useEffect(() => {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const isRtl = isHe;
    setStyle({
      position: 'fixed',
      top: rect.bottom + 8,
      ...(isRtl ? { left: rect.left } : { right: window.innerWidth - rect.right }),
    });
  }, [anchor, isHe]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target) && !anchor?.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [anchor, onClose]);

  const isPro     = tier === 'pro';
  const isAdmin   = tier === 'admin';
  const isElevated = isPro || isAdmin; // hides "Upgrade" CTA for both pro and admin
  const name  = session?.user?.name  || '';
  const email = session?.user?.email || '';

  const dropdown = (
    <div
      ref={ref}
      style={style}
      dir={isHe ? 'rtl' : 'ltr'}
      className="z-[9999] w-56 bg-[#0a0a12] border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.9)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150"
    >
      {/* Identity block */}
      <div className="px-4 py-3.5 border-b border-white/[0.06]">
        <p className="text-white text-[13px] font-bold leading-tight truncate">{name}</p>
        <p className="text-white/35 text-[11px] truncate mt-0.5">{email}</p>
        {/* Current plan */}
        <div className="mt-2 flex items-center gap-1.5">
          {isAdmin ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-500/15 border border-violet-500/25 text-violet-400 text-[9px] font-black tracking-wider uppercase">
              ∞ {isHe ? 'אדמין' : 'Admin'}
            </span>
          ) : isPro ? (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/25 text-amber-400 text-[9px] font-black tracking-wider uppercase">
              ✦ {isHe ? 'חבר פרו' : 'Pro Member'}
            </span>
          ) : (
            <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white/5 border border-white/8 text-white/30 text-[9px] font-bold tracking-wider uppercase">
              {isHe ? 'מסלול חינמי' : 'Free Plan'}
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="py-1.5">
        {/* Upgrade to Pro — hidden for pro and admin users */}
        {!isElevated && (
          <button
            onClick={() => { onClose(); onUpgradeClick(); }}
            className="w-full flex items-center gap-2.5 px-4 py-2.5 text-amber-400 hover:bg-amber-500/10 transition-colors duration-150 group"
          >
            <Crown size={13} className="shrink-0 group-hover:scale-110 transition-transform" />
            <span className="text-[12px] font-bold">
              {BILLING_ENABLED
                ? (isHe ? 'שדרג לפרו 👑' : 'Upgrade to Pro 👑')
                : (isHe ? 'Pro — רשימת המתנה 🎬' : 'Pro — Join waitlist 🎬')}
            </span>
          </button>
        )}

        {/* Manage Subscription — only for paying Pro subscribers, not admin */}
        {isPro && (
          <>
            <button
              onClick={handleManageSubscription}
              disabled={portalLoading}
              className="w-full flex items-center gap-2.5 px-4 py-2.5 text-amber-400/70 hover:text-amber-400 hover:bg-amber-500/[0.07] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150 group"
            >
              {portalLoading ? (
                <Loader2 size={13} className="shrink-0 animate-spin" />
              ) : (
                <CreditCard size={13} className="shrink-0 group-hover:scale-110 transition-transform" />
              )}
              <span className="text-[12px] font-semibold">
                {portalLoading
                  ? (isHe ? 'פותח...' : 'Opening…')
                  : (isHe ? 'נהל מנוי' : 'Manage Subscription')}
              </span>
            </button>
            {portalError && (
              <p className={`px-4 pb-2 text-[10px] text-red-400/70 leading-snug ${isHe ? 'text-right' : ''}`}>
                {portalError}
              </p>
            )}
          </>
        )}

        {/* Invite friends — referral loop, available to every signed-in user */}
        <button
          onClick={() => { onClose(); onInviteClick(); }}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-[#d4a373] hover:bg-[#d4a373]/10 transition-colors duration-150 group"
        >
          <Gift size={13} className="shrink-0 group-hover:scale-110 transition-transform" />
          <span className="text-[12px] font-bold">
            {isHe ? 'הזמן חברים 🎁' : 'Invite friends 🎁'}
          </span>
        </button>

        {/* Sign out */}
        <button
          onClick={() => { onClose(); signOut({ callbackUrl: '/' }); }}
          className="w-full flex items-center gap-2.5 px-4 py-2.5 text-white/40 hover:text-white/70 hover:bg-white/[0.04] transition-colors duration-150"
        >
          <LogOut size={13} className="shrink-0" />
          <span className="text-[12px]">{isHe ? 'התנתק' : 'Sign out'}</span>
        </button>
      </div>
    </div>
  );

  if (typeof window === 'undefined') return null;
  return createPortal(dropdown, document.body);
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Navbar({ lang, onLanguageToggle, historyCount = 0, onHistoryOpen, onOpenAuthModal, tierRefreshToken = 0 }) {
  const { data: session, status } = useSession();
  const isAuthenticated = status === 'authenticated';
  const tier = useTier(isAuthenticated, tierRefreshToken);
  const isHe = lang === 'he';
  const isPro = tier === 'pro' || tier === 'admin';

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [referralOpen, setReferralOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const avatarBtnRef = useRef(null);

  useEffect(() => { setMounted(true); }, []);

  // Close dropdown on route change or Escape key.
  useEffect(() => {
    if (!dropdownOpen) return;
    const onKey = (e) => { if (e.key === 'Escape') setDropdownOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dropdownOpen]);

  const handleOpenAuthModal = (ctx = 'general') => {
    onOpenAuthModal?.(ctx);
  };

  return (
    <nav className={`sticky top-0 left-0 right-0 z-[100] w-full border-b border-white/10 bg-black/80 backdrop-blur-md overflow-hidden touch-none
      px-3 pt-[max(3.5rem,calc(env(safe-area-inset-top)+0.75rem))] pb-3
      md:pt-4 md:pb-4 md:px-6
      flex justify-between items-end md:items-center`}
      dir={isHe ? 'rtl' : 'ltr'}
    >
      {/* ── Logo ── */}
      <div className="flex items-center gap-2 md:gap-4 shrink-0">
        <div className="flex items-center justify-center w-9 h-9 md:w-12 md:h-12 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/20 shadow-lg shrink-0">
          <Film className="text-[#d4a373] w-4 h-4 md:w-6 md:h-6" />
        </div>
        <div className="flex flex-col items-start leading-none">
          <div className="text-[14px] md:text-2xl font-black text-[#d4a373] tracking-tighter italic uppercase leading-[0.8]">
            LIFESCRIPT
          </div>
          <div className="text-white font-[900] uppercase text-[10px] md:text-[18px] tracking-tighter mt-1">
            STUDIO
          </div>
        </div>
      </div>

      {/* ── Right controls ── */}
      <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
        <LaunchTicket lang={lang} />

        {/* History */}
        <button
          onClick={onHistoryOpen}
          aria-label={isHe ? 'ארכיון הפקות' : 'Production archive'}
          className="relative flex items-center justify-center w-8 h-8 md:w-9 md:h-9 border border-white/15 rounded-xl hover:border-[#d4a373]/40 hover:bg-[#d4a373]/8 transition-all duration-300 shrink-0"
        >
          <Clapperboard size={14} className="text-[#d4a373]/55 md:w-[15px] md:h-[15px] transition-colors duration-300" />
          {historyCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[15px] h-[15px] px-[3px] rounded-full bg-[#d4a373] text-black text-[7.5px] font-black leading-none flex items-center justify-center">
              {historyCount > 9 ? '9+' : historyCount}
            </span>
          )}
        </button>

        {/* Language toggle */}
        <button
          onClick={onLanguageToggle}
          className="flex items-center gap-1.5 px-2 py-1.5 md:px-4 md:py-2 border border-white/20 rounded-full text-[10px] md:text-[13px] hover:bg-white/10 hover:border-[#d4a373]/30 transition-all text-white font-medium whitespace-nowrap"
        >
          <Languages size={12} className="text-[#d4a373] md:w-[14px]" />
          {isHe ? 'EN' : 'עב'}
        </button>

        {/* ── Auth chip ── */}
        {status === 'loading' ? (
          // Skeleton while session resolves — prevents layout shift.
          <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 animate-pulse shrink-0" />
        ) : !isAuthenticated ? (
          // ── Anonymous: Sign In pill ──
          <button
            onClick={() => handleOpenAuthModal('general')}
            className="flex items-center gap-1.5 px-3 py-1.5 md:px-4 md:py-2 bg-[#d4a373]/10 hover:bg-[#d4a373]/20 border border-[#d4a373]/30 hover:border-[#d4a373]/50 rounded-full text-[10px] md:text-[12px] font-bold text-[#d4a373] tracking-wide transition-all duration-200 whitespace-nowrap shrink-0 active:scale-95"
          >
            <User size={11} className="shrink-0" />
            <span className="hidden sm:inline">{isHe ? 'כניסה' : 'Sign In'}</span>
          </button>
        ) : (
          // ── Authenticated: Avatar + badge + dropdown ──
          <div className="flex items-center gap-2 shrink-0">
            {/* Go Pro CTA — desktop, free users only */}
            {!isPro && (
              <button
                onClick={() => handleOpenAuthModal('upgrade')}
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/25 hover:border-amber-500/45 text-amber-400 text-[10px] font-black tracking-wide transition-all duration-200 whitespace-nowrap active:scale-95"
              >
                <Crown size={11} />
                {BILLING_ENABLED
                  ? (isHe ? 'שדרג לפרו' : 'Go Pro')
                  : (isHe ? 'Pro · בקרוב' : 'Pro · Soon')}
              </button>
            )}

            {/* Badge (desktop) */}
            {isPro ? <ProBadge isHe={isHe} /> : <FreeBadge isHe={isHe} />}

            {/* Avatar button */}
            <button
              ref={avatarBtnRef}
              onClick={() => setDropdownOpen(v => !v)}
              aria-label={isHe ? 'תפריט חשבון' : 'Account menu'}
              aria-expanded={dropdownOpen}
              className={`relative w-8 h-8 md:w-9 md:h-9 rounded-full overflow-hidden border-2 transition-all duration-200 shrink-0 focus:outline-none
                ${isPro
                  ? 'border-amber-400/60 shadow-[0_0_12px_rgba(245,158,11,0.35)] hover:shadow-[0_0_20px_rgba(245,158,11,0.5)]'
                  : 'border-white/20 hover:border-[#d4a373]/50'
                }`}
            >
              {session?.user?.image ? (
                <img
                  src={session.user.image}
                  alt={session.user.name || ''}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-full h-full bg-[#d4a373]/20 flex items-center justify-center">
                  <User size={14} className="text-[#d4a373]/70" />
                </div>
              )}
              {/* Pro ring pulse */}
              {isPro && (
                <span className="absolute inset-0 rounded-full animate-ping opacity-20 bg-amber-400 pointer-events-none" />
              )}
            </button>

            {/* Dropdown */}
            {mounted && dropdownOpen && (
              <AvatarDropdown
                session={session}
                tier={tier}
                isHe={isHe}
                anchor={avatarBtnRef.current}
                onClose={() => setDropdownOpen(false)}
                onUpgradeClick={() => handleOpenAuthModal('upgrade')}
                onInviteClick={() => setReferralOpen(true)}
              />
            )}
          </div>
        )}
      </div>

      <ReferralModal isOpen={referralOpen} onClose={() => setReferralOpen(false)} lang={lang} />
    </nav>
  );
}
