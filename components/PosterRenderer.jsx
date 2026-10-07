import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, VolumeX, Share2, Download, X } from 'lucide-react'; // וודא שאייקונים אלה מיובאים
import * as htmlToImage from 'html-to-image'; // וודא שזה מיובא אם handleCapturePoster מועבר
import { exportCapabilities } from '../utils/export-image.js';
import { isCapacitorNative } from '../utils/platform.js';

function PosterRenderer({
  posterUrl,
  posterLoading,
  posterError,
  setPosterError,
  setPosterUrl,
  triggerFlash,
  posterRef,
  posterTitle,
  credits,
  identityNotice,
  handleCapturePoster,
  prewarmPosterShare,
  isPreparingShare,
  onRetryGenerate,
  lang,
  genre,
  posterLoadingMessages,
  setTriggerFlash,
  setPosterLoading,
  playFlashSound,
}) {
  const isHebrew = lang === 'he'; // Assuming lang is passed correctly

  // Desktop ⇒ download is the primary action (clean blob download, no SPA navigation);
  // mobile ⇒ share only (the native sheet's "Save Image" is the download). Detected after
  // mount to avoid an SSR/hydration mismatch — defaults to the mobile/share affordance.
  const [isDesktop, setIsDesktop] = React.useState(false);
  React.useEffect(() => {
    setIsDesktop(exportCapabilities().isDesktop);
  }, []);

  // Dismissible, not tied to posterError — a degraded (faceless) poster is still a
  // SUCCESS, so this must never block or hide the result above it. Re-arms whenever
  // a new notice comes in (e.g. a different generation also degrades).
  const [identityNoticeDismissed, setIdentityNoticeDismissed] = React.useState(false);
  React.useEffect(() => { setIdentityNoticeDismissed(false); }, [identityNotice]);

  return (
    <motion.div 
      initial={{ opacity: 0, y: 50 }} 
      animate={{ opacity: 1, y: 0 }} 
      className="relative max-w-2xl mx-auto w-full pb-2 px-4 z-10"
    >
      <div ref={posterRef} className="relative aspect-[2/3] w-full max-w-[450px] mx-auto rounded-[3.5rem] md:rounded-[4.5rem] overflow-hidden bg-[#030712] shadow-4xl border border-[#d4a373]/30">
        {posterUrl && (
          <img
            src={posterUrl.startsWith('http') ? `/api/proxy-image?url=${encodeURIComponent(posterUrl)}` : posterUrl}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-700 ${posterLoading ? 'opacity-0' : 'opacity-100'}`}
            onLoad={() => {
              if (typeof window !== 'undefined' && window.gtag) {
                window.gtag('event', 'poster_rendered_visually', { genre: genre });
              }

              // History restores arrive as http URLs (proxied CDN).
              // Fresh generations are always data URIs.  Skip all cinematic
              // fanfare on history loads — just reveal the image silently.
              // Start share prewarm immediately on load. The old implementation used
              // html-to-image (heavy canvas render — deferred to avoid jank). The new
              // implementation is a plain fetch + watermark: non-blocking, ~200-500 ms
              // on a fast device — safe to call straight from onLoad there, maximising
              // the head-start before the user can tap any share button or chip.
              //
              // NOT on native (TEMP, pending confirmation — share-bug investigation):
              // this unconditionally runs a full-resolution canvas composite
              // (compositeWatermark) for EVERY poster shown, whether or not the user
              // ever shares — on iOS Safari that's the point (navigator.share needs the
              // file ready inside its transient-activation window, which this onLoad
              // call is racing to beat). Native Android doesn't use navigator.share at
              // all (see utils/export-image.js's Capacitor branch) and has no equivalent
              // activation-window constraint, so there's no upside to paying this cost
              // for every poster there — onPointerDown below already prewarms right
              // before an actual share tap, which is the only case that needs it.
              if (!isCapacitorNative()) prewarmPosterShare?.();

              if (posterUrl.startsWith('http')) {
                setPosterLoading(false);
                return;
              }

              // Fresh generation: play the cinematic flash reveal.
              playFlashSound();
              setTimeout(() => {
                window.requestAnimationFrame(() => {
                  setTriggerFlash(true);
                  setPosterLoading(false);
                  setTimeout(() => setTriggerFlash(false), 500);
                });
              }, 50);
            }}
            onError={() => setPosterLoading(false)}
            alt="Movie Poster"
          />
        )}

        {/* 2. אפקט הפלאש הלבן (Z-INDEX 100) */}
        <AnimatePresence>
          {triggerFlash && (
            <motion.div 
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.8 }}
              className="absolute inset-0 bg-white z-[100] pointer-events-none"
            />
          )}
        </AnimatePresence>
        
        {/* 3. שכבת סטטוס (טעינה או שגיאה) */}
        {(posterLoading || posterError) && !posterUrl && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#030712] z-[50] px-6 text-center">
            {!posterError ? (
              /* מצב טעינה רגיל */
              <>
                <div className="relative w-20 h-20 mb-10">
                  <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 4, ease: "linear" }} className="absolute inset-0 border-[3px] border-dashed border-[#d4a373]/30 rounded-full" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    {[0, 60, 120, 180, 240, 300].map((deg, i) => (
                      <motion.div key={i} style={{ rotate: deg, position: 'absolute' }} className="w-full h-full flex items-start justify-center p-1">
                        <motion.div animate={{ opacity: [0.2, 1, 0.2], height: ["10%", "30%", "10%"] }} transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }} className="w-[3px] bg-[#d4a373] rounded-full" />
                      </motion.div>
                    ))}
                  </div>
                </div>
                <div className="h-6">
                  <AnimatePresence mode="wait">
                    <motion.p key={posterLoadingMessages} initial={{ y: 15, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -15, opacity: 0 }} className="text-[#d4a373] text-[10px] font-black uppercase tracking-[0.4em] whitespace-nowrap">
                      {posterLoadingMessages}
                    </motion.p>
                  </AnimatePresence>
                </div>
              </>
            ) : (
              /* מצב שגיאה / מכסה הסתיימה */
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center">
                <div className="w-16 h-16 mb-6 flex items-center justify-center rounded-full bg-[#d4a373]/5 border border-[#d4a373]/20">
                  <VolumeX className="w-8 h-8 text-[#d4a373]/40" />
                </div>
                <h3 className="text-[#d4a373] font-black text-[12px] mb-3 uppercase tracking-[0.2em] italic">
                  {isHebrew ? 'ההקרנה הופסקה' : 'SCREENING PAUSED'}
                </h3>
                <p className="text-white/50 text-[11px] mb-8 leading-relaxed max-w-[240px] font-medium italic">
                  {posterError}
                </p>
                <button 
                  onClick={() => {
                   if (typeof window !== 'undefined' && window.gtag) {
                     window.gtag('event', 'poster_retry_click', { genre: genre });
                   }
                   onRetryGenerate?.();
                   }}
                    className="group relative px-8 py-3 overflow-hidden rounded-full transition-all duration-300 active:scale-95"
                >
                  <div className="absolute inset-0 bg-[#d4a373]/10 border border-[#d4a373]/30 rounded-full group-hover:bg-[#d4a373] transition-colors duration-300" />
                  <span className="relative text-[#d4a373] group-hover:text-black font-black text-[10px] uppercase tracking-widest transition-colors duration-300">
                    {isHebrew ? 'נסה שוב' : 'RETRY'}
                  </span>
                </button>
              </motion.div>
            )}
          </div>
        )}

        {/* 4. שכבת הטיפוגרפיה (Overlay) - רק כשיש תמונה */}
        {!posterLoading && posterUrl && !posterError && (
          <>
            {/* כותרת עליונה — unchanged, still floats over the artwork with a
                readability scrim. Credits moved OUT of this padded overlay into
                their own flush dark band below, so they stop competing with the
                image instead of just fading over it. */}
            <div className="absolute inset-0 flex flex-col items-center z-20 pointer-events-none p-8 md:p-12">
              {/* Dark band below now handles the bottom edge on its own —
                  this scrim only needs to protect the TITLE at the top. */}
              <div className="absolute inset-0 bg-gradient-to-b from-black/55 via-transparent to-transparent -z-10" />
              <div className="w-full text-center mt-4">
                <h1
                  className="text-white font-black uppercase italic drop-shadow-[0_10px_30px_rgba(0,0,0,1)]"
                  style={{
                    fontSize: 'clamp(1.1rem, 5vw, 2.5rem)',
                    lineHeight: '1.1',
                    maxWidth: '90%',
                    margin: '0 auto'
                  }}
                >
                  {posterTitle}
                </h1>
                <div className="h-[1px] w-1/3 mx-auto mt-4 bg-gradient-to-r from-transparent via-[#d4a373]/50 to-transparent" />
              </div>
            </div>

            {/* קרדיטים — compressed to two short lines, inside a SOLID dark band flush
                against the bottom edge (not a gradient fade over the art). The image
                itself is untouched (object-cover fills the same fixed aspect-ratio
                container); the band sits on top of its bottom edge, same as the old
                gradient did, it just no longer lets the artwork show through. */}
            <div className="absolute bottom-0 left-0 right-0 z-20 bg-[#030712] px-4 py-2.5 text-center pointer-events-none">
              <p className="text-[#d4a373] font-black uppercase tracking-[0.18em] text-[8px] md:text-[11px] leading-tight truncate">
                {credits.comingSoon}
              </p>
              <p className="text-white/65 font-bold uppercase tracking-[0.04em] text-[6.5px] md:text-[9px] leading-tight mt-0.5 truncate">
                {credits.line1}
              </p>
            </div>
          </>
        )}
      </div>

      {/* ── Identity-degraded notice — non-blocking, dismissible. The poster above is a
          real success; this only explains why it came out without the user's face. ── */}
      {identityNotice && !identityNoticeDismissed && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="flex items-start gap-2.5 mt-4 mx-auto max-w-[380px] px-4 py-3 rounded-2xl bg-[#d4a373]/[0.07] border border-[#d4a373]/25 text-[11px] leading-snug text-white/75"
        >
          <span className="flex-1">{identityNotice}</span>
          <button
            type="button"
            onClick={() => setIdentityNoticeDismissed(true)}
            aria-label={isHebrew ? 'סגור' : 'Dismiss'}
            className="close-button relative shrink-0 text-white/40 hover:text-white transition-colors"
          >
            <X size={14} />
          </button>
        </motion.div>
      )}

      {/* פעולת הייצוא — דסקטופ: הורדה ראשית + שיתוף משני · מובייל: שיתוף נייטיב בלבד */}
      {!posterLoading && posterUrl && (
        <motion.div
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-4 mt-8 pb-10 w-full max-w-[380px] mx-auto px-4"
        >
          {/* Primary action + secondary share (existing buttons) */}
          <div className="flex items-center justify-center gap-2.5 w-full">
          {/* "Preparing..." shows only once the click handler is actually waiting on a
              not-yet-ready file (handleCapturePoster decides this, not this component) —
              never tied to onPointerDown's prewarm start. aria-disabled + pointer-events
              (not the `disabled` attribute) because they only take effect once this
              render happens AFTER the click was already received; `disabled` applied
              between pointerdown and pointerup would make the browser swallow the click
              outright — the first tap would never share at all. */}
          {(() => { const showPreparing = isCapacitorNative() && isPreparingShare; return (
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.95 }}
            onPointerDown={() => { if (!isDesktop) prewarmPosterShare?.(); }}
            onClick={() => {
                // דסקטופ → הורדה · מובייל → שיתוף נייטיב
                handleCapturePoster(isDesktop ? 'download' : 'share');
                // מדידת לחיצה על הפעולה הראשית
                if (typeof window !== 'undefined' && window.gtag) {
                  window.gtag('event', 'poster_share_click', {
                    title: posterTitle,
                    genre: genre,
                    method: isDesktop ? 'download' : 'share',
                  });
                }
              }}
            aria-disabled={showPreparing}
            style={showPreparing ? { pointerEvents: 'none' } : undefined}
            className="relative flex-1 flex items-center justify-center gap-2.5 h-12 bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black rounded-xl font-black transition-all duration-300 overflow-hidden shadow-[0_8px_28px_rgba(212,163,115,0.3)]"
          >
            {/* אפקט הברק (Shiny Sweep) — animates `x` (transform: translateX), NOT `left`.
                `left` forces a layout recalculation every frame (not GPU-composited);
                `x` on a motion.div is a pure transform, composited on the GPU. The
                element is now full-width so a -100%→100% translateX (relative to its
                OWN width, same as `left`'s relative-to-container used to be) sweeps
                it exactly off-screen-left to off-screen-right, same visual result,
                independent of the button's actual width (varies with HE/EN label
                length) — no magic-number pixel offsets needed. This ran continuously,
                forever, on the whole poster-result screen — a real, if modest,
                perf cost on weak devices even when the user never shares. */}
            <motion.div animate={{ x: ['-100%', '100%'] }} transition={{ repeat: Infinity, duration: 3, ease: "linear" }} className="absolute top-0 bottom-0 left-0 w-full bg-gradient-to-r from-transparent via-white/20 to-transparent skew-x-[35deg]" />
            {showPreparing ? (
              <>
                <Loader2 size={16} strokeWidth={2.5} className="animate-spin" />
                <span className="text-[11px] tracking-[0.2em] uppercase">
                  {isHebrew ? 'מכין...' : 'PREPARING...'}
                </span>
              </>
            ) : (
              <>
                {isDesktop ? <Download size={16} strokeWidth={2.5} /> : <Share2 size={16} strokeWidth={2.5} />}
                <span className="text-[11px] tracking-[0.2em] uppercase">
                  {isDesktop
                    ? (isHebrew ? 'הורד פוסטר' : 'DOWNLOAD POSTER')
                    : (isHebrew ? 'שתף פוסטר' : 'SHARE POSTER')}
                </span>
              </>
            )}
          </motion.button>
          ); })()}

          {/* שיתוף משני — דסקטופ בלבד (העתקה/שיתוף ישיר לרשתות) */}
          {isDesktop && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => handleCapturePoster('share')}
              aria-label={isHebrew ? 'שתף פוסטר' : 'Share poster'}
              className="flex items-center justify-center gap-2 h-12 px-4 bg-[#d4a373]/10 border border-[#d4a373]/30 text-[#d4a373] rounded-xl font-black hover:bg-[#d4a373]/18 hover:border-[#d4a373]/50 transition-all duration-300"
            >
              <Share2 size={16} strokeWidth={2.5} />
              <span className="text-[11px] tracking-[0.2em] uppercase">{isHebrew ? 'שתף' : 'SHARE'}</span>
            </motion.button>
          )}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
};

export default PosterRenderer;