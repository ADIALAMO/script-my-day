import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, VolumeX, Share2, Download } from 'lucide-react'; // וודא שאייקונים אלה מיובאים
import * as htmlToImage from 'html-to-image'; // וודא שזה מיובא אם handleCapturePoster מועבר
import { exportCapabilities } from '../utils/export-image.js';

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
  handleCapturePoster,
  prewarmPosterShare,
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
              // Pre-render the share file in the background once the poster is on screen,
              // so a Share tap fires navigator.share() instantly (slow-device activation
              // fix — see prewarmPosterShare). Deferred so it never janks the reveal.
              const prewarm = () => prewarmPosterShare?.();
              if (typeof window !== 'undefined') {
                if (window.requestIdleCallback) window.requestIdleCallback(prewarm, { timeout: 2500 });
                else setTimeout(prewarm, 1200);
              }

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
          <div className="absolute inset-0 flex flex-col items-center justify-between z-20 pointer-events-none p-8 md:p-12">
            {/* גרדיאנטים להגנת קריאות */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/40 -z-10" />
            
            {/* כותרת עליונה */}
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

            {/* קרדיטים תחתונים */}
            <div className="w-full text-center mb-4">
              <p className="text-[#d4a373] font-black uppercase tracking-[0.3em] text-[9px] md:text-[14px] mb-4">
                {credits.comingSoon}
              </p>
              <div className="w-full border-t border-white/20 pt-4 flex flex-col gap-1 font-bold uppercase text-white/90">
                <p className="text-[7px] md:text-[10px] tracking-[0.1em] italic">{credits.line1}</p>
                <p className="text-[6px] md:text-[8px] tracking-[0.1em] opacity-70">{credits.line2}</p>
                <p className="text-[6px] md:text-[8px] tracking-[0.1em] opacity-70 mb-2">{credits.line3}</p>
                <p className="text-[#d4a373]/40 text-[5px] md:text-[7px] tracking-[0.4em] font-black italic">
                  MY-LIFE-SCRIPT.VERCEL.APP
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Share panel — visible immediately after poster generation ── */}
      {!posterLoading && posterUrl && (
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: 'easeOut' }}
          className="mt-7 pb-10 w-full max-w-[420px] mx-auto px-4"
        >
          {/* Label */}
          <p className="text-center text-[#d4a373]/50 text-[9px] font-black tracking-[0.45em] uppercase mb-4">
            {isHebrew ? 'שתף את הסרט שלך' : 'SHARE YOUR FILM'}
          </p>

          {/* Primary action — full-width, large */}
          <motion.button
            type="button"
            whileHover={{ scale: 1.02, boxShadow: '0 12px 40px rgba(212,163,115,0.45)' }}
            whileTap={{ scale: 0.96 }}
            onPointerDown={() => { if (!isDesktop) prewarmPosterShare?.(); }}
            onClick={() => {
              handleCapturePoster(isDesktop ? 'download' : 'share');
              if (typeof window !== 'undefined' && window.gtag) {
                window.gtag('event', 'poster_share_click', {
                  title: posterTitle, genre, method: isDesktop ? 'download' : 'share',
                });
              }
            }}
            className="relative w-full flex items-center justify-center gap-3 h-14 rounded-2xl font-black overflow-hidden"
            style={{
              background: 'linear-gradient(135deg, #d4a373 0%, #e8bc80 48%, #c68b4a 100%)',
              boxShadow: '0 8px 32px rgba(212,163,115,0.32), 0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            <motion.span
              className="pointer-events-none absolute inset-0"
              animate={{ backgroundPosition: ['200% center', '-200% center'] }}
              transition={{ repeat: Infinity, duration: 3.5, ease: 'linear' }}
              style={{
                background: 'linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.18) 50%, transparent 70%)',
                backgroundSize: '200% 100%',
              }}
            />
            {isDesktop ? <Download size={18} strokeWidth={2.5} className="text-[#0b0b0f]" /> : <Share2 size={18} strokeWidth={2.5} className="text-[#0b0b0f]" />}
            <span className="relative text-[#0b0b0f] text-[12px] tracking-[0.22em] uppercase">
              {isDesktop
                ? (isHebrew ? 'הורד פוסטר' : 'DOWNLOAD POSTER')
                : (isHebrew ? 'שמור ושתף' : 'SAVE & SHARE')}
            </span>
          </motion.button>

          {/* Platform row */}
          <div className="mt-4 flex items-center justify-center gap-3">
            {/* WhatsApp — direct link on desktop, native sheet on mobile */}
            {isDesktop ? (
              <a
                href={`https://wa.me/?text=${encodeURIComponent((isHebrew ? 'נוצר ב-LIFESCRIPT 🎬' : 'Made with LIFESCRIPT 🎬') + '\nmy-life-script.vercel.app')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col items-center gap-1.5 group"
              >
                <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center group-hover:border-[#25d366]/40 group-hover:bg-[#25d366]/10 transition-all duration-200">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#25d366]/60 group-hover:fill-[#25d366] transition-colors duration-200"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.122.555 4.11 1.523 5.836L.057 23.882l6.196-1.623A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.006-1.371l-.359-.214-3.717.975.993-3.63-.234-.373A9.818 9.818 0 0 1 2.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/></svg>
                </span>
                <span className="text-[8px] text-white/30 group-hover:text-white/55 font-bold tracking-wide transition-colors duration-200">WhatsApp</span>
              </a>
            ) : (
              <button onClick={() => handleCapturePoster('share')} onPointerDown={() => prewarmPosterShare?.()} className="flex flex-col items-center gap-1.5 group">
                <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center group-active:bg-[#25d366]/10 transition-all duration-200">
                  <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#25d366]/60"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.122.555 4.11 1.523 5.836L.057 23.882l6.196-1.623A11.954 11.954 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.818 9.818 0 0 1-5.006-1.371l-.359-.214-3.717.975.993-3.63-.234-.373A9.818 9.818 0 0 1 2.182 12C2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/></svg>
                </span>
                <span className="text-[8px] text-white/30 font-bold tracking-wide">WhatsApp</span>
              </button>
            )}

            {/* Instagram */}
            <button
              onClick={() => handleCapturePoster('share')}
              onPointerDown={() => { if (!isDesktop) prewarmPosterShare?.(); }}
              className="flex flex-col items-center gap-1.5 group"
            >
              <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center group-hover:border-[#e1306c]/40 group-hover:bg-[#e1306c]/10 group-active:bg-[#e1306c]/10 transition-all duration-200">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-[#e1306c]/60 group-hover:fill-[#e1306c] transition-colors duration-200"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881z"/></svg>
              </span>
              <span className="text-[8px] text-white/30 group-hover:text-white/55 font-bold tracking-wide transition-colors duration-200">Instagram</span>
            </button>

            {/* TikTok */}
            <button
              onClick={() => handleCapturePoster('share')}
              onPointerDown={() => { if (!isDesktop) prewarmPosterShare?.(); }}
              className="flex flex-col items-center gap-1.5 group"
            >
              <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center group-hover:border-white/25 group-hover:bg-white/10 group-active:bg-white/10 transition-all duration-200">
                <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white/50 group-hover:fill-white/80 transition-colors duration-200"><path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1V9.01a6.33 6.33 0 0 0-.79-.05 6.34 6.34 0 0 0-6.34 6.34 6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.33-6.34V8.69a8.18 8.18 0 0 0 4.78 1.52V6.78a4.85 4.85 0 0 1-1.01-.09z"/></svg>
              </span>
              <span className="text-[8px] text-white/30 group-hover:text-white/55 font-bold tracking-wide transition-colors duration-200">TikTok</span>
            </button>

            {/* Desktop-only: secondary share button */}
            {isDesktop && (
              <button
                onClick={() => handleCapturePoster('share')}
                className="flex flex-col items-center gap-1.5 group"
              >
                <span className="w-10 h-10 rounded-xl bg-white/[0.05] border border-white/[0.08] flex items-center justify-center group-hover:border-[#d4a373]/40 group-hover:bg-[#d4a373]/10 transition-all duration-200">
                  <Share2 size={18} className="text-[#d4a373]/55 group-hover:text-[#d4a373] transition-colors duration-200" />
                </span>
                <span className="text-[8px] text-white/30 group-hover:text-white/55 font-bold tracking-wide transition-colors duration-200">
                  {isHebrew ? 'שתף' : 'Share'}
                </span>
              </button>
            )}
          </div>

          {/* Helper text */}
          <p className="mt-4 text-center text-white/22 text-[9px] leading-relaxed">
            {isDesktop
              ? (isHebrew
                ? 'הורד לשמירה · לחץ "שתף" לשליחה ישירה לרשתות'
                : 'Download to save · tap Share to post directly to your networks')
              : (isHebrew
                ? 'שמור לגלריה או שתף ישירות לאינסטגרם, וואטסאפ, טיקטוק'
                : 'Save to gallery or share directly to Instagram, WhatsApp, TikTok')}
          </p>
        </motion.div>
      )}
    </motion.div>
  );
};

export default PosterRenderer;