import React, { useState, useEffect, useRef, useCallback } from 'react';
import Head from 'next/head';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { Film, Copyright, AlertCircle, X, Download, Share2, MessageSquare, Send, Check } from 'lucide-react';
import { getMsg, CODES, isQuotaError, inferCode } from '../lib/messages.js';
import Navbar from '../components/Navbar';
import AuthModal from '../components/AuthModal';
import UpgradeModal from '../components/UpgradeModal';
import WaitlistModal from '../components/WaitlistModal';
import { BILLING_ENABLED } from '../constants/billing';
import { useSession } from 'next-auth/react';
import ScriptOutput from '../components/ScriptOutput';
import HeroSection from '../components/HeroSection';
import ScriptForm from '../components/ScriptForm';
import { Analytics } from '@vercel/analytics/react';
import { track } from '@vercel/analytics';
import { SHOWCASE_POSTERS, SHOWCASE_REELS } from '../constants/showcase';
import { MODAL_DATA } from '../constants/modalData';
import HistoryPanel from '../components/HistoryPanel';
import CinematicLoader from '../components/CinematicLoader';
import CookieConsent from '../components/CookieConsent';
import { useScriptHistory } from '../hooks/useScriptHistory';

// ── Genre metadata for filmstrip grouping ────────────────────────────────────
const GENRE_GROUPS = [
  { key: 'action',  labelEn: 'Action',   labelHe: 'אקשן',     color: '#ef4444' },
  { key: 'drama',   labelEn: 'Drama',    labelHe: 'דרמה',     color: '#d4a373' },
  { key: 'sci-fi',  labelEn: 'Sci-Fi',   labelHe: 'מד"ב',     color: '#22d3ee' },
  { key: 'horror',  labelEn: 'Horror',   labelHe: 'אימה',     color: '#818cf8' },
  { key: 'romance', labelEn: 'Romance',  labelHe: 'רומנטיקה', color: '#f472b6' },
  { key: 'comedy',  labelEn: 'Comedy',   labelHe: 'קומדיה',   color: '#84cc16' },
  { key: 'comics',  labelEn: 'Comics',   labelHe: 'קומיקס',   color: '#fb923c' },
  { key: 'shorts',  labelEn: 'Shorts',   labelHe: 'ציטוטים',  color: '#a78bfa' },
];

function inferPosterGenre(poster) {
  if (poster.type === 'comic') return 'comics';
  if (poster.type === 'text')  return 'shorts';
  const t = (poster.titleEn || '').toLowerCase();
  if (/action|war|adventure/.test(t))        return 'action';
  if (/sci.fi|futuristic|dystopian/.test(t)) return 'sci-fi';
  if (/horror|mystery|thriller/.test(t))     return 'horror';
  if (/romantic|romance/.test(t))            return 'romance';
  if (/comedy|wacky|urban/.test(t))          return 'comedy';
  return 'drama';
}

// ── Shared card body renderer (used by both Grid and Filmstrip) ───────────────
function PosterCardBody({ poster, lang, compact = false }) {
  // ── Text panel ──────────────────────────────────────────────────────────────
  if (poster.type === 'text') {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-center p-3" style={{ background: '#030712' }}>
        <div className="absolute inset-0 opacity-[0.035]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: compact ? '8px 8px' : '10px 10px' }} />
        <div className="absolute inset-0 opacity-10" style={{ background: `radial-gradient(ellipse at center, ${poster.accent}55 0%, transparent 70%)` }} />
        <div className="relative z-10 text-center space-y-1">
          {!compact && <p className="text-[7px] tracking-[0.4em] font-black uppercase" style={{ color: `${poster.accent}66` }}>{poster.textSub}</p>}
          {poster.textDisplay.split('\n').map((line, i) => (
            <p key={i} className="font-black leading-[0.9] select-none"
              style={{ fontSize: compact ? '0.85rem' : 'clamp(1.5rem, 7.5vw, 2rem)', color: poster.accent, fontFamily: 'Impact, "Arial Black", sans-serif', textShadow: `0 0 32px ${poster.accent}55` }}>
              {line}
            </p>
          ))}
          {!compact && (
            <>
              <div className="w-6 h-0.5 mx-auto mt-1.5 rounded-full" style={{ background: `${poster.accent}50` }} />
              <p className="text-[6px] tracking-[0.5em] font-black uppercase" style={{ color: `${poster.accent}35` }}>LIFESCRIPT</p>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Poster / Comic panel ─────────────────────────────────────────────────────
  // The <img> is in normal flow (block + h-auto) so the card gets real height in
  // CSS columns. aspect-ratio on the img pins the proportions; the gradient
  // overlay is absolute on top of it. No flex tricks, no padding hacks.
  const genreTag = lang === 'he'
    ? (poster.type === 'comic' ? 'פאנל:' : "ז'אנר:")
    : (poster.type === 'comic' ? 'PANEL:' : 'GENRE:');

  const imgAspect = poster.type === 'comic' ? 'aspect-square' : 'aspect-[2/3]';

  return (
    <div className="relative w-full overflow-hidden">
      <img
        src={poster.src || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500'}
        onError={(e) => { e.currentTarget.src = 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=500'; }}
        alt={lang === 'he' ? poster.titleHe : poster.titleEn}
        className={`relative z-0 block w-full h-auto object-cover ${imgAspect}`}
        loading="eager"
        decoding="sync"
        /* WebKit multicol paint fix: own backing store so Safari paints the
           image instead of a black box (and survives fullscreen reflow). */
        style={{ transform: 'translateZ(0)', WebkitBackfaceVisibility: 'hidden', backfaceVisibility: 'hidden' }}
      />
      <div className={`absolute inset-0 z-10 flex flex-col justify-end bg-gradient-to-t from-black/92 via-black/45 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none ${compact ? 'p-2' : 'p-4'}`}>
        <p className={`text-[#d4a373] font-black uppercase italic leading-none m-0 ${compact ? 'text-[6px] tracking-[0.14em] mb-[3px]' : 'text-[7px] tracking-[0.22em] mb-[5px]'}`}>
          {genreTag}
        </p>
        <p className={`text-white font-bold uppercase leading-tight line-clamp-2 m-0 ${compact ? 'text-[7px] tracking-wide' : 'text-[10px] tracking-widest'}`}>
          {lang === 'he' ? poster.titleHe : poster.titleEn}
        </p>
        {!compact && (
          <div className="mt-[6px] h-[1.5px] bg-[#d4a373] w-0 group-hover:w-8 transition-[width] duration-500 rounded-full" />
        )}
      </div>
    </div>
  );
}

// ── Cinematic Lightbox — scale+opacity crossfade + parallax script scrub ──────
function PosterLightbox({ poster, onClose, lang }) {
  const scrollRef = useRef(null);
  const { scrollYProgress } = useScroll({ container: scrollRef });
  const textY    = useTransform(scrollYProgress, [0, 1], ['0%', '-12%']);
  const imgScale = useTransform(scrollYProgress, [0, 0.65], [1, 1.1]);

  return (
    <motion.div
      key="lb-root"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.22 }}
      className="fixed inset-0 z-[1000]"
    >
      {/* Cinematic backdrop */}
      <div className="absolute inset-0 bg-black/72 backdrop-blur-md" onClick={onClose} />

      {/* Centered panel wrapper */}
      <div className="absolute inset-0 flex items-end md:items-center justify-center p-5 pb-24 md:pb-8 pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.92, y: 24 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 12 }}
          onClick={e => e.stopPropagation()}
          transition={{ type: 'spring', stiffness: 300, damping: 30, mass: 0.85 }}
          className="bg-[#0c0e18]/98 border border-[#d4a373]/28 rounded-[2.4rem] shadow-[0_32px_100px_rgba(0,0,0,0.94)] w-full max-w-md overflow-hidden flex flex-col relative pointer-events-auto"
          style={{ maxHeight: '80dvh' }}
        >
          {/* Close */}
          <button
            onClick={e => { e.stopPropagation(); onClose(); }}
            className="close-button absolute right-5 text-white/38 hover:text-[#d4a373] transition-all duration-300 z-[200] p-3.5 bg-black/25 backdrop-blur-md rounded-full group"
            style={{ top: 'calc(var(--sat,0px) + 14px)', touchAction: 'manipulation' }}
          >
            <X size={20} className="group-hover:rotate-90 transition-transform duration-450" />
          </button>

          {/* Hero — parallax scale */}
          <div className="w-full h-44 relative overflow-hidden shrink-0">
            {poster.src ? (
              <motion.img
                src={poster.src}
                alt={poster.titleEn}
                className="w-full h-full object-cover opacity-55"
                style={{ scale: imgScale }}
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: '#030712' }}>
                <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '10px 10px' }} />
                <div className="absolute inset-0 opacity-22" style={{ background: `radial-gradient(ellipse at center, ${poster.accent}44 0%, transparent 70%)` }} />
                {poster.textDisplay?.split('\n').map((line, i) => (
                  <p key={i} className="relative z-10 font-black leading-none opacity-55"
                    style={{ fontSize: '2.2rem', color: poster.accent, fontFamily: 'Impact, "Arial Black", sans-serif' }}>
                    {line}
                  </p>
                ))}
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0c0e18] via-[#0c0e18]/55 to-transparent" />
          </div>

          {/* Scrollable body — content fades in just behind the panel's scale-up */}
          <div ref={scrollRef} className="overflow-y-auto custom-scrollbar flex-grow px-7 pt-5 pb-10">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.12, duration: 0.2 }}
            >
              <div className="mb-7 pb-2 border-b border-[#d4a373]/22">
                <span className="text-[#d4a373] text-[9px] font-black tracking-[0.32em] uppercase italic">
                  {lang === 'he' ? poster.titleHe : poster.titleEn}
                </span>
              </div>
              <motion.div style={{ y: textY }}>
                <p
                  className="text-white/88 text-[1.05rem] md:text-[1.15rem] leading-relaxed font-light whitespace-pre-line"
                  style={{ fontFamily: "'Courier Prime','Courier New',monospace", direction: lang === 'he' ? 'rtl' : 'ltr' }}
                >
                  {lang === 'he' ? poster.excerptHe : poster.excerptEn}
                </p>
              </motion.div>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </motion.div>
  );
}

// ── Motion Reel Card — autoplay on hover, click to open lightbox ──────────────
function ReelCard({ reel, lang, onClick }) {
  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const handleEnter = useCallback(() => {
    setPlaying(true);
    const v = videoRef.current;
    if (v) { v.currentTime = 0; v.play().catch(() => {}); }
  }, []);

  const handleLeave = useCallback(() => {
    setPlaying(false);
    const v = videoRef.current;
    if (v) { v.pause(); v.load(); }
  }, []);

  return (
    <motion.div
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      onClick={() => onClick(reel)}
      whileHover={{ scale: 1.05, y: -6 }}
      transition={{ type: 'spring', stiffness: 340, damping: 26 }}
      className="relative shrink-0 w-[110px] md:w-[128px] rounded-2xl overflow-hidden cursor-pointer transition-colors duration-300 snap-start"
      style={{
        aspectRatio: '9/16',
        border: playing ? `1.5px solid ${reel.color}88` : '1.5px solid rgba(255,255,255,0.08)',
        boxShadow: playing ? `0 12px 40px ${reel.color}30` : 'none',
      }}
    >
      <video
        ref={videoRef}
        src={reel.src}
        poster={reel.poster}
        muted
        playsInline
        loop
        preload="none"
        className="w-full h-full object-cover"
      />
      <div
        className="absolute inset-0 transition-opacity duration-300 pointer-events-none"
        style={{
          background: 'linear-gradient(to top, rgba(0,0,0,0.9) 0%, rgba(0,0,0,0.15) 40%, rgba(0,0,0,0.55) 100%)',
          opacity: playing ? 0.7 : 0.9,
        }}
      />
      {!playing && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{ background: 'rgba(255,255,255,0.12)', border: '1.5px solid rgba(255,255,255,0.28)', backdropFilter: 'blur(4px)' }}>
            <div className="w-0 h-0 ml-0.5"
              style={{ borderTop: '6px solid transparent', borderBottom: '6px solid transparent', borderLeft: '11px solid rgba(255,255,255,0.85)' }} />
          </div>
        </div>
      )}
      <div className="absolute bottom-0 left-0 right-0 p-2.5 pointer-events-none">
        <div className="inline-block px-1.5 py-[2px] rounded-md text-[6px] font-black tracking-[0.12em] uppercase mb-1.5"
          style={{ background: `${reel.color}22`, color: reel.color, border: `1px solid ${reel.color}44` }}>
          {reel.tagline}
        </div>
        <p className="text-white text-[9px] font-bold leading-tight">
          {lang === 'he' ? reel.titleHe : reel.titleEn}
        </p>
      </div>
    </motion.div>
  );
}

function HomePage() {
  const { data: session, update: updateSession } = useSession();

  const [script, setScript] = useState('');
  const [scriptLoading, setScriptLoading] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('en');
  const [mounted, setMounted] = useState(false);

  const [selectedGenre, setSelectedGenre] = useState(null);
  // isTyping: true while ScriptOutput's typewriter animation is running
  const [isTyping, setIsTyping] = useState(false);
  const [modalContent, setModalContent] = useState(null);
  const [showTips, setShowTips] = useState(false);
  const [showGallery, setShowGallery] = useState(true);
  const [selectedPoster, setSelectedPoster] = useState(null);
  const [selectedReel,   setSelectedReel]   = useState(null);
  const [galleryMode,    setGalleryMode]    = useState('grid'); // 'grid' | 'filmstrip'
  const [producerName, setProducerName] = useState('');

  const abortControllerRef = useRef(null);
  const lastJournalEntryRef = useRef({ entry: '', genre: '' });
  const currentEntryIdRef = useRef(null);

  const { history, addEntry, updateEntry, deleteEntry } = useScriptHistory();
  const [showHistory, setShowHistory] = useState(false);
  const [initialPanels,    setInitialPanels]    = useState(null);
  const [initialPosterUrl, setInitialPosterUrl] = useState(null);

  // ── Auth modal (unauthenticated flows) ────────────────────────────────────
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authModalContext, setAuthModalContext] = useState('general');

  // ── Upgrade modal (authenticated free users) ───────────────────────────────
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  // ── Waitlist modal (shown instead of checkout while billing is gated) ───────
  const [showWaitlistModal, setShowWaitlistModal] = useState(false);
  // Stripe checkout return — 'success' | 'cancelled' | null
  const [checkoutNotice, setCheckoutNotice] = useState(null);
  // Incremented to trigger Navbar's useTier to re-fetch
  const [tierVersion, setTierVersion] = useState(0);

  // Smart router for 'upgrade' intent:
  //   billing gated  → Pro waitlist (everyone; no checkout exposed to the public)
  //   billing live   → authed users get the Pro checkout modal; guests sign in first
  // All other contexts go to the auth gate.
  const openAuthModal = useCallback((context = 'general') => {
    if (context === 'upgrade' && !BILLING_ENABLED) {
      setShowWaitlistModal(true);
      return;
    }
    if (context === 'upgrade' && session) {
      setShowUpgradeModal(true);
      return;
    }
    setAuthModalContext(context);
    setShowAuthModal(true);
  }, [session]);

  const closeAuthModal = useCallback(() => {
    setShowAuthModal(false);
  }, []);

  // Auto-dismiss the success notice after 7 s so it doesn't linger.
  // Cancelled notice stays until the user explicitly closes it.
  useEffect(() => {
    if (checkoutNotice !== 'success') return;
    const t = setTimeout(() => setCheckoutNotice(null), 7000);
    return () => clearTimeout(t);
  }, [checkoutNotice]);

  // --- Director's Log Logic ---
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('idle');
  const [feedbackError, setFeedbackError] = useState('');

  const handleSendFeedback = async () => {
    if (!feedbackText.trim()) return;
    setFeedbackStatus('sending');

    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: feedbackText,
          lang: lang,
          producerName: producerName || (lang === 'he' ? 'אורח' : 'Guest')
        }),
      });

      if (response.ok) {
        setFeedbackStatus('success');

        setTimeout(() => {
          setShowFeedback(false);
          setFeedbackStatus('idle');
          setFeedbackText('');
          setFeedbackError('');
        }, 2500);
      } else {
        throw new Error('Server responded with error');
      }
    } catch (err) {
      console.error("Feedback error:", err);
      setFeedbackStatus('idle');
      setFeedbackError(getMsg(CODES.FEEDBACK_FAIL, lang));
    }
  };

  useEffect(() => {
    setMounted(true);

    const savedName = localStorage.getItem('lifescript_producer_name');
    if (savedName) setProducerName(savedName);

    if (!localStorage.getItem('lifescript_device_id')) {
      const newId = 'ds_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('lifescript_device_id', newId);
    }

    // ── URL param handling ───────────────────────────────────────────────────
    // checkout: Stripe return signal — 'success' | 'cancelled'
    // Returns true if checkout=success was found, so callers can schedule
    // follow-up tier refreshes.
    function applyCheckoutParam() {
      const urlParams = new URLSearchParams(window.location.search);
      const checkoutParam = urlParams.get('checkout');
      if (!checkoutParam) return false;

      if (checkoutParam === 'success') {
        setCheckoutNotice('success');
        updateSession?.(); // force NextAuth to re-fetch session JWT
        setTierVersion(v => v + 1); // immediate tier re-fetch in Navbar
        // GA4 paid-conversion event (the "Pro signup"). sign_up tracks free accounts;
        // this tracks the upgrade to Pro on Stripe return.
        if (typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'subscribe', { method: 'stripe', plan: 'pro' });
        }
      } else if (checkoutParam === 'cancelled') {
        setCheckoutNotice('cancelled');
      }

      urlParams.delete('checkout');
      const cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
      window.history.replaceState(null, '', cleanUrl);
      return checkoutParam === 'success';
    }

    // ── Referral capture ─────────────────────────────────────────────────────
    // A friend arriving via lifescript.app/?ref=CODE: persist the code in a same-origin
    // cookie (survives the OAuth redirect round-trip) so it can be redeemed server-side
    // when they later sign in and generate their first poster. Strip ref from the URL.
    function applyRefParam() {
      const urlParams = new URLSearchParams(window.location.search);
      const ref = urlParams.get('ref');
      if (!ref) return;
      if (/^[a-z0-9]{1,16}$/i.test(ref)) {
        const maxAge = 60 * 60 * 24 * 30; // 30 days
        document.cookie = `ls_ref=${encodeURIComponent(ref)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
      }
      urlParams.delete('ref');
      const cleanUrl = window.location.pathname + (urlParams.toString() ? '?' + urlParams.toString() : '');
      window.history.replaceState(null, '', cleanUrl);
    }
    applyRefParam();

    const wasCheckoutSuccess = applyCheckoutParam();

    // Stripe webhooks are async — tier may not be 'pro' in Redis the instant
    // the user lands back on the app. Poll two more times to catch the update.
    const retryTimers = wasCheckoutSuccess
      ? [
          setTimeout(() => setTierVersion(v => v + 1), 3000),
          setTimeout(() => setTierVersion(v => v + 1), 8000),
        ]
      : [];

    // ── bfcache (Back-Forward Cache) guard ───────────────────────────────────
    // When the user leaves for Stripe, modern browsers freeze this page in
    // bfcache. Stripe then redirects back — some browsers restore the frozen
    // page instead of doing a fresh load, preserving React state exactly as it
    // was: UpgradeModal open, checkoutState='redirecting', close button hidden,
    // backdrop click disabled. The result is a fully blocked UI.
    //
    // The fix: when pageshow fires with persisted=true (bfcache restore),
    // force a clean reload so all state resets and URL params are processed.
    function handlePageShow(event) {
      if (event.persisted) window.location.reload();
    }

    window.addEventListener('pageshow', handlePageShow);

    return () => {
      retryTimers.forEach(clearTimeout);
      window.removeEventListener('pageshow', handlePageShow);
    };
  }, []);

  // ── Global body-scroll lock ──────────────────────────────────────────────
  // Prevents background scroll bleed whenever any page-level overlay is open.
  // HistoryPanel owns its own lock internally; this covers all other modals.
  useEffect(() => {
    const anyOpen = !!modalContent || !!selectedPoster || showAuthModal || showUpgradeModal || showWaitlistModal;
    if (!anyOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [modalContent, selectedPoster, showAuthModal, showUpgradeModal, showWaitlistModal]);

  const toggleLanguage = () => setLang(prev => prev === 'he' ? 'en' : 'he');

  const handleCancelGeneration = () => {
    abortControllerRef.current?.abort();
    setScriptLoading(false);
  };

  const handleGenerateScript = async (journalEntry, genre) => {
    if (!journalEntry || journalEntry.trim().length < 5) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    lastJournalEntryRef.current = { entry: journalEntry, genre };

    setShowGallery(false);
    setScriptLoading(true);
    setError('');
    setScript('');
    setSelectedGenre(genre);
    setInitialPanels(null);
    setInitialPosterUrl(null);

    try {
      const deviceId = localStorage.getItem('lifescript_device_id') || 'unknown';

      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-device-id': deviceId
        },
        signal: controller.signal,
        body: JSON.stringify({
          journalEntry,
          genre,
          producerName: producerName || (lang === 'he' ? 'אורח' : 'Guest'),
          deviceId: deviceId,
        }),
      });

      let data = {};
      try {
        data = await response.json();
      } catch (e) {
        // Vercel returned a bare HTML body (hard infrastructure timeout / 504).
        // There is no JSON to inspect — log what we know and surface the HTTP status.
        if (!response.ok) {
          console.error(`🔴 Non-JSON ${response.status} from /api/generate-script — likely a Vercel timeout`);
          throw new Error(lang === 'he' ? `שרת ההפקה לא זמין כרגע (HTTP ${response.status})` : `Production server offline (HTTP ${response.status})`);
        }
      }

      if (response.status === 403) {
        setScriptLoading(false);
        openAuthModal('quota');
        return;
      }

      if (response.status === 429) {
        if (typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'script_error', { error_type: 'quota_reached', genre });
        }
        setError(getMsg(data.code || CODES.QUOTA_SCRIPT, lang));
        setScriptLoading(false);
        return;
      }

      if (!response.ok) {
        // Log the full diagnostic payload — message, type, and stack all come from
        // the server's 🔴 SERVER CRASH response body during debugging.
        console.error('🔴 Server error payload:', data);
        if (data.errorStack) console.error('Server stack trace:\n', data.errorStack);
        if (typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'script_error', {
            error_type: 'server_error',
            status: response.status,
            genre
          });
        }
        throw new Error(data.message || data.error || 'Production Error');
      }

      const finalScript = data.script || data.output;

      if (finalScript) {
        setScript(finalScript);
        currentEntryIdRef.current = addEntry({
          genre,
          lang,
          producerName: producerName || (lang === 'he' ? 'אורח' : 'Guest'),
          journalEntry,
          script: finalScript,
          posterUrl: '',
        });
        track('Script Created', {
          genre: selectedGenre,
          language: lang,
          producer: producerName || 'Guest'
        });
        if (typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'script_generation_success', {
            genre: selectedGenre,
            language: lang
          });
        }

      } else {
        throw new Error(CODES.EMPTY_RESPONSE);
      }

    } catch (err) {
      if (err.name === 'AbortError') return;
      console.error("Frontend Generation Error:", err);
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'script_error', {
          error_type: 'frontend_exception',
          error_message: err.message,
          genre
        });
      }
      const code = Object.values(CODES).includes(err.message) ? err.message : inferCode(err);
      setError(getMsg(code, lang));
    } finally {
      setScriptLoading(false);
    }
  };

  if (!mounted) return null;

  return (
    <div className={`min-h-screen text-white flex flex-col selection:bg-[#d4a373]/30 ${lang === 'he' ? 'font-heebo' : ''}`} dir={lang === 'he' ? 'rtl' : 'ltr'}>
      <Head>
        <title>LifeScript | Cinematic AI Studio</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0" />
        <link rel="icon" href="/icon.png" />
        <link rel="apple-touch-icon" href="/icon.png" />
        <link rel="manifest" href="/manifest.json" />
        <meta name="theme-color" content="#030712" />
      </Head>

      {/* רקע גרדיאנט קולנועי */}
      <div className="mesh-gradient fixed inset-0 -z-10">
        <div className="mesh-sphere w-[600px] h-[600px] bg-purple-900/10 top-[-10%] left-[-10%]" />
        <div className="mesh-sphere w-[500px] h-[500px] bg-blue-900/10 bottom-[-10%] right-[-10%]" />
      </div>

      <Navbar
        lang={lang}
        onLanguageToggle={toggleLanguage}
        historyCount={history.length}
        onHistoryOpen={() => setShowHistory(true)}
        onOpenAuthModal={openAuthModal}
        tierRefreshToken={tierVersion}
      />

      <main className="container mx-auto pt-4 md:pt-8 pb-12 px-6 max-w-5xl flex-grow relative">

        <HeroSection lang={lang} />

        {/* ── Stripe checkout return notification ───────────────────────── */}
        <AnimatePresence>
          {checkoutNotice && (
            <motion.div
              key="checkout-notice"
              initial={{ opacity: 0, y: -10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.98 }}
              transition={{ duration: 0.32, ease: 'easeOut' }}
              className="mb-4"
            >
              {checkoutNotice === 'success' ? (
                <div
                  className="flex items-center gap-3.5 px-5 py-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 shadow-[0_4px_24px_rgba(245,158,11,0.10)]"
                  dir={lang === 'he' ? 'rtl' : 'ltr'}
                >
                  <div className="shrink-0 w-8 h-8 rounded-xl bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                    <Check size={14} className="text-amber-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-amber-400 font-black text-[13px] leading-none mb-0.5">
                      {lang === 'he' ? '✦ ברוך הבא לפרו!' : '✦ Welcome to Pro!'}
                    </p>
                    <p className="text-amber-400/55 text-[11px]">
                      {lang === 'he'
                        ? 'החשבון שלך שודרג. כל יכולות הפרו פעילות עכשיו.'
                        : 'Your account is upgraded. All Pro features are now active.'}
                    </p>
                  </div>
                  <button
                    onClick={() => setCheckoutNotice(null)}
                    aria-label={lang === 'he' ? 'סגור' : 'Dismiss'}
                    className="shrink-0 p-1.5 rounded-lg text-amber-400/35 hover:text-amber-400 hover:bg-amber-500/10 transition-all duration-150"
                  >
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div
                  className="flex items-center gap-3.5 px-5 py-4 rounded-2xl bg-white/[0.04] border border-white/8"
                  dir={lang === 'he' ? 'rtl' : 'ltr'}
                >
                  <AlertCircle size={15} className="shrink-0 text-white/30" />
                  <p className="flex-1 text-white/40 text-[12px]">
                    {lang === 'he'
                      ? 'הרכישה בוטלה — תוכל לשדרג בכל עת.'
                      : 'Checkout was cancelled — you can upgrade anytime.'}
                  </p>
                  <button
                    onClick={() => setCheckoutNotice(null)}
                    aria-label={lang === 'he' ? 'סגור' : 'Dismiss'}
                    className="shrink-0 p-1.5 text-white/20 hover:text-white/50 transition-colors duration-150"
                  >
                    <X size={13} />
                  </button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Auth modal — sign-in gate for unauthenticated users */}
        <AuthModal
          isOpen={showAuthModal}
          onClose={closeAuthModal}
          lang={lang}
          context={authModalContext}
        />

        {/* Upgrade modal — Pro plan for authenticated free users (billing live) */}
        <UpgradeModal
          isOpen={showUpgradeModal}
          onClose={() => setShowUpgradeModal(false)}
          lang={lang}
        />

        {/* Waitlist modal — shown instead of checkout while billing is gated */}
        <WaitlistModal
          isOpen={showWaitlistModal}
          onClose={() => setShowWaitlistModal(false)}
          lang={lang}
          defaultEmail={session?.user?.email || ''}
        />

        {/* Modals (Terms, Privacy, Support, About) */}
        <AnimatePresence>
          {modalContent && MODAL_DATA[modalContent] && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/95 md:backdrop-blur-xl p-4 md:p-6"
              onClick={() => setModalContent(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-[#0f1117] border border-[#d4a373]/20 p-8 md:p-12 pt-16 rounded-[2.5rem] max-w-2xl w-full max-h-[calc(100vh-2rem)] sm:max-h-[calc(100vh-4rem)] overflow-hidden relative shadow-2xl flex flex-col"
              >
                <div className={lang === 'he' ? 'text-right' : 'text-left'} dir={lang === 'he' ? 'rtl' : 'ltr'}>
                  <div className="flex items-center justify-between border-b border-[#d4a373]/10 pb-4 mb-6">
                    <h2 className="text-[#d4a373] text-2xl font-black uppercase tracking-tighter italic">
                      {MODAL_DATA[modalContent][lang].title}
                    </h2>
                    <button onClick={() => setModalContent(null)} className="close-button text-white/20 hover:text-[#d4a373] transition-colors p-2">
                      <X size={28} />
                    </button>
                  </div>

                  <div className="space-y-8 text-gray-300 text-sm md:text-base leading-relaxed overflow-y-auto max-h-[60vh] pr-2 custom-scrollbar">
                    {MODAL_DATA[modalContent][lang].sections.map((section, idx) => (
                      <section
                        key={idx}
                        className={MODAL_DATA[modalContent][lang].type === 'faq' ? "bg-white/5 p-5 rounded-2xl border border-white/5" : ""}
                      >
                        <h3 className="text-white font-bold mb-2 flex items-center gap-2">
                          {MODAL_DATA[modalContent][lang].type === 'faq' ? (
                            <span className="text-[#d4a373]">{(idx + 1).toString().padStart(2, '0')}.</span>
                          ) : (
                            <span className="w-1.5 h-1.5 rounded-full bg-[#d4a373]"></span>
                          )}
                          {section.h}
                        </h3>
                        <p className={MODAL_DATA[modalContent][lang].type === 'faq' ? "text-gray-400 text-xs md:text-sm" : "opacity-80"}>
                          {section.p}
                        </p>
                      </section>
                    ))}

                    {MODAL_DATA[modalContent][lang].summary && (
                      <div className="bg-white/5 p-4 rounded-xl border border-white/5 mt-8 text-center italic text-[11px] text-[#d4a373]/80">
                        {MODAL_DATA[modalContent][lang].summary}
                      </div>
                    )}

                    {MODAL_DATA[modalContent][lang].quote && (
                      <p className="text-center text-[10px] tracking-[0.6em] text-[#d4a373]/40 uppercase py-4 border-t border-white/5">
                        {MODAL_DATA[modalContent][lang].quote}
                      </p>
                    )}

                    {MODAL_DATA[modalContent][lang].footerLabel && (
                      <div className="pt-6 text-center border-t border-white/5">
                        <p className="text-gray-500 text-[10px] uppercase tracking-widest mb-4">
                          {MODAL_DATA[modalContent][lang].footerLabel}
                        </p>
                        <div className="inline-block px-6 py-2 rounded-full bg-[#d4a373]/10 border border-[#d4a373]/20 text-[#d4a373] text-[11px] font-bold">
                          {MODAL_DATA[modalContent][lang].footerButton}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Script Section */}
        <motion.section
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className={`glass-panel rounded-[3rem] overflow-hidden shadow-2xl relative ${(scriptLoading || isTyping) ? 'ai-loading-active' : ''}`}
        >
          <div className="bg-[#030712]/60 backdrop-blur-3xl p-8 md:p-16 relative">
            <ScriptForm
              onSubmit={handleGenerateScript}
              onCancel={handleCancelGeneration}
              loading={scriptLoading}
              lang={lang}
              producerName={producerName}
              setProducerName={setProducerName}
              onInputChange={(val) => setIsTyping(val)}
              showTips={showTips}
              setShowTips={setShowTips}
            />

            {/* שמירה על מנגנון השגיאות המקורי שלך */}
            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-10 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 flex flex-col items-center justify-center gap-4 text-red-400 text-center"
                  dir={lang === 'he' ? 'rtl' : 'ltr'}
                >
                  <div className="flex items-center gap-3 text-xl md:text-2xl font-bold">
                    <AlertCircle size={28} />
                    <span>{error}</span>
                  </div>
                  {lastJournalEntryRef.current.entry && (
                    <button
                      type="button"
                      onClick={() => handleGenerateScript(lastJournalEntryRef.current.entry, lastJournalEntryRef.current.genre)}
                      className="px-6 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/30 text-red-300 text-sm font-black uppercase tracking-widest transition-all"
                    >
                      {lang === 'he' ? '↺ נסה שוב' : '↺ RETRY'}
                    </button>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Inline cinematic loader — overlays this panel only, never full-screen */}
          <CinematicLoader
            isVisible={scriptLoading}
            lang={lang}
            producerName={producerName || (lang === 'he' ? 'אורח' : 'Guest')}
            onCancel={handleCancelGeneration}
            phase="script"
          />
        </motion.section>

        {/* ════════════════════════════════════════════════════════════════
            Gallery Section
        ════════════════════════════════════════════════════════════════ */}
        <AnimatePresence>
          {showGallery && !script && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="mt-16 mb-10"
            >
              {/* ── Header + Segmented View Toggle ───────────────────────── */}
              <div className="flex items-start justify-between mb-9 px-1">
                <div className="flex-1 flex flex-col items-center gap-2 pt-0.5">
                  <h3 className="text-[#d4a373] text-[10px] font-black tracking-[0.5em] uppercase opacity-60">
                    {lang === 'he' ? 'גלריית הפקות' : 'PRODUCTION SAMPLES'}
                  </h3>
                  <div className="h-[1px] w-20 bg-[#d4a373]/30" />
                </div>

                {/* Segmented control */}
                <div className="flex items-center gap-0.5 bg-white/[0.04] rounded-xl p-[3px] border border-white/[0.07] shrink-0 ml-4">
                  {[
                    { key: 'grid',      labelEn: '⊞ Grid',      labelHe: '⊞ גריד' },
                    { key: 'filmstrip', labelEn: '▤ Reel',      labelHe: '▤ ריל'  },
                  ].map(seg => (
                    <button
                      key={seg.key}
                      onClick={() => setGalleryMode(seg.key)}
                      className={`px-3 py-[5px] rounded-[9px] text-[7.5px] font-black uppercase tracking-wide transition-all duration-200 ${
                        galleryMode === seg.key
                          ? 'bg-[#d4a373] text-black shadow-sm'
                          : 'text-white/32 hover:text-white/58'
                      }`}
                    >
                      {lang === 'he' ? seg.labelHe : seg.labelEn}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Motion Reels Strip ────────────────────────────────────── */}
              <div className="mb-8 px-1">
                <div className="flex items-center gap-3 mb-4">
                  <div className="h-px flex-1 bg-[#d4a373]/12" />
                  <span className="text-[7px] font-black tracking-[0.45em] uppercase text-white/22 whitespace-nowrap">
                    {lang === 'he' ? '▶  ריל קולנועי' : '▶  MOTION REELS'}
                  </span>
                  <div className="h-px flex-1 bg-[#d4a373]/12" />
                </div>
                <div className="flex gap-3 overflow-x-auto pb-3 custom-reel-scroll snap-x snap-mandatory">
                  {SHOWCASE_REELS.map(reel => (
                    <ReelCard key={reel.id} reel={reel} lang={lang} onClick={setSelectedReel} />
                  ))}
                </div>
              </div>

              {/* ── Grid / Filmstrip view switcher ────────────────────────── */}
              <AnimatePresence mode="wait" initial={false}>

                {galleryMode === 'grid' ? (
                  /* ══════════════════ MASONRY EDITORIAL GRID ═══════════════ */
                  <motion.div
                    key="gallery-grid"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="max-h-[560px] overflow-y-auto overflow-x-hidden px-2 custom-gallery-scroll pb-6"
                  >
                    <div className="columns-2 lg:columns-3 [column-gap:1.2rem]">
                      {SHOWCASE_POSTERS.map((poster) => (
                        /* ── Column-flow wrapper: PURE HTML, owns the masonry break.
                           Keeping break-inside-avoid OFF the motion.div stops Framer
                           Motion from snapshotting a collapsed first column child. ── */
                        <div key={poster.id} className="break-inside-avoid mb-4 relative">
                          <motion.div
                            onClick={() => setSelectedPoster(poster)}
                            className="group relative w-full overflow-hidden rounded-[1.8rem] border cursor-pointer transition-colors duration-500"
                            style={{
                              borderColor: poster.type === 'text'
                                ? `${poster.accent}28`
                                : 'rgba(255,255,255,0.09)',
                              boxShadow: '0 8px 32px rgba(0,0,0,0.55)',
                              // WebKit multicol fix: dedicated layer + isolated stacking
                              // context so the rounded/clipped card paints correctly.
                              transform: 'translateZ(0)',
                              isolation: 'isolate',
                            }}
                          >
                            {poster.type === 'comic' && (
                              <div className="absolute top-2 left-2 z-20 bg-[#d4a373]/82 backdrop-blur-sm text-black text-[7px] font-black tracking-[0.15em] uppercase px-2 py-[3px] rounded-full">
                                {lang === 'he' ? 'קומיקס' : 'COMIC'}
                              </div>
                            )}

                            <PosterCardBody poster={poster} lang={lang} />
                          </motion.div>
                        </div>
                      ))}
                    </div>
                  </motion.div>

                ) : (
                  /* ══════════════════ FILMSTRIP TIMELINE MODE ══════════════ */
                  <motion.div
                    key="gallery-filmstrip"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="overflow-x-auto custom-reel-scroll pb-5 -mx-2 px-2"
                  >
                    <div className="flex gap-px min-w-max">
                      {GENRE_GROUPS.map(({ key, labelEn, labelHe, color }) => {
                        const group = SHOWCASE_POSTERS.filter(p => inferPosterGenre(p) === key);
                        if (!group.length) return null;
                        return (
                          <div key={key} className="flex flex-col shrink-0" style={{ scrollSnapAlign: 'start' }}>
                            {/* Sticky-top genre label */}
                            <div className="flex items-center gap-1.5 px-4 pb-3">
                              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                              <span className="text-[7.5px] font-black tracking-[0.28em] uppercase whitespace-nowrap"
                                style={{ color: `${color}bb` }}>
                                {lang === 'he' ? labelHe : labelEn}
                              </span>
                              <span className="w-6 h-px ml-1 shrink-0" style={{ background: `${color}22` }} />
                            </div>

                            {/* Card row */}
                            <div className="flex gap-3 px-3">
                              {group.map(poster => (
                                <motion.div
                                  key={`fs-${poster.id}`}
                                  onClick={() => setSelectedPoster(poster)}
                                  whileHover={{ scale: 1.06, y: -5 }}
                                  transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                                  className={`group relative shrink-0 overflow-hidden rounded-[1.1rem] cursor-pointer ${(poster.type === 'comic' || poster.type === 'text') ? 'aspect-square' : 'aspect-[2/3]'}`}
                                  style={{
                                    width: (poster.type === 'comic' || poster.type === 'text') ? 90 : 76,
                                    border: `1.5px solid ${poster.type === 'text' ? `${poster.accent}30` : 'rgba(255,255,255,0.09)'}`,
                                    boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
                                  }}
                                >
                                  <PosterCardBody poster={poster} lang={lang} compact />
                                </motion.div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </motion.div>
                )}

              </AnimatePresence>
            </motion.section>
          )}
        </AnimatePresence>

        {/* תצוגת התסריט והפוסטר */}
        <AnimatePresence mode="wait">
          {script && !scriptLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="mt-16 md:mt-24"
            >
              <ScriptOutput
                script={script}
                lang={lang}
                genre={selectedGenre}
                setIsTypingGlobal={setIsTyping}
                producerName={producerName}
                onPosterGenerated={(url) => updateEntry(currentEntryIdRef.current, { posterUrl: url })}
                onScriptEdited={(text) => updateEntry(currentEntryIdRef.current, { script: text })}
                onPanelsGenerated={(panels) => updateEntry(currentEntryIdRef.current, { panels })}
                onAuthRequired={openAuthModal}
                initialPanels={initialPanels}
                initialPosterUrl={initialPosterUrl}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Cinematic Lightbox (scale+opacity crossfade + parallax scrub) ─ */}
        <AnimatePresence>
          {selectedPoster && (
            <PosterLightbox
              key={selectedPoster.id}
              poster={selectedPoster}
              onClose={() => setSelectedPoster(null)}
              lang={lang}
            />
          )}
        </AnimatePresence>

        {/* ── Reel Lightbox ────────────────────────────────────────────────── */}
        <AnimatePresence>
          {selectedReel && (
            <motion.div
              key="reel-lightbox-bd"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              onClick={() => setSelectedReel(null)}
              className="fixed inset-0 z-[1100] flex items-center justify-center p-6 bg-black/85 backdrop-blur-md"
            >
              <motion.div
                initial={{ scale: 0.88, y: 30 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.88, y: 30 }}
                transition={{ type: 'spring', stiffness: 340, damping: 28 }}
                onClick={e => e.stopPropagation()}
                className="relative bg-black rounded-3xl overflow-hidden shadow-[0_40px_120px_rgba(0,0,0,0.96)] border border-white/8"
                style={{ width: 'min(300px, 88vw)', aspectRatio: '9/16', maxHeight: '88dvh' }}
              >
                <video
                  src={selectedReel.src}
                  autoPlay
                  playsInline
                  loop
                  controls
                  className="w-full h-full object-cover"
                />
                <button
                  onClick={() => setSelectedReel(null)}
                  className="close-button absolute top-3.5 right-3.5 w-9 h-9 rounded-full flex items-center justify-center bg-black/65 border border-white/15 text-white/60 hover:text-white hover:bg-black/85 transition-all z-10"
                  style={{ backdropFilter: 'blur(6px)' }}
                >
                  <X size={14} />
                </button>
                <div className="absolute top-3.5 left-3.5 z-10 pointer-events-none">
                  <div className="px-2 py-1 rounded-lg text-[6.5px] font-black tracking-[0.14em] uppercase"
                    style={{ background: `${selectedReel.color}28`, color: selectedReel.color, border: `1px solid ${selectedReel.color}50`, backdropFilter: 'blur(4px)' }}>
                    {selectedReel.tagline}
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Director's Log (Feedback Section) */}
        <div className="mt-2 mb-0 w-full max-w-xl mx-auto px-6 relative z-50">
            {/* Plain conditional render — deliberately NO AnimatePresence/motion.
               WebKit (Safari/iOS) jumped the trigger on every framer enter/exit
               (backdrop-filter repaint + transform/opacity transitions). A static
               swap is bulletproof cross-browser; the form keeps a CSS-only fade. */}
            {!showFeedback ? (
              <button
                onClick={() => setShowFeedback(true)}
                className="w-full group relative overflow-hidden rounded-2xl bg-[#0f1117] border border-[#d4a373]/10 hover:border-[#d4a373]/40 transition-colors duration-500 py-6 px-4 text-center cursor-pointer shadow-lg"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#d4a373]/5 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                <div className="flex flex-col items-center justify-center gap-2">
                  <div className="p-2 rounded-full bg-[#d4a373]/10 text-[#d4a373] group-hover:scale-110 transition-transform duration-300">
                    <MessageSquare size={20} />
                  </div>
                  <span className="text-[#d4a373] font-black tracking-[0.2em] text-xs uppercase">
                    {lang === 'he' ? 'יומן הבמאי' : "DIRECTOR'S LOG"}
                  </span>
                  <p className="text-gray-500 text-[10px] font-light tracking-wide">
                    {lang === 'he' ? 'משוב, תמיכה ודיווח תקלות — דברו איתנו' : 'Feedback, support & issues — talk to us'}
                  </p>
                </div>
              </button>
            ) : (
              <div
                className="w-full bg-[#0f1117] border border-[#d4a373]/30 p-8 rounded-3xl shadow-2xl relative overflow-hidden text-right animate-in fade-in zoom-in-95 duration-200"
                dir={lang === 'he' ? 'rtl' : 'ltr'}
              >
                <button 
                  onClick={() => setShowFeedback(false)}
                  className="absolute top-4 right-4 text-white/20 hover:text-[#d4a373] transition-colors p-2"
                >
                  <X size={20} />
                </button>

                <div className="flex items-center gap-3 mb-6 border-b border-[#d4a373]/10 pb-4">
                  <MessageSquare className="text-[#d4a373]" size={18} />
                  <h4 className="text-[#d4a373] font-black text-[10px] tracking-[0.3em] uppercase">
                    {lang === 'he' ? 'דיווח מהסט' : 'SET REPORT'}
                  </h4>
                </div>

                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder={lang === 'he' ? 'שתף אותנו בחוויה שלך, הצעות לשיפור או באגים...' : 'Share your experience, suggestions, or bugs...'}
                  className="w-full bg-black/40 border border-white/5 rounded-2xl p-4 text-sm text-white placeholder-gray-600 focus:border-[#d4a373]/40 outline-none transition-all min-h-[120px] resize-none mb-6"
                />

                {feedbackError && (
                  <p className="text-red-400 text-[11px] text-center mb-3 font-medium">
                    {feedbackError}
                  </p>
                )}

                <button
                  onClick={() => { setFeedbackError(''); handleSendFeedback(); }}
                  disabled={feedbackStatus !== 'idle' || !feedbackText.trim()}
                  className={`w-full py-4 rounded-xl font-black text-xs uppercase tracking-widest transition-all flex items-center justify-center gap-2
                    ${feedbackStatus === 'success' ? 'bg-green-500/20 text-green-400 border border-green-500/30' :
                      feedbackStatus === 'sending' ? 'bg-[#d4a373]/10 text-[#d4a373] animate-pulse' :
                      'bg-[#d4a373] text-black hover:bg-white active:scale-95'}`}
                >
                  {feedbackStatus === 'success' ? (
                    <> <Check size={16} /> {lang === 'he' ? 'תודה רבה!' : 'THANK YOU!'} </>
                  ) : feedbackStatus === 'sending' ? (
                    lang === 'he' ? 'שולח...' : 'SENDING...'
                  ) : (
                    <> <Send size={16} /> {lang === 'he' ? 'שלח משוב' : 'SEND FEEDBACK'} </>
                  )}
                </button>
              </div>
            )}
        </div>
      </main>

      {/* Footer יוקרתי עם חיבור ל-MODAL_DATA */}
      <footer className="py-12 px-6 border-t border-white/5 bg-black/20 backdrop-blur-sm relative z-10">
        <div className="container mx-auto max-w-5xl">
          <div className="flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex flex-col items-center md:items-start">
              <div className="flex items-center gap-2 mb-2 text-[#d4a373]">
                <Film size={16} />
                <span className="font-black tracking-[0.3em] text-[10px] uppercase italic">LIFESCRIPT Studio</span>
              </div>
              <p className="text-gray-600 text-[9px] tracking-widest uppercase">
                &copy; {new Date().getFullYear()} {lang === 'he' ? 'כל הזכויות שמורות' : 'All Rights Reserved'}
              </p>
            </div>

            {/* כפתורי הניווט שמשתמשים ב-MODAL_DATA החדש */}
            <div className="flex flex-wrap justify-center gap-x-8 gap-y-4">
              {['about', 'support', 'terms', 'privacy', 'accessibility'].map((item) => (
                <button
                  key={item}
                  onClick={() => setModalContent(item)}
                  className="text-[9px] font-black text-gray-500 hover:text-[#d4a373] transition-colors uppercase tracking-[0.2em]"
                >
                  {MODAL_DATA[item][lang].title.split(' - ')[0]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </footer>
      
      {/* Cinematic fullscreen loader — script generation */}
      <HistoryPanel
        isOpen={showHistory}
        onClose={() => setShowHistory(false)}
        history={history}
        onReload={(entry) => {
          setScript(entry.script);
          setSelectedGenre(entry.genre);
          setShowGallery(false);
          setError('');
          currentEntryIdRef.current = entry.id;
          setInitialPanels(entry.panels?.length > 0 ? entry.panels : null);
          setInitialPosterUrl(entry.posterUrl || null);
        }}
        onDelete={deleteEntry}
        lang={lang}
      />

      {/* Notice-only cookie banner — links to the Privacy modal */}
      <CookieConsent lang={lang} onPolicyClick={() => setModalContent('privacy')} />

      <Analytics />
    </div>
  );
}

export default HomePage;