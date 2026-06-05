import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Check, X, Clapperboard, Film, Loader2, ChevronDown, Download, Share2, Lock, Crown } from 'lucide-react';
import { exportImageBlob } from '../utils/export-image.js';

export default function StoryboardView({ panels, lang, panelImages, onClose, unlockedPanels = Infinity, onUpgrade }) {
  const isHebrew = lang === 'he';
  const [copiedIndex, setCopiedIndex] = useState(null);
  const [allCopied, setAllCopied] = useState(false);
  const [expandedPrompts, setExpandedPrompts] = useState({});

  const togglePrompt = (idx) => setExpandedPrompts(prev => ({ ...prev, [idx]: !prev[idx] }));

  const copyPanel = (idx, text) => {
    navigator.clipboard?.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 1800);
  };

  const copyAll = () => {
    const sep = '\n\n' + '━'.repeat(40) + '\n\n';
    // Skip locked panels — they have no visual prompt to copy.
    const visiblePanels = panels.filter(p => !p.isLocked && p.visual);
    const allText = visiblePanels.map(p =>
      `PANEL ${String(p.panel).padStart(2, '0')} — ${p.scene}\n\nVISUAL PROMPT:\n${p.visual}\n\n${isHebrew ? 'דיאלוג' : 'DIALOGUE'}:\n${p.dialogue || '—'}`
    ).join(sep);
    navigator.clipboard?.writeText(allText);
    setAllCopied(true);
    setTimeout(() => setAllCopied(false), 2000);
  };

  const fetchImageBlob = async (url) => {
    try {
      const resp = await fetch(url);
      if (!resp.ok) throw new Error('direct fetch failed');
      return await resp.blob();
    } catch {
      // Cross-origin or CORS blocked — fall back to server proxy
      const resp = await fetch(`/api/proxy-image?url=${encodeURIComponent(url)}`);
      if (!resp.ok) throw new Error('proxy fetch failed');
      return await resp.blob();
    }
  };

  // Both actions go through the shared exporter: mobile uses the Web Share API
  // ("Save Image"), desktop anchor-downloads — and neither navigates the page, which
  // is what previously refreshed the SPA and wiped the user's state on iOS.
  const downloadFrame = async (url, panelNum) => {
    if (!url) return;
    const filename = `panel-${String(panelNum).padStart(2, '0')}.png`;
    try {
      const blob = await fetchImageBlob(url);
      await exportImageBlob(blob, filename, { action: 'download', title: `Panel ${panelNum}` });
    } catch {
      window.open(url, '_blank');
    }
  };

  const shareFrame = async (url, panelNum) => {
    if (!url) return;
    const filename = `panel-${String(panelNum).padStart(2, '0')}.png`;
    try {
      const blob = await fetchImageBlob(url);
      await exportImageBlob(blob, filename, { action: 'share', title: `Panel ${panelNum}` });
    } catch {
      window.open(url, '_blank');
    }
  };

  const getImageState = (idx) => {
    const s = panelImages?.[idx];
    if (!s) return 'pending';
    if (s.loading) return 'loading';
    if (s.url) return 'loaded';
    if (s.error) return 'error';
    return 'pending';
  };

  const lockedCount = Math.max(0, panels.length - unlockedPanels);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 16 }}
      transition={{ duration: 0.55, ease: 'easeOut' }}
      className="mx-2 md:mx-4 mt-6 bg-[#030712]/90 border border-white/5 rounded-[2.5rem] [overflow:clip]"
    >
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-7 py-5 border-b border-[#d4a373]/10" dir={isHebrew ? 'rtl' : 'ltr'}>
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-[#d4a373]/10 shrink-0">
            <Clapperboard size={14} className="text-[#d4a373]" />
          </div>
          <div>
            <h3 className="text-[#d4a373] font-black uppercase text-[10px] tracking-[0.35em]">
              {isHebrew ? 'סטוריבורד קולנועי' : 'COMIC STORYBOARD'}
            </h3>
            <p className="text-gray-600 text-[9px] tracking-widest mt-0.5 uppercase">
              {isHebrew ? `${panels.length} פאנלים • נוצר עם AI` : `${panels.length} PANELS • AI GENERATED`}
            </p>
          </div>
        </div>
        <button onClick={onClose} className="p-2 rounded-xl text-white/20 hover:text-[#d4a373] hover:bg-[#d4a373]/8 transition-all duration-200 shrink-0">
          <X size={15} />
        </button>
      </div>

      {/* ── Panel Grid ─────────────────────────────────────────── */}
      <div className="p-5 md:p-7">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
          {panels.map((panel, idx) => {
            // panel.isLocked is the canonical signal set by the backend.
          // The idx >= unlockedPanels check is retained as a defence-in-depth fallback.
          const isLocked = panel.isLocked === true || idx >= unlockedPanels;

            /* ── Locked Panel Card ─────────────────────────────── */
            if (isLocked) {
              return (
                <motion.div
                  key={idx}
                  initial={{ opacity: 0, y: 16, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ delay: idx * 0.06, duration: 0.4, ease: 'easeOut' }}
                  onClick={onUpgrade}
                  className="group bg-[#050710] border border-amber-500/10 rounded-[1.75rem] overflow-hidden hover:border-amber-500/30 hover:shadow-[0_8px_40px_rgba(245,158,11,0.09)] transition-all duration-400 cursor-pointer"
                >
                  {/* Image zone */}
                  <div className="relative aspect-[3/2] overflow-hidden bg-[#030409]">
                    {/* Atmospheric gradient — suggests cinematic depth */}
                    <div className="absolute inset-0 bg-gradient-to-br from-[#120a1e] via-[#040208] to-[#1a1008] pointer-events-none" />
                    {/* Subtle diagonal texture */}
                    <div
                      className="absolute inset-0 opacity-[0.025] pointer-events-none"
                      style={{ backgroundImage: 'repeating-linear-gradient(45deg,#fff 0px,#fff 1px,transparent 1px,transparent 9px)' }}
                    />
                    {/* Amber radial glow — intensifies on hover */}
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.07)_0%,transparent_65%)] group-hover:bg-[radial-gradient(ellipse_at_center,rgba(245,158,11,0.13)_0%,transparent_65%)] transition-all duration-400 pointer-events-none" />

                    {/* Panel badge */}
                    <div className="absolute top-3 left-3 z-20 px-2.5 py-1 bg-black/70 backdrop-blur-sm border border-amber-500/12 rounded-lg" dir="ltr">
                      <span className="text-amber-500/38 font-black text-[9px] tracking-[0.35em] uppercase">
                        {`PANEL ${String(panel.panel).padStart(2, '0')}`}
                      </span>
                    </div>

                    {/* Scene badge — blurred to hint without revealing */}
                    <div className="absolute top-3 right-3 z-20 max-w-[52%] px-2 py-1 bg-black/40 backdrop-blur-sm rounded-lg">
                      <span className="text-white/15 text-[8px] font-mono tracking-wide truncate block blur-[3px] select-none" dir="ltr">
                        {panel.scene}
                      </span>
                    </div>

                    {/* Lock CTA — centered */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center z-10 gap-2.5 px-4">
                      <div className="w-11 h-11 rounded-xl bg-amber-500/10 border border-amber-500/22 flex items-center justify-center shadow-[0_0_20px_rgba(245,158,11,0.13)] group-hover:shadow-[0_0_30px_rgba(245,158,11,0.24)] group-hover:bg-amber-500/16 transition-all duration-350">
                        <Lock size={19} className="text-amber-400/65 group-hover:text-amber-400 transition-colors duration-250" />
                      </div>
                      <p className="text-amber-400/55 font-black text-[8.5px] tracking-[0.32em] uppercase group-hover:text-amber-400/90 transition-colors duration-250">
                        {isHebrew ? 'פרו בלבד' : 'Pro Only'}
                      </p>
                    </div>
                  </div>

                  {/* Content zone — blurred dialogue teaser */}
                  <div className="p-4 space-y-2.5">
                    {panel.dialogue && (
                      <p
                        className="text-white/10 text-[13.5px] italic leading-relaxed blur-[4px] select-none pointer-events-none"
                        dir={isHebrew ? 'rtl' : 'ltr'}
                      >
                        &ldquo;{panel.dialogue}&rdquo;
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 text-amber-500/32 group-hover:text-amber-500/65 transition-colors duration-250">
                      <Lock size={8} />
                      <span className="text-[7.5px] font-black uppercase tracking-widest">
                        {isHebrew ? 'שדרג לצפייה' : 'Upgrade to view'}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            }

            /* ── Normal (Unlocked) Panel Card ──────────────────── */
            const imgState = getImageState(idx);
            const imgUrl = panelImages?.[idx]?.url;
            const isExpanded = !!expandedPrompts[idx];

            return (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: idx * 0.06, duration: 0.4, ease: 'easeOut' }}
                className="group bg-[#050710] border border-[#d4a373]/12 rounded-[1.75rem] overflow-hidden hover:border-[#d4a373]/30 hover:shadow-[0_8px_40px_rgba(212,163,115,0.08)] transition-all duration-400"
              >
                {/* ── Image zone ──────────────────────────────── */}
                <div className="relative aspect-[3/2] overflow-hidden bg-[#02040a]">
                  <AnimatePresence>
                    {(imgState === 'loading' || imgState === 'pending') && (
                      <motion.div
                        key="skeleton"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.3 }}
                        className="absolute inset-0 bg-[#030611] flex flex-col items-center justify-center gap-2.5 overflow-hidden"
                      >
                        {/* Shimmer sweep */}
                        <motion.div
                          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.035] to-transparent skew-x-12 pointer-events-none"
                          animate={{ x: ['-150%', '220%'] }}
                          transition={{ repeat: Infinity, duration: 2.4, ease: 'linear' }}
                        />
                        <Loader2 size={22} className="text-[#d4a373]/30 animate-spin relative z-10" />
                        <span className="text-[#d4a373]/22 text-[9px] font-black tracking-[0.35em] uppercase relative z-10">
                          {imgState === 'pending'
                            ? (isHebrew ? 'ממתין בתור...' : 'In queue...')
                            : (isHebrew ? 'מפתח פריים...' : 'Developing frame...')}
                        </span>
                      </motion.div>
                    )}

                    {imgState === 'loaded' && imgUrl && (
                      <motion.div
                        key="img-wrapper"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ duration: 0.65, ease: 'easeOut' }}
                        className="absolute inset-0"
                      >
                        <img
                          src={imgUrl}
                          alt={`Panel ${panel.panel}`}
                          className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                        />
                      </motion.div>
                    )}

                    {imgState === 'error' && (
                      <motion.div
                        key="error-state"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        className="absolute inset-0 flex items-center justify-center bg-[#06040a]"
                      >
                        <div className="flex flex-col items-center gap-2 opacity-35">
                          <X size={22} className="text-red-400" />
                          <span className="text-red-300/70 text-[9px] font-mono uppercase tracking-widest">
                            {isHebrew ? 'שגיאת פריים' : 'Frame Lost'}
                          </span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Cinematic gradient overlay on loaded images */}
                  {imgState === 'loaded' && (
                    <div className="absolute inset-0 bg-gradient-to-t from-[#050710]/85 via-transparent to-black/15 pointer-events-none z-10" />
                  )}

                  {/* Save & Share action bar */}
                  {imgState === 'loaded' && imgUrl && (
                    <div className="absolute bottom-0 inset-x-0 z-20 flex items-center justify-center gap-2 p-3 translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out">
                      <button type="button" onClick={() => downloadFrame(imgUrl, panel.panel)} className="flex items-center gap-1.5 px-3 py-1.5 bg-black/75 backdrop-blur-sm border border-white/20 rounded-xl text-[9px] font-black uppercase tracking-widest text-white/80 hover:text-white hover:border-[#d4a373]/50 hover:bg-black/90 transition-all duration-200">
                        <Download size={10} />
                        <span>{isHebrew ? 'הורד' : 'Download'}</span>
                      </button>
                      <button type="button" onClick={() => shareFrame(imgUrl, panel.panel)} className="flex items-center gap-1.5 px-3 py-1.5 bg-black/75 backdrop-blur-sm border border-white/20 rounded-xl text-[9px] font-black uppercase tracking-widest text-white/80 hover:text-white hover:border-[#d4a373]/50 hover:bg-black/90 transition-all duration-200">
                        <Share2 size={10} />
                        <span>{isHebrew ? 'שתף' : 'Share'}</span>
                      </button>
                    </div>
                  )}

                  {/* PANEL badge — always LTR regardless of lang */}
                  <div className="absolute top-3 left-3 z-20 px-2.5 py-1 bg-black/75 backdrop-blur-sm border border-[#d4a373]/30 rounded-lg" dir="ltr">
                    <span className="text-[#d4a373] font-black text-[9px] tracking-[0.35em] uppercase">
                      {`PANEL ${String(panel.panel).padStart(2, '0')}`}
                    </span>
                  </div>

                  {/* Scene badge — top right, always LTR for film notation */}
                  <div className="absolute top-3 right-3 z-20 max-w-[52%] px-2 py-1 bg-black/60 backdrop-blur-sm rounded-lg">
                    <span className="text-white/45 text-[8px] font-mono tracking-wide truncate block" dir="ltr">
                      {panel.scene}
                    </span>
                  </div>
                </div>

                {/* ── Content zone ─────────────────────────────── */}
                <div className="p-4 space-y-3">

                  {/* Dialogue / Caption */}
                  {panel.dialogue && (
                    <p className="text-white/82 text-[13.5px] italic leading-relaxed" dir={isHebrew ? 'rtl' : 'ltr'}>
                      &ldquo;{panel.dialogue}&rdquo;
                    </p>
                  )}

                  {/* Visual prompt toggle — only rendered for unlocked panels that have a prompt */}
                  {panel.visual && (
                    <>
                      <button
                        onClick={() => togglePrompt(idx)}
                        className="flex items-center gap-1.5 text-[8.5px] font-black uppercase tracking-widest text-gray-600 hover:text-[#d4a373] transition-colors duration-200"
                        dir="ltr"
                      >
                        <ChevronDown size={10} className={`transition-transform duration-250 ${isExpanded ? 'rotate-180' : ''}`} />
                        <span>{isHebrew ? 'פרומפט ויזואלי' : 'VISUAL PROMPT'}</span>
                      </button>

                      {/* Expandable visual prompt */}
                      <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? 'max-h-64' : 'max-h-0'}`}>
                        <div className="bg-black/40 rounded-xl p-3 border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-[#d4a373]/38 text-[7.5px] font-black tracking-widest uppercase" dir="ltr">
                              {isHebrew ? 'מותאם ל-Midjourney / Flux' : 'MIDJOURNEY / FLUX READY'}
                            </span>
                            <button
                              onClick={() => copyPanel(idx, panel.visual)}
                              className="flex items-center gap-1 text-[7.5px] font-bold text-gray-600 hover:text-[#d4a373] transition-colors duration-200"
                            >
                              {copiedIndex === idx ? (
                                <><Check size={8} className="text-green-400" /><span className="text-green-400">{isHebrew ? 'הועתק' : 'Copied'}</span></>
                              ) : (
                                <><Copy size={8} /><span>{isHebrew ? 'העתק' : 'Copy'}</span></>
                              )}
                            </button>
                          </div>
                          <p className="text-gray-400 text-[10.5px] leading-[1.75] font-mono" dir="ltr">
                            {panel.visual}
                          </p>
                        </div>
                      </div>
                    </>
                  )}

                </div>
              </motion.div>
            );
          })}
        </div>

        {/* ── Upgrade CTA banner — shown when locked panels exist ── */}
        {lockedCount > 0 && onUpgrade && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, ease: 'easeOut', delay: 0.25 }}
            onClick={onUpgrade}
            className="mt-5 relative overflow-hidden rounded-[1.75rem] border border-amber-500/18 bg-[#06050e] cursor-pointer group hover:border-amber-500/38 transition-all duration-400"
          >
            {/* Amber hairline accent */}
            <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-amber-400/38 to-transparent" />
            {/* Sweep shimmer */}
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-amber-500/[0.035] to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-[1200ms] pointer-events-none" />

            <div
              className="flex flex-col sm:flex-row items-center gap-4 px-6 py-5"
              dir={isHebrew ? 'rtl' : 'ltr'}
            >
              {/* Crown icon */}
              <div className="shrink-0 w-12 h-12 rounded-xl bg-amber-500/10 border border-amber-500/22 flex items-center justify-center shadow-[0_0_22px_rgba(245,158,11,0.15)] group-hover:shadow-[0_0_32px_rgba(245,158,11,0.25)] transition-all duration-350">
                <Crown size={22} className="text-amber-400" />
              </div>

              {/* Copy */}
              <div className={`flex-1 min-w-0 ${isHebrew ? 'text-right' : 'text-left'}`}>
                <p className="text-white font-black text-[14px] leading-snug mb-0.5">
                  {isHebrew
                    ? `עוד ${lockedCount} פאנלים ממתינים לך`
                    : `${lockedCount} more panel${lockedCount > 1 ? 's' : ''} await`}
                </p>
                <p className="text-white/35 text-[11.5px] leading-snug">
                  {isHebrew
                    ? 'שדרג ל-Pro וקבל את קשת הסיפור המלאה — 7 פאנלים, פרומפטים ועוד'
                    : 'Upgrade to Pro for the full story arc — 7 panels, visual prompts and more'}
                </p>
              </div>

              {/* CTA button */}
              <button
                onClick={(e) => { e.stopPropagation(); onUpgrade(); }}
                className="shrink-0 flex items-center gap-1.5 bg-amber-500 hover:bg-amber-400 active:scale-[0.97] text-black font-black text-[12px] px-5 py-2.5 rounded-xl transition-all duration-150 shadow-[0_4px_14px_rgba(245,158,11,0.26)] whitespace-nowrap select-none"
              >
                <Crown size={12} />
                {isHebrew ? 'שדרג עכשיו' : 'Upgrade Now'}
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Copy All Prompts ───────────────────────────────── */}
        <div className="mt-6 flex justify-center">
          <button onClick={copyAll} className="flex items-center gap-2.5 px-7 py-3.5 bg-[#d4a373]/8 border border-[#d4a373]/22 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-[#d4a373]/14 hover:border-[#d4a373]/42 transition-all duration-300">
            {allCopied ? (
              <><Check size={13} className="text-green-400" /><span className="text-green-400">{isHebrew ? 'הועתק!' : 'COPIED!'}</span></>
            ) : (
              <><Copy size={13} className="text-[#d4a373]" /><span className="text-[#d4a373]">{isHebrew ? 'העתק את כל הפרומפטים' : 'COPY ALL PROMPTS'}</span></>
            )}
          </button>
        </div>
      </div>

      {/* ── Footer watermark ───────────────────────────────────── */}
      <div className="px-6 py-3 border-t border-white/[0.04] flex items-center justify-center gap-1.5">
        <Film size={9} className="text-[#d4a373]/25" />
        <span className="text-[#d4a373]/25 text-[8px] font-black uppercase tracking-[0.25em]">LIFESCRIPT STUDIO</span>
      </div>
    </motion.div>
  );
}
