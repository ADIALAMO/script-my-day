import React, { useState, useEffect, useRef, useMemo, useCallback, useReducer } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Copy, Download, Share2, Check, CheckCheck, Film, Volume2, VolumeX, Loader2, FastForward, Pencil, RotateCcw, FileText, ChevronDown, Printer, X, Mail, NotebookPen, Clapperboard } from 'lucide-react';
import * as htmlToImage from 'html-to-image';
import { track } from '@vercel/analytics';
import PosterRenderer from './PosterRenderer'; 
import { detectLanguage } from '../lib/agent';
import StoryboardView from './StoryboardView';

// --- Brand SVG icons (inline, no external dependency) ---
const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
  </svg>
);

const FacebookIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
  </svg>
);

// --- פונקציות עזר מוטמעות ---
const isTextHebrew = (text) => /[\u0590-\u05FF]/.test(text);

const getCinematicTitle = (text) => {
  if (!text) return "";
  let lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  let titleCandidate = lines[0] || "";
  if (titleCandidate.match(/^(תסריט|script|screenplay|scene|סצנה|כותרת)[:\s-]*$/i) || 
      titleCandidate.toLowerCase().includes("screenplay") || titleCandidate.includes("תסריט")) {
     titleCandidate = lines[1] || titleCandidate;
  }
  return titleCandidate.replace(/[*#_:]/g, '').replace(/\[.*?\]/g, '').replace(/^[.\s:-]+|[.\s:-]+$/g, '').trim();
};

const translateGenre = (genre) => {
  const map = {
    'אימה': 'Horror', 'קומדיה': 'Comedy', 'דרמה': 'Drama', 'אקשן': 'Action',
    'פעולה': 'Action', 'מדע בדיוני': 'Sci-Fi', 'מתח': 'Thriller', 
    'רומנטיקה': 'Romance', 'קומיקס': 'Comic',
    'horror': 'Horror', 'comedy': 'Comedy', 'drama': 'Drama', 'action': 'Action',
    'sci-fi': 'Sci-Fi', 'thriller': 'Thriller', 'romance': 'Romance', 'comic': 'Comic'
  };
  const normalized = genre?.toLowerCase().trim();
  return map[normalized] || genre || 'Cinematic';
};

// Opt 5: Reducer consolidates all panel-image state transitions. INIT_ALL flips every skeleton to
// loading in one render cycle; SET_PANEL updates individual panels as they resolve asynchronously.
function panelImagesReducer(state, action) {
  switch (action.type) {
    case 'INIT_ALL': {
      const next = {};
      for (let i = 0; i < action.count; i++) next[i] = { loading: true, url: null, error: false };
      return next;
    }
    case 'SET_PANEL':
      return { ...state, [action.idx]: action.payload };
    case 'RESET':
      return {};
    default:
      return state;
  }
}

function ScriptOutput({ script, lang, genre, setIsTypingGlobal, producerName, onPosterGenerated, onScriptEdited }) {
  const finalProducerName = producerName || (lang === 'he' ? 'אורח' : 'GUEST');
  
  // --- States ---
  const [cleanScript, setCleanScript] = useState('');
  const [visualPrompt, setVisualPrompt] = useState('');
  const [displayText, setDisplayText] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [showPoster, setShowPoster] = useState(false);
  const [posterUrl, setPosterUrl] = useState('');
  const [posterLoading, setPosterLoading] = useState(false);
  const [triggerFlash, setTriggerFlash] = useState(false);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [posterError, setPosterError] = useState('');

  // --- Editor states ---
  const [isEditing, setIsEditing] = useState(false);
  const [editedText, setEditedText] = useState('');
  const [isEdited, setIsEdited] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle'); // 'idle' | 'saved'
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // --- Storyboard states ---
  const [showStoryboard, setShowStoryboard] = useState(false);
  const [storyboardPanels, setStoryboardPanels] = useState([]);
  const [storyboardLoading, setStoryboardLoading] = useState(false);
  const [storyboardError, setStoryboardError] = useState('');
  const [storyboardMsgIdx, setStoryboardMsgIdx] = useState(0);
  // panelImages: { [idx]: { loading: bool, url: string|null, error: bool } }
  const [panelImages, dispatchPanelImages] = useReducer(panelImagesReducer, {});
  const [comicStyle, setComicStyle] = useState('anime');

  // --- Refs ---
  const storyboardActiveRef = useRef(false);
  const scrollRef = useRef(null);
  const posterRef = useRef(null);
  const isAutoScrollPaused = useRef(false);
  const pauseTimer = useRef(null);
  const timerRef = useRef(null);
  const audioContext = useRef(null);
  const audioBuffer = useRef(null);
  const flashBuffer = useRef(null);
  const isMutedRef = useRef(false);
  const textareaRef = useRef(null);
  const saveDebounceRef = useRef(null);
  const exportMenuRef = useRef(null);

  const isHebrew = useMemo(() => isTextHebrew(script || ''), [script]);
  const posterTitle = useMemo(() => getCinematicTitle(displayText || cleanScript), [displayText, cleanScript]);

  const posterLoadingMessages = useMemo(() => isHebrew ? [
    "מנתח את האסתטיקה של התסריט...", "מלהק כוכבים לפוסטר הרשמי...", "מעצב את התאורה בסט הצילומים...",
    "בונה את הקומפוזיציה הויזואלית...", "מלטש את הצבעים והפילטרים...", "מרנדר את הפוסטר ב-4K...",
    "תולה את הפוסטר בבכורה העולמית..."
  ] : [
    "Analyzing script aesthetics...", "Casting stars for the poster...", "Setting the cinematic lights...",
    "Building visual composition...", "Color grading and filtering...", "Rendering poster in 4K...",
    "Hanging the poster for the premiere..."
  ], [isHebrew]);

  const credits = useMemo(() => {
    const year = new Date().getFullYear();
    return isHebrew ? {
      comingSoon: 'בקרוב בקולנוע',
      line1: `בימוי: ${finalProducerName} • הפקה: סטודיו LIFESCRIPT`,
      line2: 'צילום: מעבדת AI • עיצוב אמנותי: הוליווד דיגיטלית • ליהוק: וירטואלי',
      line3: 'מוזיקה: THE MASTER • עריכה: סוכן 2005 • אפקטים: מנוע קולנועי',
      copyright: `© ${year} LIFESCRIPT STUDIO • כל הזכויות שמורות`
    } : {
      comingSoon: 'COMING SOON',
      line1: `DIRECTED BY ${finalProducerName.toUpperCase()} • PRODUCTION: LIFESCRIPT STUDIO`,
      line2: 'CINEMATOGRAPHY: AI LAB • ART DIRECTION: DIGITAL HOLLYWOOD • CASTING: VIRTUAL',
      line3: 'MUSIC: THE MASTER • EDITING: AGENT 2005 • VFX: CINEMATIC ENGINE',
      copyright: `© ${year} LIFESCRIPT STUDIO • ALL RIGHTS RESERVED`
    };
  }, [isHebrew, finalProducerName]);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);

  useEffect(() => {
    let interval;
    if (posterLoading) {
      interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % posterLoadingMessages.length);
      }, 2800);
    } else { setLoadingMessageIndex(0); }
    return () => clearInterval(interval);
  }, [posterLoading, posterLoadingMessages.length]);

  // --- מנוע סאונד קולנועי משודרג ---
   useEffect(() => {
    let unlockFn = null;

    const initAudio = async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!audioContext.current) audioContext.current = new AudioCtx();

        const response = await fetch('/audio/typewriter.m4a');
        const arrayBuffer = await response.arrayBuffer();
        audioBuffer.current = await audioContext.current.decodeAudioData(arrayBuffer);

        const responseFlash = await fetch('/audio/camera-flash.wav');
        const arrayBufferFlash = await responseFlash.arrayBuffer();
        flashBuffer.current = await audioContext.current.decodeAudioData(arrayBufferFlash);

        if (audioContext.current?.state === 'suspended') {
          await audioContext.current.resume().catch(e => console.warn("Failed to resume AudioContext on init:", e));
        }

        const unlock = () => {
          if (audioContext.current?.state === 'suspended') {
            audioContext.current.resume().catch(e => console.warn("Failed to resume AudioContext on user interaction:", e));
          }
          window.removeEventListener('click', unlock);
          window.removeEventListener('touchstart', unlock);
          window.removeEventListener('mousemove', unlock);
        };
        unlockFn = unlock;
        window.addEventListener('click', unlock);
        window.addEventListener('touchstart', unlock);
        window.addEventListener('mousemove', unlock);
      } catch (e) { console.error("Audio engine failed", e); }
    };
    initAudio();

    return () => {
      if (unlockFn) {
        window.removeEventListener('click', unlockFn);
        window.removeEventListener('touchstart', unlockFn);
        window.removeEventListener('mousemove', unlockFn);
      }
      audioContext.current?.close().catch(() => {});
    };
  }, []);

 const playSound = useCallback(() => {
  // בדיקה שהבאפר קיים והמערכת לא במיוט
  if (isMutedRef.current || !audioBuffer.current || !audioContext.current) return;

  // וידוא שהקונטקסט פתוח לפני יצירת ה‑source
  if (audioContext.current?.state === 'suspended') {
    audioContext.current.resume().catch(() => {});
  }

  const source = audioContext.current.createBufferSource();
  source.buffer = audioBuffer.current;
  const gainNode = audioContext.current.createGain();

  // ווליום אופטימלי להקלדה
  gainNode.gain.setValueAtTime(0.6, audioContext.current.currentTime);

  source.connect(gainNode);
  gainNode.connect(audioContext.current.destination);
  source.start(0);
}, []);

const playFlashSound = useCallback(() => {
  if (isMutedRef.current || !flashBuffer.current || !audioContext.current) return;
  
  // וידוא שהקונטקסט פתוח לפני יצירת ה‑source
  if (audioContext.current.state === 'suspended') {
    audioContext.current.resume().catch(() => {});
  }

  const source = audioContext.current.createBufferSource();
  source.buffer = flashBuffer.current;
  
  const gainNode = audioContext.current.createGain();
  const now = audioContext.current.currentTime;
  
  // הגדרת ווליום: קליק חזק בשיא, ואז דעיכה איטית ששומרת על ה"זנב" של הסאונד
  gainNode.gain.setValueAtTime(1.0, now); 
  // דעיכה ל-0.1 (לא לאפס!) לאורך 2.5 שניות כדי שהאפקט ימשיך להישמע
  gainNode.gain.linearRampToValueAtTime(0.1, now + 2.5); 
  
  source.connect(gainNode);
  gainNode.connect(audioContext.current.destination);
  
  // התיקון: מתחילים מהשנייה ה-0.5 (הקליק) ומנגנים עד הסוף (סה"כ נשארות 2.5 שניות)
  source.start(now, 0.5); 
}, [flashBuffer.current]);

  // --- Editor lifecycle ---

  // Auto-focus + cursor-to-end when entering edit mode
  useEffect(() => {
    if (!isEditing || !textareaRef.current) return;
    const ta = textareaRef.current;
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }, [isEditing]);

  // Cleanup debounce timer on unmount
  useEffect(() => () => clearTimeout(saveDebounceRef.current), []);

  // Debounced auto-save while the user types (2 s of inactivity)
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

  // Commit edits: final save, update display, mark as edited
  const handleEditDone = useCallback(() => {
    clearTimeout(saveDebounceRef.current);
    const hasChanged = editedText !== cleanScript;
    if (hasChanged) {
      setDisplayText(editedText);
      setIsEdited(true);
      onScriptEdited?.(editedText);
    }
    setIsEditing(false);
    setSaveStatus('idle');
  }, [editedText, cleanScript, onScriptEdited]);

  // Discard edits: restore original AI text
  const handleEditRevert = useCallback(() => {
    clearTimeout(saveDebounceRef.current);
    setEditedText(cleanScript);
    setDisplayText(cleanScript);
    setIsEditing(false);
    // Only push a history update if we're reverting a previously committed edit
    if (isEdited) {
      setIsEdited(false);
      onScriptEdited?.(cleanScript);
    }
    setSaveStatus('idle');
  }, [cleanScript, isEdited, onScriptEdited]);

  // Close export menu on outside click
  useEffect(() => {
    if (!showExportMenu) return;
    const handleOutside = (e) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target)) {
        setShowExportMenu(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [showExportMenu]);

  // WhatsApp — pre-formatted message with title + first 1000 chars of script
  const handleWhatsApp = useCallback(() => {
    const text = displayText || cleanScript;
    const title = posterTitle || (isHebrew ? 'התסריט שלי' : 'My Script');
    const preview = text.length > 900 ? text.slice(0, 900) + '…' : text;
    const message = isHebrew
      ? `🎬 *${title}*\n\nנוצר ב-LIFESCRIPT STUDIO:\n\n${preview}`
      : `🎬 *${title}*\n\nGenerated by LIFESCRIPT STUDIO:\n\n${preview}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank', 'noopener,noreferrer');
    track('Script Shared', { platform: 'whatsapp', genre, language: lang });
  }, [displayText, cleanScript, posterTitle, isHebrew, genre, lang]);

  // Facebook — shares the current page URL
  const handleFacebook = useCallback(() => {
    const url = encodeURIComponent(typeof window !== 'undefined' ? window.location.href : '');
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${url}`, '_blank', 'noopener,noreferrer,width=600,height=480');
    track('Script Shared', { platform: 'facebook', genre, language: lang });
  }, [genre, lang]);

  // Hollywood-standard print via isolated iframe — main app DOM is never disturbed
  const handlePrintIframe = useCallback(() => {
    const text = displayText || cleanScript;
    const dir = isHebrew ? 'rtl' : 'ltr';
    const title = posterTitle || 'script';

    const formattedLines = text.split('\n').map(line => {
      const trimmed = line.trim();
      if (!trimmed) return '<div class="ls-blank"></div>';
      const isSceneHeader = /^(INT\.|EXT\.|פנים\.|חוץ\.)/i.test(trimmed)
        || (!isHebrew && /^[A-Z][A-Z\s\d.\-:,'"!?]+$/.test(trimmed) && trimmed.length < 60);
      return isSceneHeader
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
    doc.open();
    doc.write(html);
    doc.close();

    const doCleanup = () => {
      iframe.remove();
      iframe.contentWindow?.removeEventListener('afterprint', doCleanup);
    };

    iframe.onload = () => {
      setTimeout(() => {
        iframe.contentWindow?.addEventListener('afterprint', doCleanup);
        iframe.contentWindow?.print();
      }, 250);
    };

    track('Script Exported', { format: 'pdf', genre, language: lang });
  }, [displayText, cleanScript, isHebrew, posterTitle, finalProducerName, genre, lang]);

  // Email — mailto deep link with subject + body
  const handleEmail = useCallback(() => {
    const text = displayText || cleanScript;
    const title = posterTitle || (isHebrew ? 'התסריט שלי' : 'My Script');
    const subject = encodeURIComponent(`🎬 Script: ${title}`);
    const body = encodeURIComponent(text);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    track('Script Shared', { platform: 'email', genre, language: lang });
  }, [displayText, cleanScript, posterTitle, isHebrew, genre, lang]);

  // Native share — navigator.share() with clipboard fallback
  const handleNativeShare = useCallback(async () => {
    const text = displayText || cleanScript;
    const title = posterTitle || (isHebrew ? 'התסריט שלי' : 'My Script');
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title, text });
        track('Script Shared', { platform: 'native', genre, language: lang });
      } catch (err) {
        if (err.name !== 'AbortError') {
          navigator.clipboard?.writeText(text);
        }
      }
    } else {
      navigator.clipboard?.writeText(text);
      track('Script Shared', { platform: 'clipboard-fallback', genre, language: lang });
    }
  }, [displayText, cleanScript, posterTitle, isHebrew, genre, lang]);

  // --- Script Processing ---
  useEffect(() => {
    if (!script) return;
    let processedScript = script.replace(/<br\s*\/?>/gi, '\n');
    const marker = "[image:";
    const markerIndex = processedScript.toLowerCase().indexOf(marker);
    if (markerIndex !== -1) {
      setCleanScript(processedScript.substring(0, markerIndex).trim());
      const endBracketIndex = processedScript.indexOf("]", markerIndex);
      setVisualPrompt(processedScript.substring(markerIndex + marker.length, endBracketIndex).trim());
    } else {
      setCleanScript(processedScript);
      setVisualPrompt("Cinematic masterpiece, dramatic lighting");
    }
    setDisplayText('');
    setShowPoster(false);
    // Reset editor so a new script always starts in read-only mode
    setIsEditing(false);
    setIsEdited(false);
    setEditedText('');
    setSaveStatus('idle');
    clearTimeout(saveDebounceRef.current);
    storyboardActiveRef.current = false;
    setShowStoryboard(false);
    setStoryboardPanels([]);
    setStoryboardError('');
    dispatchPanelImages({ type: 'RESET' });
  }, [script]);

  // --- Typing Engine ---
  useEffect(() => {
    if (!cleanScript) return;
    setIsTyping(true);
    setIsTypingGlobal?.(true);
    let i = 0;
    const typeChar = () => {
  if (i >= cleanScript.length) {
    setIsTyping(false);
    setIsTypingGlobal?.(false);
    return;
  }

  const currentText = cleanScript.substring(0, i + 1);
  setDisplayText(currentText);

  // הפעלת סאונד: כל תו שני שאינו רווח
  if (cleanScript[i] && !/\s/.test(cleanScript[i]) && i % 2 === 0) {
    playSound();
  }

  if (i > 15 && scrollRef.current && !isAutoScrollPaused.current) {
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }

  i++;
  timerRef.current = setTimeout(typeChar, 40);
};
    typeChar();
    return () => {
      clearTimeout(timerRef.current);
      setIsTypingGlobal?.(false);
    };
  }, [cleanScript]);

  // --- Poster Generation ---
  const generatePoster = async () => { 
    setPosterLoading(true);
    setPosterError('');
    setShowPoster(true);
    const genreTag = translateGenre(genre);
    const prompt = `A textless movie poster style, depicting: ${visualPrompt}. Genre: ${genreTag}. High budget Hollywood production, epic scale, 8k, ultra-detailed, sharp focus. (NO TEXT)`;
    
    try {
      const response = await fetch('/api/generate-poster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, genre, lang }), 
      });
      const data = await response.json();
      if (response.status === 429) {
        setPosterError(lang === 'he' ? "🎬 המכסה היומית נוצלה - נתראה מחר בבכורה!" : "🎬 Daily quota reached!");
        setPosterLoading(false);
        return;
      }
      if (data.success) {
        setPosterUrl(data.imageUrl);
        onPosterGenerated?.(data.imageUrl);
      } else { throw new Error(data.message); }
    } catch (error) {
      const fallbackUrl = `https://pollinations.ai/p/${encodeURIComponent(prompt)}?width=1024&height=1024&seed=${Math.random()}&model=flux`;
      setPosterUrl(fallbackUrl);
      onPosterGenerated?.(fallbackUrl);
    }
  };

  const storyboardLoadingMessages = useMemo(() => isHebrew ? [
    'סורק סצנות...', 'ממפה פאנלים...', 'מדפיס קווי דיו...', 'מסיים ציורים...'
  ] : [
    'Scanning scenes...', 'Mapping panels...', 'Inking drawings...', 'Composing frames...'
  ], [isHebrew]);

  const comicStyleOptions = useMemo(() => isHebrew ? [
    { value: 'anime', label: 'אנימה סטודיו' },
    { value: 'marvel', label: 'מארוול רטרו' },
    { value: 'noir', label: 'נואר קולנועי' }
  ] : [
    { value: 'anime', label: 'ANIME STUDIO' },
    { value: 'marvel', label: 'MARVEL RETRO' },
    { value: 'noir', label: 'CINEMATIC NOIR' }
  ], [isHebrew]);

  useEffect(() => {
    if (!storyboardLoading) { setStoryboardMsgIdx(0); return; }
    const id = setInterval(() => setStoryboardMsgIdx(p => (p + 1) % storyboardLoadingMessages.length), 2200);
    return () => clearInterval(id);
  }, [storyboardLoading, storyboardLoadingMessages.length]);

  const generateStoryboardImages = async (panels) => {
    // Opt 5: single INIT_ALL dispatch flips all skeletons to loading in one render cycle,
    // replacing the N individual setPanelImages(loading:true) calls that each triggered a re-render.
    dispatchPanelImages({ type: 'INIT_ALL', count: panels.length });
    await Promise.allSettled(
      panels.map(async (panel, idx) => {
        if (!storyboardActiveRef.current) return;
        try {
          const resp = await fetch('/api/generate-poster', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: panel.visual, genre, lang, requestType: 'comic' }),
          });
          const data = await resp.json();
          if (!storyboardActiveRef.current) return;
          if (data.success && data.imageUrl) {
            dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: data.imageUrl, error: false } });
          } else {
            dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: null, error: true } });
          }
        } catch {
          if (!storyboardActiveRef.current) return;
          dispatchPanelImages({ type: 'SET_PANEL', idx, payload: { loading: false, url: null, error: true } });
        }
      })
    );
  };

  const generateStoryboard = async () => {
    storyboardActiveRef.current = false;
    dispatchPanelImages({ type: 'RESET' });
    setStoryboardLoading(true);
    setStoryboardError('');
    try {
      const response = await fetch('/api/generate-storyboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ script: cleanScript, lang, genre, comicStyle }),
      });
      const data = await response.json();
      if (data.success && data.panels?.length > 0) {
        storyboardActiveRef.current = true;
        setStoryboardPanels(data.panels);
        setShowStoryboard(true);
        track('Storyboard Generated', { genre, language: lang });
        generateStoryboardImages(data.panels);
      } else {
        throw new Error(data.error || 'Generation failed');
      }
    } catch (err) {
      setStoryboardError(isHebrew ? 'יצירת הסטוריבורד נכשלה. נסה שוב.' : 'Storyboard generation failed. Please try again.');
    } finally {
      setStoryboardLoading(false);
    }
  };

  const handleCapturePoster = async (action) => {
    if (!posterRef.current || !posterUrl) return;
    
    track(action === 'download' ? 'Poster Downloaded' : 'Poster Shared', {
      genre: genre,
      language: lang,
      title: posterTitle
    });
    if (typeof window !== 'undefined' && window.gtag) {
      window.gtag('event', 'content_export', {
        method: action,
        genre: genre,
        title: posterTitle
      });
    }

    try {
      const img = posterRef.current.querySelector('img');
      if (img) await img.decode().catch(() => {});
      
      await new Promise(r => setTimeout(r, 400));

      // מדידה מדויקת ועיגול מספרים למניעת חיתוך ברמת הפיקסל
      const rect = posterRef.current.getBoundingClientRect();
      const width = Math.floor(rect.width);
      const height = Math.floor(rect.height);

      // הגדרות משותפות לשני הצילומים כדי למנוע שגיאות כפולות
      const sharedOptions = {
        width: width,
        height: height,
        quality: 0.95,
        pixelRatio: 2,
        skipFonts: true,
        fontEmbedCSS: '',
        cacheBust: false,
        // ה-Filter כאן ימנע את הודעות השגיאה בטרמינל
        filter: (node) => {
          const tagName = node.tagName ? node.tagName.toUpperCase() : '';
          if (tagName === 'LINK' || tagName === 'STYLE') {
            // חוסם גישה למשאבים חיצוניים שגורמים ל-SecurityError
            if (node.href && !node.href.includes(window.location.hostname)) return false;
          }
          return true;
        },
        style: {
          transform: 'scale(1)',
          margin: '0',        // מבטל את ה-mx-auto שגורם לחיתוך
          padding: '0',
          left: '0',
          top: '0',
          borderRadius: '3.5rem', // שומר על היוקרה בתוצאה הסופית
          overflow: 'visible'
        }
      };

      // --- צילום 1: חימום (כעת עם ה-Filter כדי למנוע את השגיאה הראשונה) ---
      await htmlToImage.toPng(posterRef.current, { ...sharedOptions, quality: 0.1 });
      
      // --- צילום 2: האמיתי ---
      const dataUrl = await htmlToImage.toPng(posterRef.current, sharedOptions);
      
      if (action === 'download') {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `poster-${posterTitle.replace(/\s+/g, '-') || 'movie-poster'}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else if (action === 'share') {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        const file = new File([blob], 'movie-poster.png', { type: 'image/png' });

        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
           try {
            await navigator.share({ files: [file], title: posterTitle || 'הפוסטר שלי' });
          } catch (shareErr) {
            if (shareErr.name !== 'AbortError') throw shareErr;
            // אם זה AbortError - אנחנו פשוט לא עושים כלום, המשתמש סגר את החלונית
          }
       } else {
          const link = document.createElement('a');
          link.href = dataUrl;
          link.download = 'poster.png';
          link.click();
        }
      }
    } catch (err) {
      console.error("Critical Capture Error:", err);
      if (posterUrl) window.open(posterUrl, '_blank');
    }
  };

  // Single source for download / copy — reflects committed edits
  const currentScriptText = displayText || cleanScript;

  return (
    <div className="space-y-6 w-full max-w-[100vw]">
      {/* Toolbar */}
      <div className="flex justify-between items-center px-6 h-14">
        <div className="flex items-center gap-2">
          <Film size={18} className="text-[#d4a373]" />
          <h2 className="text-[#d4a373] font-black uppercase text-[10px] tracking-widest italic">LIFESCRIPT STUDIO</h2>
        </div>

        <div className="flex items-center gap-2">
          {/* Typewriter skip */}
          {isTyping && (
            <button
              onClick={() => { clearTimeout(timerRef.current); setDisplayText(cleanScript); setIsTyping(false); setIsTypingGlobal?.(false); }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#d4a373]/20 border border-[#d4a373]/40 rounded-full text-[10px] text-[#d4a373] font-bold"
            >
              <FastForward size={12} /> {isHebrew ? 'דלג' : 'SKIP'}
            </button>
          )}

          {/* Edit-mode controls (only after typewriter finishes) */}
          <AnimatePresence mode="wait">
            {!isTyping && displayText.length > 0 && (
              isEditing ? (
                <motion.div
                  key="edit-active"
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.15 }}
                  className="flex items-center gap-1.5"
                >
                  {/* Revert */}
                  <button
                    onClick={handleEditRevert}
                    title={isHebrew ? 'בטל עריכה' : 'Revert to original'}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-white/5 border border-white/10 rounded-xl text-gray-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/8 transition-all duration-200 text-[9px] font-black uppercase tracking-wider"
                  >
                    <RotateCcw size={12} />
                    <span className="hidden sm:inline">{isHebrew ? 'שחזר' : 'Revert'}</span>
                  </button>
                  {/* Done */}
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
                  initial={{ opacity: 0, scale: 0.92 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.92 }}
                  transition={{ duration: 0.15 }}
                  onClick={() => { setEditedText(displayText); setIsEditing(true); }}
                  title={isHebrew ? 'ערוך תסריט' : 'Edit script'}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 border rounded-xl text-[9px] font-black uppercase tracking-wider transition-all duration-200
                    ${isEdited
                      ? 'border-[#d4a373]/40 bg-[#d4a373]/10 text-[#d4a373] hover:bg-[#d4a373]/20'
                      : 'border-white/10 bg-white/5 text-gray-500 hover:text-[#d4a373] hover:border-[#d4a373]/30 hover:bg-[#d4a373]/8'
                    }`}
                >
                  <Pencil size={12} />
                  <span className="hidden sm:inline">
                    {isEdited
                      ? (isHebrew ? 'ערוך שוב' : 'Re-edit')
                      : (isHebrew ? 'עריכה' : 'Edit')}
                  </span>
                </motion.button>
              )
            )}
          </AnimatePresence>

          {/* Mute */}
          <button onClick={() => setIsMuted(!isMuted)} className="p-2.5 bg-white/5 border border-white/10 rounded-xl">
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
              <ChevronDown
                size={11}
                className={`transition-transform duration-200 ${showExportMenu ? 'rotate-180' : ''}`}
              />
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
                  {/* Copy Text */}
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(currentScriptText);
                      setIsCopied(true);
                      setShowExportMenu(false);
                      track('Script Exported', { format: 'copy', genre, language: lang });
                      setTimeout(() => setIsCopied(false), 2000);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-[10.5px] font-bold uppercase tracking-wider text-gray-300 hover:text-[#d4a373] hover:bg-[#d4a373]/8 transition-colors duration-150"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    {isCopied
                      ? <Check size={13} className="text-green-400 shrink-0" />
                      : <Copy size={13} className="text-[#d4a373]/50 shrink-0" />
                    }
                    {isCopied
                      ? (isHebrew ? 'הועתק!' : 'Copied!')
                      : (isHebrew ? 'העתק טקסט' : 'Copy Text')
                    }
                  </button>

                  <div className="h-px bg-white/5 mx-3" />

                  {/* Download .txt */}
                  <button
                    onClick={() => {
                      const blob = new Blob([currentScriptText], { type: 'text/plain;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const link = document.createElement('a');
                      link.href = url;
                      link.download = `${posterTitle || 'script'}.txt`;
                      document.body.appendChild(link);
                      link.click();
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

                  {/* Export PDF / Print */}
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

      {/* Script View */}
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
          onWheel={() => {
            isAutoScrollPaused.current = true;
            if (pauseTimer.current) clearTimeout(pauseTimer.current);
            pauseTimer.current = setTimeout(() => { isAutoScrollPaused.current = false; }, 4000);
          }}
        >
          {isEditing ? (
            /* ── Live editor ─────────────────────────────────────────── */
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
            /* ── Read-only / typewriter display ─────────────────────── */
            <div
              className={`script-font text-xl md:text-3xl leading-[2.5] text-gray-100 whitespace-pre-wrap pb-40
                ${isHebrew ? 'text-right' : 'text-left'}`}
            >
              {displayText}
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

        {/* Bottom status badge — hidden during editing to avoid textarea overlap */}
        <AnimatePresence mode="wait">
          {!isTyping && !isEditing && displayText.length > 0 && (
            <motion.div
              key={isEdited ? 'edited' : 'complete'}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.25 }}
              className="absolute bottom-5 left-0 right-0 px-6 flex justify-between items-end z-30"
            >
              <div className="flex items-center gap-2">
                {isEdited ? (
                  <>
                    <Pencil size={11} className="text-[#d4a373]" />
                    <span className="text-[#d4a373] text-[12px] font-bold tracking-wider">
                      {isHebrew ? 'נערך ידנית' : 'EDITED'}
                    </span>
                  </>
                ) : (
                  <>
                    <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                    <span className="text-[#d4a373] text-[12px] font-bold">
                      {isHebrew ? 'ההפקה סיימה' : 'PRODUCTION COMPLETE'}
                    </span>
                  </>
                )}
              </div>
              <img src="/icon.png" className="w-8 h-8 object-contain opacity-50" alt="icon" />
            </motion.div>
          )}

          {/* Auto-save flash — appears briefly after debounced write */}
          {saveStatus === 'saved' && (
            <motion.div
              key="save-flash"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.2 }}
              className="absolute bottom-5 right-6 z-30 flex items-center gap-1.5 text-[#d4a373]/60 text-[10px] font-black uppercase tracking-widest"
            >
              <CheckCheck size={11} />
              {isHebrew ? 'נשמר' : 'Saved'}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {!isTyping && displayText.length > 0 && (!showPoster || !showStoryboard) && (
        <div className="py-6 px-4 space-y-3">
          {!showStoryboard && !storyboardLoading && (
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {comicStyleOptions.map(opt => (
                <button key={opt.value} onClick={() => setComicStyle(opt.value)} className={`px-3.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-200 ${comicStyle === opt.value ? 'bg-[#d4a373]/20 border border-[#d4a373]/60 text-[#d4a373]' : 'bg-white/[0.04] border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20'}`}>
                  {opt.label}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-3">
            {!showPoster && (
              <button onClick={generatePoster} disabled={posterLoading} className={`${showStoryboard ? 'w-full' : 'flex-1'} bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black py-4 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-60 transition-opacity`}>
                {posterLoading ? <Loader2 size={18} className="animate-spin" /> : <span>{isHebrew ? 'צור פוסטר קולנועי' : 'GENERATE MOVIE POSTER'}</span>}
              </button>
            )}
            {!showStoryboard && (
              <button onClick={generateStoryboard} disabled={storyboardLoading} className={`${showPoster ? 'w-full' : 'flex-1'} border border-[#d4a373]/40 bg-[#050710] text-[#d4a373] font-black py-4 rounded-2xl flex items-center justify-center gap-2 hover:bg-[#d4a373]/10 hover:border-[#d4a373]/70 transition-all duration-300 disabled:opacity-60`}>
                {storyboardLoading ? <Clapperboard size={18} className="animate-spin text-[#d4a373]/60" /> : <><Clapperboard size={18} /><span>{isHebrew ? 'צור קומיקס' : 'GENERATE COMIC STORYBOARD'}</span></>}
              </button>
            )}
          </div>
        </div>
      )}
      <AnimatePresence>
        {storyboardError && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mx-4 px-5 py-3.5 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-[12px] font-medium text-center">
            {storyboardError}
          </motion.div>
        )}
      </AnimatePresence>

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
  lang={lang}
  genre={genre}
  posterLoadingMessages={posterLoadingMessages[loadingMessageIndex]}
  setTriggerFlash={setTriggerFlash}
  setPosterLoading={setPosterLoading}
  playFlashSound={playFlashSound}   // <-- הוספת ה‑prop
/>
          </div>
        )}
      </AnimatePresence>

      {/* ── Storyboard Loading Skeleton ──────────────────────────── */}
      <AnimatePresence>
        {storyboardLoading && !showStoryboard && (
          <motion.div key="storyboard-skeleton" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }} transition={{ duration: 0.55, ease: 'easeOut' }} className="mx-2 md:mx-4 mt-6 bg-[#030712]/90 border border-white/5 rounded-[2.5rem] overflow-hidden">
            <div className="flex items-center justify-between px-7 py-5 border-b border-[#d4a373]/10">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-[#d4a373]/10 shrink-0">
                  <Clapperboard size={14} className="text-[#d4a373] animate-pulse" />
                </div>
                <div>
                  <h3 className="text-[#d4a373] font-black uppercase text-[10px] tracking-[0.35em]">
                    {isHebrew ? 'בונה קומיקס' : 'BUILDING STORYBOARD'}
                  </h3>
                  <p className="text-gray-500 text-[9px] tracking-widest mt-0.5 uppercase">
                    {storyboardLoadingMessages[storyboardMsgIdx]}
                  </p>
                </div>
              </div>
            </div>
            <div className="p-5 md:p-7">
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
                {[0, 1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="bg-[#050710] border border-[#d4a373]/8 rounded-[1.75rem] overflow-hidden">
                    <div className="relative aspect-[3/2] bg-[#02040a] overflow-hidden">
                      <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/[0.035] to-transparent skew-x-12 pointer-events-none" animate={{ x: ['-150%', '220%'] }} transition={{ repeat: Infinity, duration: 2.4, ease: 'linear', delay: i * 0.12 }} />
                      <div className="absolute top-3 left-3 h-5 w-16 bg-[#d4a373]/8 rounded-lg" />
                    </div>
                    <div className="p-4 space-y-2">
                      <div className="h-3 bg-white/5 rounded-full w-4/5" />
                      <div className="h-2.5 bg-white/[0.03] rounded-full w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Storyboard View ───────────────────────────────────────── */}
      <AnimatePresence>
        {showStoryboard && storyboardPanels.length > 0 && (
          <StoryboardView
            key="storyboard-view"
            panels={storyboardPanels}
            lang={lang}
            panelImages={panelImages}
            onClose={() => { storyboardActiveRef.current = false; setShowStoryboard(false); setStoryboardPanels([]); dispatchPanelImages({ type: 'RESET' }); }}
          />
        )}
      </AnimatePresence>

      {/* ── Distribution Hub Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {showShareModal && (
          <>
            {/* Backdrop */}
            <motion.div
              key="share-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
              className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm"
              onClick={() => setShowShareModal(false)}
            />

            {/* Panel */}
            <motion.div
              key="share-modal"
              initial={{ opacity: 0, scale: 0.88, y: 24 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: 24 }}
              transition={{ type: 'spring', stiffness: 400, damping: 36, mass: 0.75 }}
              className="fixed inset-0 z-[2001] flex items-center justify-center p-5 pointer-events-none"
            >
              <div className="w-full max-w-[340px] pointer-events-auto rounded-[2rem] overflow-hidden bg-[#07070f]/98 backdrop-blur-3xl border border-[#d4a373]/12 shadow-[0_48px_120px_rgba(0,0,0,0.9),0_0_0_1px_rgba(212,163,115,0.07)]">
                {/* Header */}
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

                {/* Options */}
                <div className="p-3 space-y-2">
                  {/* WhatsApp */}
                  <button
                    onClick={() => { handleWhatsApp(); setShowShareModal(false); }}
                    className="flex items-center gap-4 w-full px-4 py-[14px] rounded-[1.1rem] bg-white/[0.03] border border-white/[0.06] hover:border-[#25D366]/35 hover:bg-[#25D366]/[0.07] transition-all duration-200 group"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#25D366]/10 border border-[#25D366]/20 text-[#25D366] shrink-0 group-hover:bg-[#25D366]/18 transition-colors duration-200">
                      <WhatsAppIcon />
                    </div>
                    <div>
                      <p className="text-white font-bold text-[13px] leading-none mb-[5px]">
                        {isHebrew ? 'שלח בוואטסאפ' : 'Send via WhatsApp'}
                      </p>
                      <p className="text-gray-500 text-[11px] leading-none">
                        {isHebrew ? 'שתף עם חברים ישירות' : 'Share directly with friends'}
                      </p>
                    </div>
                  </button>

                  {/* Facebook */}
                  <button
                    onClick={() => { handleFacebook(); setShowShareModal(false); }}
                    className="flex items-center gap-4 w-full px-4 py-[14px] rounded-[1.1rem] bg-white/[0.03] border border-white/[0.06] hover:border-[#1877F2]/35 hover:bg-[#1877F2]/[0.07] transition-all duration-200 group"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#1877F2]/10 border border-[#1877F2]/20 text-[#1877F2] shrink-0 group-hover:bg-[#1877F2]/18 transition-colors duration-200">
                      <FacebookIcon />
                    </div>
                    <div>
                      <p className="text-white font-bold text-[13px] leading-none mb-[5px]">
                        {isHebrew ? 'שתף בפייסבוק' : 'Share on Facebook'}
                      </p>
                      <p className="text-gray-500 text-[11px] leading-none">
                        {isHebrew ? 'פרסם את ההפקה בפיד' : 'Post your production to your feed'}
                      </p>
                    </div>
                  </button>

                  {/* Print / PDF */}
                  <button
                    onClick={() => { handlePrintIframe(); setShowShareModal(false); }}
                    className="flex items-center gap-4 w-full px-4 py-[14px] rounded-[1.1rem] bg-white/[0.03] border border-white/[0.06] hover:border-[#d4a373]/35 hover:bg-[#d4a373]/[0.07] transition-all duration-200 group"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#d4a373]/10 border border-[#d4a373]/20 text-[#d4a373] shrink-0 group-hover:bg-[#d4a373]/18 transition-colors duration-200">
                      <Printer size={19} />
                    </div>
                    <div>
                      <p className="text-white font-bold text-[13px] leading-none mb-[5px]">
                        {isHebrew ? 'הדפסה / שמור כ-PDF' : 'Print / Save as PDF'}
                      </p>
                      <p className="text-gray-500 text-[11px] leading-none">
                        {isHebrew ? 'פורמט תסריט הוליוודי סטנדרטי' : 'Hollywood-standard screenplay format'}
                      </p>
                    </div>
                  </button>

                  {/* Email */}
                  <button
                    onClick={() => { handleEmail(); setShowShareModal(false); }}
                    className="flex items-center gap-4 w-full px-4 py-[14px] rounded-[1.1rem] bg-white/[0.03] border border-white/[0.06] hover:border-violet-500/35 hover:bg-violet-500/[0.07] transition-all duration-200 group"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20 text-violet-400 shrink-0 group-hover:bg-violet-500/18 transition-colors duration-200">
                      <Mail size={19} />
                    </div>
                    <div>
                      <p className="text-white font-bold text-[13px] leading-none mb-[5px]">
                        {isHebrew ? 'שלח באימייל' : 'Send via Email'}
                      </p>
                      <p className="text-gray-500 text-[11px] leading-none">
                        {isHebrew ? 'פתח אפליקציית דואר עם התסריט' : 'Open your mail app with the script'}
                      </p>
                    </div>
                  </button>

                  {/* Native share / copy fallback */}
                  <button
                    onClick={() => { handleNativeShare(); setShowShareModal(false); }}
                    className="flex items-center gap-4 w-full px-4 py-[14px] rounded-[1.1rem] bg-white/[0.03] border border-white/[0.06] hover:border-sky-400/35 hover:bg-sky-400/[0.07] transition-all duration-200 group"
                    style={{ textAlign: isHebrew ? 'right' : 'left' }}
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-sky-400/10 border border-sky-400/20 text-sky-400 shrink-0 group-hover:bg-sky-400/18 transition-colors duration-200">
                      <NotebookPen size={19} />
                    </div>
                    <div>
                      <p className="text-white font-bold text-[13px] leading-none mb-[5px]">
                        {isHebrew ? 'שמור / שתף טקסט' : 'Save to Notes / Share Text'}
                      </p>
                      <p className="text-gray-500 text-[11px] leading-none">
                        {isHebrew ? 'שיתוף נייטיב או העתקה לקליפבורד' : 'Native share sheet or clipboard copy'}
                      </p>
                    </div>
                  </button>
                </div>

                {/* Footer */}
                <div className="px-6 py-3 border-t border-white/[0.05] flex items-center justify-center gap-1.5">
                  <Film size={10} className="text-[#d4a373]/30" />
                  <span className="text-[#d4a373]/30 text-[8.5px] font-black uppercase tracking-[0.22em]">
                    LIFESCRIPT STUDIO
                  </span>
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