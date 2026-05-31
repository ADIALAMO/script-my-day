import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Copy, Download, Share2, Check, CheckCheck, Film, Volume2, VolumeX,
  Loader2, FastForward, Pencil, RotateCcw, FileText, ChevronDown,
  Printer, X, Mail, NotebookPen, Clapperboard,
} from 'lucide-react';
import { track } from '@vercel/analytics';
import { getMsg, CODES, isQuotaError } from '../lib/messages.js';
import { getGenreLabel } from '../constants/genres.js';
import { HEBREW_RANGE } from '../constants/language.js';
import PosterRenderer from './PosterRenderer';
import StoryboardView from './StoryboardView';
import MovieReelModal from './MovieReelModal';
import CinematicLoader from './CinematicLoader';
import { useTypewriter } from '../hooks/useTypewriter.js';
import { useCinematicAudio } from '../hooks/useCinematicAudio.js';
import { usePosterGeneration } from '../hooks/usePosterGeneration.js';
import { useStoryboardGeneration } from '../hooks/useStoryboardGeneration.js';

// ── Brand SVG icons ──────────────────────────────────────────────────────────
const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
  </svg>
);

// ── Pure helpers (local, no duplication with other files) ────────────────────
const isTextHebrew   = (text) => HEBREW_RANGE.test(text);

const getCinematicTitle = (text) => {
  if (!text) return '';
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let t = lines[0] || '';
  if (/^(תסריט|script|screenplay|scene|סצנה|כותרת)[:\s-]*$/i.test(t) ||
      t.toLowerCase().includes('screenplay') || t.includes('תסריט')) {
    t = lines[1] || t;
  }
  return t.replace(/[*#_:]/g, '').replace(/\[.*?\]/g, '').replace(/^[.\s:-]+|[.\s:-]+$/g, '').trim();
};

// ── Component ────────────────────────────────────────────────────────────────

function ScriptOutput({ script, lang, genre, setIsTypingGlobal, producerName, onPosterGenerated, onScriptEdited, onAuthRequired, onPanelsGenerated, initialPanels, initialPosterUrl }) {
  const finalProducerName = producerName || (lang === 'he' ? 'אורח' : 'GUEST');

  // ── Script parsing ─────────────────────────────────────────────────────────
  const [cleanScript,   setCleanScript]   = useState('');
  const [visualPrompt,  setVisualPrompt]  = useState('');

  const isHebrew    = useMemo(() => isTextHebrew(script || ''), [script]);

  // ── Custom hooks ───────────────────────────────────────────────────────────
  const { isMuted, setIsMuted, playSound, playFlashSound } = useCinematicAudio();

  const { displayText, isTyping, skip, scrollRef, handleScroll } = useTypewriter({
    cleanScript,
    setIsTypingGlobal,
    playSound,
  });

  const posterTitle = useMemo(() => getCinematicTitle(displayText || cleanScript), [displayText, cleanScript]);

  const credits = useMemo(() => {
    const year = new Date().getFullYear();
    return isHebrew ? {
      comingSoon: 'בקרוב בקולנוע',
      line1: `בימוי: ${finalProducerName} • הפקה: סטודיו LIFESCRIPT`,
      line2: 'צילום: מעבדת AI • עיצוב אמנותי: הוליווד דיגיטלית • ליהוק: וירטואלי',
      line3: 'מוזיקה: THE MASTER • עריכה: סוכן 2005 • אפקטים: מנוע קולנועי',
      copyright: `© ${year} LIFESCRIPT STUDIO • כל הזכויות שמורות`,
    } : {
      comingSoon: 'COMING SOON',
      line1: `DIRECTED BY ${finalProducerName.toUpperCase()} • PRODUCTION: LIFESCRIPT STUDIO`,
      line2: 'CINEMATOGRAPHY: AI LAB • ART DIRECTION: DIGITAL HOLLYWOOD • CASTING: VIRTUAL',
      line3: 'MUSIC: THE MASTER • EDITING: AGENT 2005 • VFX: CINEMATIC ENGINE',
      copyright: `© ${year} LIFESCRIPT STUDIO • ALL RIGHTS RESERVED`,
    };
  }, [isHebrew, finalProducerName]);

  const {
    posterUrl, setPosterUrl, posterLoading, setPosterLoading,
    posterError, setPosterError, showPoster, setShowPoster,
    triggerFlash, setTriggerFlash, posterRef,
    currentPosterMessage, generatePoster, handleCapturePoster, resetPoster,
  } = usePosterGeneration({ lang, genre, visualPrompt, posterTitle, isHebrew, finalProducerName, onPosterGenerated, onAuthRequired });

  const {
    showStoryboard, storyboardPanels, storyboardLoading,
    storyboardError, storyboardErrorCode, panelImages,
    unlockedPanels,
    comicStyle, setComicStyle, currentStoryboardMessage,
    generateStoryboard, closeStoryboard,
  } = useStoryboardGeneration({ lang, genre, cleanScript, script, onAuthRequired, onPanelsGenerated, initialPanels });

  // ── Script processing effect ───────────────────────────────────────────────
  useEffect(() => {
    if (!script) return;
    const processed = script.replace(/<br\s*\/?>/gi, '\n');
    const marker    = '[image:';
    const markerIdx = processed.toLowerCase().indexOf(marker);
    if (markerIdx !== -1) {
      setCleanScript(processed.substring(0, markerIdx).trim());
      const endIdx = processed.indexOf(']', markerIdx);
      setVisualPrompt(processed.substring(markerIdx + marker.length, endIdx).trim());
    } else {
      setCleanScript(processed);
      setVisualPrompt('Cinematic masterpiece, dramatic lighting');
    }
    resetPoster();
    if (initialPosterUrl) {
      // Restore a poster saved from a previous session.
      // posterLoading=true keeps the image opacity-0 while the proxy fetches the
      // CDN URL; PosterRenderer's onLoad then fires setPosterLoading(false) → flash.
      setPosterUrl(initialPosterUrl);
      setShowPoster(true);
      setPosterLoading(true);
    }
    setIsEditing(false);
    setIsEdited(false);
    setEditedText('');
    setSaveStatus('idle');
    clearTimeout(saveDebounceRef.current);
  }, [script, initialPosterUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Editor state ───────────────────────────────────────────────────────────
  const [isEditing,  setIsEditing]  = useState(false);
  const [editedText, setEditedText] = useState('');
  const [isEdited,   setIsEdited]   = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');

  const textareaRef      = useRef(null);
  const saveDebounceRef  = useRef(null);
  const exportMenuRef    = useRef(null);

  useEffect(() => {
    if (!isEditing || !textareaRef.current) return;
    const ta = textareaRef.current;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [isEditing]);

  useEffect(() => () => clearTimeout(saveDebounceRef.current), []);

  const handleEditChange = useCallback((e) => {
    const value = e.target.value;
    setEditedText(value);
    setSaveStatus('idle');
    clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      onScriptEdited?.(value);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 1800);
    }, 2000);
  }, [onScriptEdited]);

  const handleEditDone = useCallback(() => {
    clearTimeout(saveDebounceRef.current);
    if (editedText !== cleanScript) {
      setDisplayTextFromEditor(editedText);
      setIsEdited(true);
      onScriptEdited?.(editedText);
    }
    setIsEditing(false);
    setSaveStatus('idle');
  }, [editedText, cleanScript, onScriptEdited]);

  const handleEditRevert = useCallback(() => {
    clearTimeout(saveDebounceRef.current);
    setEditedText(cleanScript);
    setIsEditing(false);
    if (isEdited) {
      setIsEdited(false);
      onScriptEdited?.(cleanScript);
    }
    setSaveStatus('idle');
  }, [cleanScript, isEdited, onScriptEdited]);

  // The typewriter owns displayText; we need to push an edited value back into it.
  // We achieve this by storing a local override that shadows displayText after editing.
  const [editedDisplay, setEditedDisplay] = useState('');
  const setDisplayTextFromEditor = useCallback((text) => setEditedDisplay(text), []);

  // Reset the edited display override when a new script arrives.
  useEffect(() => { setEditedDisplay(''); }, [script]);

  const currentDisplayText = editedDisplay || displayText;

  // ── Share / export state ───────────────────────────────────────────────────
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);
  const [showReelModal,  setShowReelModal]  = useState(false);
  const [isCopied,       setIsCopied]       = useState(false);

  // Body scroll lock for Distribution Hub modal.
  // MovieReelModal owns its own scroll lock internally.
  useEffect(() => {
    if (!showShareModal) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [showShareModal]);

  useEffect(() => {
    if (!showExportMenu) return;
    const handle = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [showExportMenu]);

  // ── Share handlers ─────────────────────────────────────────────────────────
  const handleWhatsApp = useCallback(() => {
    const text    = currentDisplayText;
    const title   = posterTitle || (isHebrew ? 'התסריט שלי' : 'My Script');
    const preview = text.length > 900 ? text.slice(0, 900) + '…' : text;
    const message = isHebrew
      ? `🎬 *${title}*\n\nנוצר ב-LIFESCRIPT STUDIO:\n\n${preview}`
      : `🎬 *${title}*\n\nGenerated by LIFESCRIPT STUDIO:\n\n${preview}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    track('Script Shared', { platform: 'whatsapp', genre, language: lang });
  }, [currentDisplayText, posterTitle, isHebrew, genre, lang]);

  const handleFacebook = useCallback(() => {
    const url = encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '');
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener,noreferrer,width=600,height=480');
    track('Script Shared', { platform: 'facebook', genre, language: lang });
  }, [genre, lang]);

  const handlePrintIframe = useCallback(() => {
    const text  = currentDisplayText;
    const dir   = isHebrew ? 'rtl' : 'ltr';
    const title = posterTitle || 'script';

    const formattedLines = text.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="ls-blank"></div>';
      const isScene = /^(INT\.|EXT\.|פנים\.|חוץ\.)/i.test(trimmed) ||
        (!isHebrew && /^[A-Z][A-Z\s\d.\-:,'"!?]+$/.test(trimmed) && trimmed.length < 60);
      return isScene
        ? `<div class="ls-scene">${trimmed}</div>`
        : `<div class="ls-action">${trimmed}</div>`;
    }).join('');

    const html = `<!DOCTYPE html>
<html lang="${isHebrew ? 'he' : 'en'}" dir="${dir}">
<head><meta charset="utf-8"><title>${title}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:'Courier Prime','Courier New',Courier,monospace;font-size:12pt;line-height:1.8;color:#000;direction:${dir};text-align:${isHebrew ? 'right' : 'left'}}
  .ls-title-page{text-align:center;padding-top:3.5in;page-break-after:always}
  .ls-title-page h1{font-size:18pt;font-weight:700;letter-spacing:.08em;margin-bottom:.5in}
  .ls-title-page p{margin-top:.15in;font-size:12pt}
  .ls-scene{font-weight:700;text-transform:uppercase;margin-top:1.5em;margin-bottom:.5em}
  .ls-action{margin-bottom:.5em}
  .ls-blank{height:.75em}
  @page{margin:1.5in 1.25in;size:letter}
</style>
</head>
<body>
<div class="ls-title-page">
  <h1>${title.toUpperCase()}</h1>
  <p>Written by ${finalProducerName}</p>
  <p>Generated by LIFESCRIPT STUDIO</p>
</div>
<div>${formattedLines}</div>
</body></html>`;

    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;visibility:hidden;';
    document.body.appendChild(iframe);
    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) { iframe.remove(); return; }
    doc.open(); doc.write(html); doc.close();
    const doCleanup = () => { iframe.remove(); iframe.contentWindow?.removeEventListener('afterprint', doCleanup); };
    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.addEventListener('afterprint', doCleanup);
        iframe.contentWindow?.print();
      }, 250);
    };
    track('Script Exported', { format: 'pdf', genre, language: lang });
  }, [currentDisplayText, isHebrew, posterTitle, finalProducerName, genre, lang]);

  const handleEmail = useCallback(() => {
    const text    = currentDisplayText;
    const title   = posterTitle || (isHebrew ? 'התסריט שלי' : 'My Script');
    const subject = encodeURIComponent(`🎬 Script: ${title}`);
    const body    = encodeURIComponent(text);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    track('Script Shared', { platform: 'email', genre, language: lang });
  }, [currentDisplayText, posterTitle, isHebrew, genre, lang]);

  const handleNativeShare = useCallback(async () => {
    const text  = currentDisplayText;
    const title = posterTitle || (isHebrew ? 'התסריט שלי' : 'My Script');
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text });
        track('Script Shared', { platform: 'native', genre, language: lang });
      } catch (err) {
        if (err.name !== 'AbortError') navigator.clipboard?.writeText(text);
      }
    } else {
      navigator.clipboard?.writeText(text);
      track('Script Shared', { platform: 'clipboard-fallback', genre, language: lang });
    }
  }, [currentDisplayText, posterTitle, isHebrew, genre, lang]);

  // ── Comic style options ────────────────────────────────────────────────────
  const comicStyleOptions = useMemo(() => isHebrew ? [
    { value: 'anime',  label: 'אנימה סטודיו' },
    { value: 'marvel', label: 'מארוול רטרו' },
    { value: 'noir',   label: 'נואר קולנועי' },
  ] : [
    { value: 'anime',  label: 'ANIME STUDIO' },
    { value: 'marvel', label: 'MARVEL RETRO' },
    { value: 'noir',   label: 'CINEMATIC NOIR' },
  ], [isHebrew]);

  // ── Derived values ─────────────────────────────────────────────────────────
  const currentScriptText = currentDisplayText;

  // ── JSX ────────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6 w-full max-w-[100vw] relative">

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex justify-between items-center px-6 h-14">
        <div className="flex items-center gap-2">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase text-[10px] tracking-widest italic">LIFESCRIPT STUDIO</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Typewriter skip */}
          {isTyping && (
            <button
              onClick={skip}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a373]/20 border border-[#d4a373]/40 rounded-full text-[10px] text-[#d4a373] font-bold"
            >
              <FastForward size={12} /> {isHebrew ? 'דלג' : 'SKIP'}
            </button>
          )}

          {/* Edit-mode controls */}
          <AnimatePresence mode="wait">
            {!isTyping && currentDisplayText.length > 0 && (
              isEditing ? (
                <motion.div
                  key="edit-active"
                  initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.15 }}
                  className="flex items-center gap-1.5"
                >
                  <button
                    onClick={handleEditRevert}
                    title={isHebrew ? 'בטל עריכה' : 'Revert to original'}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-xl text-gray-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/8 transition-all duration-200 text-[9px] font-black uppercase tracking-wider"
                  >
                    <RotateCcw size={12} />
                    <span className="hidden sm:inline">{isHebrew ? 'שחזר' : 'Revert'}</span>
                  </button>
                  <button
                    onClick={handleEditDone}
                    className="flex items-center gap-1 px-3 py-1.5 bg-[#d4a373] text-black rounded-xl font-black text-[9px] uppercase tracking-wider hover:bg-white active:scale-95 transition-all duration-200 shadow-[0_0_16px_rgba(212,163,115,0.25)]"
                  >
                    <CheckCheck size={12} />
                    <span>{isHebrew ? 'אישור' : 'Done'}</span>
                  </button>
                </motion.div>
              ) : (
                <motion.button
                  key="edit-trigger"
                  initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }} transition={{ duration: 0.15 }}
                  onClick={() => { setEditedText(currentDisplayText); setIsEditing(true); }}
                  title={isHebrew ? 'ערוך תסריט' : 'Edit script'}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-xl text-[9px] font-black uppercase tracking-wider transition-all duration-200
                    ${isEdited
                      ? 'border-[#d4a373]/40 bg-[#d4a373]/10 text-[#d4a373] hover:bg-[#d4a373]/20'
                      : 'border-white/10 bg-white/5 text-gray-500 hover:text-[#d4a373] hover:border-[#d4a373]/30 hover:bg-[#d4a373]/8'
                    }`}
                >
                  <Pencil size={12} />
                  <span className="hidden sm:inline">
                    {isEdited ? (isHebrew ? 'ערוך שוב' : 'Re-edit') : (isHebrew ? 'עריכה' : 'Edit')}
                  </span>
                </motion.button>
              )
            )}
          </AnimatePresence>

          {/* Mute */}
          <button onClick={() => setIsMuted(m => !m)} className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
            {isMuted ? <VolumeX size={18} className="text-red-500" /> : <Volume2 size={18} className="text-[#d4a373]" />}
          </button>

          {/* Export dropdown */}
          <div ref={exportMenuRef} className="relative">
            <button
              onClick={() => setShowExportMenu(v => !v)}
              aria-label={isHebrew ? 'ייצוא תסריט' : 'Export script'}
              className="flex items-center gap-1 p-2.5 bg-white/5 border border-white/10 rounded-xl text-gray-400 hover:text-[#d4a373] hover:border-[#d4a373]/30 transition-colors"
            >
              <Download size={18} />
              <ChevronDown size={11} className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`} />
            </button>

            <AnimatePresence>
              {showExportMenu && (
                <motion.div
                  initial={{ opacity: 0, y: -6, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.96 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.7 }}
                  className="absolute right-0 top-full mt-2 z-50 min-w-[168px] bg-[#0d0d18]/97 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.7),0_0_0_1px_rgba(212,163,115,0.06)] overflow-hidden"
                >
                  <button
                    onClick={() => { navigator.clipboard.writeText(currentScriptText); setIsCopied(true); setShowExportMenu(false); track('Script Exported', { format: 'copy', genre, language: lang }); setTimeout(() => setIsCopied(false), 2000); }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-gray-300 hover:text-[#d4a373] hover:bg-[#d4a373]/8 transition-colors duration-150"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    {isCopied ? <Check size={13} className="text-green-400 shrink-0" /> : <Copy size={13} className="text-[#d4a373]/50 shrink-0" />}
                    {isCopied ? (isHebrew ? 'הועתק!' : 'Copied!') : (isHebrew ? 'העתק טקסט' : 'Copy Text')}
                  </button>

                  <div className="h-px bg-white/5 mx-3" />

                  <button
                    onClick={() => {
                      const blob = new Blob([currentScriptText], { type: 'text/plain;charset=utf-8' });
                      const url  = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url; link.download = `${posterTitle || 'script'}.txt`;
                      document.body.appendChild(link); link.click();
                      setTimeout(() => { document.body.removeChild(link); URL.revokeObjectURL(url); }, 200);
                      setShowExportMenu(false);
                      track('Script Exported', { format: 'txt', genre, language: lang });
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-gray-300 hover:text-[#d4a373] hover:bg-[#d4a373]/8 transition-colors duration-150"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    <FileText size={13} className="text-[#d4a373]/50 shrink-0" />
                    {isHebrew ? 'הורד .txt' : 'Download .txt'}
                  </button>

                  <div className="h-px bg-white/5 mx-3" />

                  <button
                    onClick={() => { setShowExportMenu(false); setShowShareModal(true); }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-gray-300 hover:text-[#d4a373] hover:bg-[#d4a373]/8 transition-colors duration-150"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    <Printer size={13} className="text-[#d4a373]/50 shrink-0" />
                    {isHebrew ? 'ייצוא PDF / הדפסה' : 'Export PDF / Print'}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* ── Script View ──────────────────────────────────────────────────── */}
      <div
        className={`relative rounded-[3.5rem] overflow-hidden bg-[#030712]/90 mx-2 md:mx-4 transition-all duration-500
          ${isEditing
            ? 'border border-[#d4a373]/45 shadow-[0_0_40px_rgba(212,163,115,0.10),inset_0_0_40px_rgba(212,163,115,0.03)]'
            : 'border border-white/5'
          }`}
      >
        <div
          ref={scrollRef}
          className="h-[500px] md:h-[650px] overflow-y-auto p-10 md:p-20 custom-scrollbar relative"
          style={{ scrollBehavior: 'smooth' }}
          onWheel={handleScroll}
        >
          {isEditing ? (
            <textarea
              ref={textareaRef}
              value={editedText}
              onChange={handleEditChange}
              dir={isHebrew ? 'rtl' : 'ltr'}
              spellCheck={false}
              className={`w-full min-h-[420px] md:min-h-[570px] bg-transparent outline-none resize-none
                script-font text-xl md:text-3xl leading-[2.5] text-gray-100
                placeholder-gray-700 caret-[#d4a373]
                ${isHebrew ? 'text-right' : 'text-left'}`}
              style={{ fontFamily: "'Courier Prime', 'Courier New', monospace" }}
            />
          ) : (
            <div
              className={`script-font text-xl md:text-3xl leading-[2.5] text-gray-100 whitespace-pre-wrap pb-40
                ${isHebrew ? 'text-right' : 'text-left'}`}
            >
              {currentDisplayText}
              {isTyping && (
                <motion.span
                  animate={{ opacity: [1, 0, 1] }}
                  transition={{ duration: 0.9, repeat: Infinity }}
                  className="inline-block w-2.5 h-8 bg-[#d4a373] ml-1 align-middle"
                />
              )}
            </div>
          )}
        </div>

        {/* Status badge */}
        <AnimatePresence mode="wait">
          {!isTyping && !isEditing && currentDisplayText.length > 0 && (
            <motion.div
              key={isEdited ? 'edited' : 'complete'}
              initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }} transition={{ duration: 0.25 }}
              className="absolute bottom-5 left-0 right-0 px-6 flex justify-between items-end z-30"
            >
              <div className="flex items-center gap-2">
                {isEdited ? (
                  <><Pencil size={11} className="text-[#d4a373]" /><span className="text-[#d4a373] text-[12px] font-bold tracking-wider">{isHebrew ? 'נערך ידנית' : 'EDITED'}</span></>
                ) : (
                  <><span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" /><span className="text-[#d4a373] text-[12px] font-bold">{isHebrew ? 'ההפקה סיימה' : 'PRODUCTION COMPLETE'}</span></>
                )}
              </div>
              <img src="/icon.png" className="w-8 h-8 object-contain opacity-50" alt="icon" />
            </motion.div>
          )}
          {saveStatus === 'saved' && (
            <motion.div
              key="save-flash"
              initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.2 }}
              className="absolute bottom-5 right-6 z-30 flex items-center gap-1.5 text-[#d4a373]/60 text-[10px] font-black uppercase tracking-widest"
            >
              <CheckCheck size={11} />
              {isHebrew ? 'נשמר' : 'Saved'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* ── Action buttons ────────────────────────────────────────────── */}
      {!isTyping && currentDisplayText.length > 0 && (!showPoster || !showStoryboard) && (
        <div className="py-6 px-4 space-y-3">

          {/* ── POSTER SECTION ── */}
          {!showPoster && (
            <button
              onClick={generatePoster}
              disabled={posterLoading}
              className="w-full bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black py-4 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity"
            >
              {posterLoading
                ? <Loader2 size={18} className="animate-spin" />
                : <span>{isHebrew ? 'צור פוסטר קולנועי' : 'GENERATE MOVIE POSTER'}</span>
              }
            </button>
          )}

          {/* Divider — only shown when both sections are visible */}
          {!showPoster && !showStoryboard && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
              <span className="text-[7.5px] font-black uppercase tracking-[0.28em]" style={{ color: 'rgba(255,255,255,0.18)' }}>
                {isHebrew ? 'קומיקס' : 'COMIC STORYBOARD'}
              </span>
              <div className="flex-1 h-px" style={{ background: 'rgba(255,255,255,0.06)' }} />
            </div>
          )}

          {/* ── COMIC SECTION — style selector grouped directly above its generate button ── */}
          {!showStoryboard && (
            <div className="space-y-2">
              {!storyboardLoading && (
                <div className="flex items-center justify-center gap-2 flex-wrap">
                  {comicStyleOptions.map(opt => (
                    <button
                      key={opt.value}
                      onClick={() => setComicStyle(opt.value)}
                      className={`px-3.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-200
                        ${comicStyle === opt.value
                          ? 'bg-[#d4a373]/20 border border-[#d4a373]/60 text-[#d4a373]'
                          : 'bg-white/[0.04] border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20'
                        }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              )}
              <button
                onClick={generateStoryboard}
                disabled={storyboardLoading}
                className="w-full border border-[#d4a373]/40 bg-[#050710] text-[#d4a373] font-black py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-[#d4a373]/10 hover:border-[#d4a373]/70 transition-all duration-300 disabled:opacity-60"
              >
                {storyboardLoading
                  ? <Clapperboard size={18} className="animate-spin text-[#d4a373]/60" />
                  : <><Clapperboard size={18} /><span>{isHebrew ? 'צור קומיקס' : 'GENERATE COMIC STORYBOARD'}</span></>
                }
              </button>
            </div>
          )}

        </div>
      )}

      {/* ── Storyboard error ─────────────────────────────────────────── */}
      <AnimatePresence>
        {storyboardError && (
          <motion.div
            initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className={`mx-4 px-5 py-4 rounded-2xl border flex flex-col items-center gap-3 text-center ${
              isQuotaError(storyboardErrorCode)
                ? 'bg-[#d4a373]/8 border-[#d4a373]/20 text-[#d4a373]/80'
                : 'bg-red-500/10 border-red-500/20 text-red-400'
            }`}
          >
            <p className="text-[12px] font-medium">{storyboardError}</p>
            {!isQuotaError(storyboardErrorCode) && (
              <button
                onClick={generateStoryboard}
                className="px-5 py-1.5 rounded-full bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/60 hover:text-white hover:border-white/25 transition-all duration-200"
              >
                {lang === 'he' ? '↺ נסה שוב' : '↺ TRY AGAIN'}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Poster ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showPoster && (
          <div className="mt-8">
            <PosterRenderer
              posterUrl={posterUrl}
              posterLoading={posterLoading}
              posterError={posterError}
              setPosterError={setPosterError}
              setPosterUrl={setPosterUrl}
              triggerFlash={triggerFlash}
              posterRef={posterRef}
              posterTitle={posterTitle}
              credits={credits}
              handleCapturePoster={handleCapturePoster}
              onRetryGenerate={generatePoster}
              lang={lang}
              genre={genre}
              posterLoadingMessages={currentPosterMessage}
              setTriggerFlash={setTriggerFlash}
              setPosterLoading={setPosterLoading}
              playFlashSound={playFlashSound}
            />
          </div>
        )}
      </AnimatePresence>

      {/* ── Storyboard cinematic loader ───────────────────────────────── */}
      <CinematicLoader
        isVisible={storyboardLoading && !showStoryboard}
        lang={lang}
        producerName={finalProducerName}
        phase="storyboard"
      />

      {/* ── Storyboard view ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showStoryboard && storyboardPanels.length > 0 && (
          <StoryboardView
            key="storyboard-view"
            panels={storyboardPanels}
            lang={lang}
            panelImages={panelImages}
            onClose={closeStoryboard}
            unlockedPanels={unlockedPanels}
            onUpgrade={() => onAuthRequired('upgrade')}
          />
        )}
      </AnimatePresence>

      {/* ── Generate Reel CTA — appears once storyboard is visible ────── */}
      <AnimatePresence>
        {showStoryboard && storyboardPanels.length > 0 && (
          <motion.div
            key="reel-cta"
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.45, ease: 'easeOut', delay: 0.2 }}
            className="mx-2 md:mx-4"
          >
            <button
              onClick={() => setShowReelModal(true)}
              className="group w-full relative overflow-hidden flex items-center justify-center gap-3 py-4 px-6 rounded-[1.75rem] border border-[#d4a373]/30 bg-[#030712]/80 hover:border-[#d4a373]/70 hover:bg-[#d4a373]/8 transition-all duration-500"
            >
              {/* Sweep shimmer */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-[#d4a373]/6 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 pointer-events-none" />

              <div className="flex items-center justify-center w-8 h-8 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/20 shrink-0 group-hover:scale-110 transition-transform duration-300">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-[#d4a373]">
                  <path d="M15 10l4.553-2.277A1 1 0 0121 8.647v6.706a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                </svg>
              </div>

              <div className={isHebrew ? 'text-right' : 'text-left'}>
                <p className="text-[#d4a373] font-black text-[11px] uppercase tracking-[0.22em]">
                  {isHebrew ? 'צור ריל קולנועי' : 'GENERATE CINEMATIC REEL'}
                </p>
                <p className="text-white/30 text-[9px] tracking-wide mt-0.5">
                  {isHebrew
                    ? 'קומפוזיציה קולנועית מוכנה לשיתוף · 9:16 · אינסטגרם / טיקטוק'
                    : 'Cinematic composition ready to share · 9:16 · Instagram / TikTok'}
                </p>
              </div>

              <div className={`ml-auto shrink-0 flex flex-col gap-0.5 opacity-40 group-hover:opacity-80 transition-opacity ${isHebrew ? 'mr-auto ml-0' : ''}`}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="h-0.5 bg-[#d4a373] rounded-full" style={{ width: 6 + i * 3 }} />
                ))}
              </div>
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Reel modal ────────────────────────────────────────────────── */}
      <MovieReelModal
        isOpen={showReelModal}
        onClose={() => setShowReelModal(false)}
        panels={storyboardPanels}
        panelImages={panelImages}
        lang={lang}
        genre={genre}
        producerName={finalProducerName}
      />

      {/* ── Distribution Hub modal ────────────────────────────────────── */}
      <AnimatePresence>
        {showShareModal && (
          <>
            <motion.div
              key="share-backdrop"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm"
              onClick={() => setShowShareModal(false)}
            />
            <motion.div
              key="share-modal"
              initial={{ opacity: 0, scale: 0.88, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 24 }}
              transition={{ type: 'spring', stiffness: 400, damping: 36, mass: 0.75 }}
              className="fixed inset-0 z-[2001] flex items-center justify-center p-4 md:p-6 pointer-events-none"
            >
              <div className="w-full max-w-[340px] pointer-events-auto rounded-[2rem] overflow-hidden bg-[#07070f]/98 backdrop-blur-3xl border border-[#d4a373]/12 shadow-[0_48px_120px_rgba(0,0,0,0.9),0_0_0_1px_rgba(212,163,115,0.07)]">
                <div className="relative px-6 pt-6 pb-5 border-b border-white/[0.05]">
                  <div className="flex items-center gap-2 mb-2">
                    <Share2 size={12} className="text-[#d4a373]/70" />
                    <span className="text-[#d4a373]/70 text-[9px] font-black uppercase tracking-[0.2em]">
                      {isHebrew ? 'הפץ את ההפקה' : 'Distribution Hub'}
                    </span>
                  </div>
                  <p className="text-white font-black text-[17px] leading-tight pr-8 truncate">
                    {posterTitle || (isHebrew ? 'התסריט שלי' : 'My Script')}
                  </p>
                  <button
                    onClick={() => setShowShareModal(false)}
                    className="absolute top-[22px] right-5 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-500 hover:text-white transition-all duration-150"
                  >
                    <X size={13} />
                  </button>
                </div>

                <div className="p-3 space-y-2">
                  {[
                    { onClick: () => { handleWhatsApp(); setShowShareModal(false); }, color: '#25D366', icon: <WhatsAppIcon />, label: isHebrew ? 'שלח בוואטסאפ' : 'Send via WhatsApp', sub: isHebrew ? 'שתף עם חברים ישירות' : 'Share directly with friends' },
                    { onClick: () => { handleFacebook(); setShowShareModal(false); }, color: '#1877F2', icon: <FacebookIcon />, label: isHebrew ? 'שתף בפייסבוק' : 'Share on Facebook', sub: isHebrew ? 'פרסם את ההפקה בפיד' : 'Post your production to your feed' },
                    { onClick: () => { handlePrintIframe(); setShowShareModal(false); }, color: '#d4a373', icon: <Printer size={19} />, label: isHebrew ? 'הדפסה / שמור כ-PDF' : 'Print / Save as PDF', sub: isHebrew ? 'פורמט תסריט הוליוודי סטנדרטי' : 'Hollywood-standard screenplay format' },
                    { onClick: () => { handleEmail(); setShowShareModal(false); }, color: '#8b5cf6', icon: <Mail size={19} />, label: isHebrew ? 'שלח באימייל' : 'Send via Email', sub: isHebrew ? 'פתח אפליקציית דואר עם התסריט' : 'Open your mail app with the script' },
                    { onClick: () => { handleNativeShare(); setShowShareModal(false); }, color: '#38bdf8', icon: <NotebookPen size={19} />, label: isHebrew ? 'שמור / שתף טקסט' : 'Save to Notes / Share Text', sub: isHebrew ? 'שיתוף נייטיב או העתקה לקליפבורד' : 'Native share sheet or clipboard copy' },
                  ].map((item, i) => (
                    <button
                      key={i}
                      onClick={item.onClick}
                      className="flex items-center gap-4 w-full px-4 py-[14px] rounded-[1.1rem] bg-white/[0.03] border border-white/[0.06] transition-all duration-200 group"
                      style={{ textAlign: isHebrew ? 'right' : 'left' }}
                    >
                      <div
                        className="flex items-center justify-center w-10 h-10 rounded-xl shrink-0 transition-colors duration-200"
                        style={{ background: `${item.color}1a`, border: `1px solid ${item.color}33`, color: item.color }}
                      >
                        {item.icon}
                      </div>
                      <div>
                        <p className="text-white font-bold text-[13px] leading-none mb-[5px]">{item.label}</p>
                        <p className="text-gray-500 text-[11px] leading-none">{item.sub}</p>
                      </div>
                    </button>
                  ))}
                </div>

                <div className="px-6 py-3 border-t border-white/[0.05] flex items-center justify-center gap-1.5">
                  <Film size={10} className="text-[#d4a373]/30" />
                  <span className="text-[#d4a373]/30 text-[8.5px] font-black uppercase tracking-[0.22em]">LIFESCRIPT STUDIO</span>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <style jsx global>{`
        .script-font { font-family: 'Courier Prime', 'Courier New', monospace; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(212, 163, 115, 0.2); border-radius: 10px; }
      `}</style>
    </div>
  );
}

export default ScriptOutput;
