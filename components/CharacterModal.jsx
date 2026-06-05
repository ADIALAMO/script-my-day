import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Loader2, Camera, Sparkles, RefreshCw, Crown } from 'lucide-react';

// Downscale a selected file to a JPEG data URI (max 1024px, q0.9) before upload.
// Keeps the request well under the endpoint's body limit and trims R2/latency cost.
function fileToDownscaledDataUri(file, maxDim = 1024, quality = 0.9) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width  = Math.round(width  * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * One-time character setup modal. Flow: pick selfie → preview → "casting" loader
 * (the two-stage Grok pipeline) → Character Sheet result → confirm.
 *
 * Props:
 *   isOpen, onClose, lang
 *   status            'idle'|'loading'|'ready'|'error' (from useCharacter)
 *   characterImageUrl current styled sheet URL (from useCharacter)
 *   uploadCharacter   (selfieBase64) => Promise<{ok, code?}>
 *   clearCharacter    () => void
 *   onUpgrade         () => void   — called when the API gates a free user (403)
 */
export default function CharacterModal({
  isOpen, onClose, lang,
  status, characterImageUrl, uploadCharacter, clearCharacter, onUpgrade,
  gender, setGender,
}) {
  const isHebrew = lang === 'he';

  const genderOptions = isHebrew
    ? [{ value: 'male', label: 'גבר' }, { value: 'female', label: 'אישה' }, { value: 'neutral', label: 'ניטרלי' }]
    : [{ value: 'male', label: 'Man' }, { value: 'female', label: 'Woman' }, { value: 'neutral', label: 'Neutral' }];
  const [picked,    setPicked]    = useState('');   // selected selfie (pre-create)
  const [changing,  setChanging]  = useState(false); // "change photo" override
  const [fileError, setFileError] = useState('');
  const [gated,     setGated]     = useState(false); // free-tier 403
  const fileInputRef = useRef(null);

  // Body scroll lock — same pattern as the Distribution Hub modal.
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [isOpen]);

  // Reset transient state whenever the modal opens.
  useEffect(() => {
    if (isOpen) { setPicked(''); setChanging(false); setFileError(''); setGated(false); }
  }, [isOpen]);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setFileError(isHebrew ? 'בחר קובץ תמונה' : 'Please choose an image file');
      return;
    }
    setFileError('');
    try {
      const dataUri = await fileToDownscaledDataUri(file);
      setPicked(dataUri);
      setChanging(false);
    } catch {
      setFileError(isHebrew ? 'לא ניתן לקרוא את התמונה' : 'Could not read that image');
    }
  }, [isHebrew]);

  const handleCreate = useCallback(async () => {
    const result = await uploadCharacter(picked);
    if (result.ok) {
      setPicked(''); // fall through to the result view (shows the new sheet)
    } else if (result.code === 'NEEDS_PRO') {
      setGated(true);
    } else {
      setFileError(isHebrew ? 'משהו השתבש. נסה שוב.' : 'Something went wrong. Try again.');
    }
  }, [picked, uploadCharacter, isHebrew]);

  // ── View resolution ──────────────────────────────────────────────────────────
  const showLoading = status === 'loading';
  const showResult  = !showLoading && !gated && characterImageUrl && !picked && !changing;
  const showPreview = !showLoading && !gated && !!picked;
  const showPick    = !showLoading && !gated && !picked && (changing || !characterImageUrl);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="char-backdrop"
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        className="fixed inset-0 z-[2000] bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        key="char-modal"
        initial={{ opacity: 0, scale: 0.88, y: 24 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.88, y: 24 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36, mass: 0.75 }}
        className="fixed inset-0 z-[2001] flex items-center justify-center p-4 md:p-6 pointer-events-none"
        dir={isHebrew ? 'rtl' : 'ltr'}
      >
        <div className="w-full max-w-[360px] pointer-events-auto rounded-[2rem] overflow-hidden bg-[#07070f]/98 backdrop-blur-3xl border border-[#d4a373]/12 shadow-[0_48px_120px_rgba(0,0,0,0.9),0_0_0_1px_rgba(212,163,115,0.07)]">

          {/* Header */}
          <div className="relative px-6 pt-6 pb-5 border-b border-white/[0.05]">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={12} className="text-[#d4a373]/70" />
              <span className="text-[#d4a373]/70 text-[9px] font-black uppercase tracking-[0.2em]">
                {isHebrew ? 'ליהוק הדמות' : 'Cast Your Character'}
              </span>
            </div>
            <p className="text-white font-black text-[17px] leading-tight pr-8">
              {isHebrew ? 'כיכב בסיפור שלך' : 'Star in your own story'}
            </p>
            <button
              onClick={onClose}
              className="absolute top-[22px] left-5 rtl:left-auto rtl:right-5 w-7 h-7 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-gray-500 hover:text-white transition-all duration-150"
              style={isHebrew ? { left: 'auto', right: '1.25rem' } : {}}
            >
              <X size={13} />
            </button>
          </div>

          <div className="p-6">

            {/* ── Gated (free tier) ── */}
            {gated && (
              <div className="flex flex-col items-center text-center gap-4 py-2">
                <div className="w-14 h-14 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/30 flex items-center justify-center">
                  <Crown size={24} className="text-[#d4a373]" />
                </div>
                <p className="text-white font-bold text-[14px]">
                  {isHebrew ? 'ליהוק עצמי הוא פיצ׳ר Pro' : 'Casting yourself is a Pro feature'}
                </p>
                <p className="text-gray-500 text-[11.5px] leading-relaxed">
                  {isHebrew
                    ? 'שדרג ל-Pro כדי להפוך לגיבור של הקומיקס והפוסטרים שלך.'
                    : 'Upgrade to Pro to become the hero of your comics and posters.'}
                </p>
                <button
                  onClick={() => { onClose(); onUpgrade?.(); }}
                  className="w-full bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black py-3 rounded-2xl text-[12px] uppercase tracking-wider"
                >
                  {isHebrew ? 'שדרג ל-Pro' : 'Upgrade to Pro'}
                </button>
              </div>
            )}

            {/* ── Pick ── */}
            {showPick && (
              <div className="flex flex-col items-center gap-4">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="group w-full aspect-square rounded-[1.5rem] border-2 border-dashed border-[#d4a373]/30 hover:border-[#d4a373]/60 bg-[#d4a373]/[0.03] hover:bg-[#d4a373]/[0.06] transition-all duration-300 flex flex-col items-center justify-center gap-3"
                >
                  <div className="w-14 h-14 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/25 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <Camera size={24} className="text-[#d4a373]" />
                  </div>
                  <p className="text-[#d4a373] font-bold text-[12px]">
                    {isHebrew ? 'העלה סלפי ברור' : 'Upload a clear selfie'}
                  </p>
                  <p className="text-gray-600 text-[10px] px-8 text-center leading-relaxed">
                    {isHebrew ? 'פנים חזיתיות, תאורה טובה, פנים בודדות' : 'Front-facing, well-lit, single face'}
                  </p>
                </button>
                {characterImageUrl && (
                  <button onClick={() => setChanging(false)} className="text-gray-500 hover:text-gray-300 text-[10px] font-bold uppercase tracking-wider">
                    {isHebrew ? '← חזור' : '← Back'}
                  </button>
                )}
              </div>
            )}

            {/* ── Preview (confirm create) ── */}
            {showPreview && (
              <div className="flex flex-col items-center gap-4">
                <div className="w-full aspect-square rounded-[1.5rem] overflow-hidden border border-white/10">
                  <img src={picked} alt="selfie preview" className="w-full h-full object-cover" />
                </div>
                <p className="text-gray-500 text-[10.5px] text-center leading-relaxed px-2">
                  {isHebrew
                    ? 'ניצור גיליון דמות מסוגנן מהתמונה (לוקח כ-15 שניות).'
                    : "We'll craft a stylized character sheet from this (~15s)."}
                </p>
                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => setPicked('')}
                    className="flex-1 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-gray-400 hover:text-white text-[11px] font-black uppercase tracking-wider"
                  >
                    {isHebrew ? 'תמונה אחרת' : 'Another photo'}
                  </button>
                  <button
                    onClick={handleCreate}
                    className="flex-[1.5] py-3 rounded-2xl bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black text-[11px] uppercase tracking-wider flex items-center justify-center gap-2"
                  >
                    <Sparkles size={14} /> {isHebrew ? 'צור דמות' : 'Create character'}
                  </button>
                </div>
              </div>
            )}

            {/* ── Casting loader ── */}
            {showLoading && (
              <div className="flex flex-col items-center gap-4 py-6">
                <div className="relative w-20 h-20">
                  <div className="absolute inset-0 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/25" />
                  <Loader2 size={32} className="animate-spin text-[#d4a373] absolute inset-0 m-auto" />
                </div>
                <p className="text-[#d4a373] font-bold text-[13px]">
                  {isHebrew ? 'מליהק אותך לסיפור...' : 'Casting you into the story...'}
                </p>
                <p className="text-gray-600 text-[10px]">
                  {isHebrew ? 'בדיקת בטיחות · יצירת גיליון דמות' : 'Safety check · Generating character sheet'}
                </p>
              </div>
            )}

            {/* ── Result (the character sheet) ── */}
            {showResult && (
              <div className="flex flex-col items-center gap-4">
                <div className="relative w-full aspect-square rounded-[1.5rem] overflow-hidden border border-[#d4a373]/30 shadow-[0_0_30px_rgba(212,163,115,0.12)]">
                  <img src={characterImageUrl} alt="your character" className="w-full h-full object-cover" />
                  <span className="absolute bottom-3 right-3 w-7 h-7 rounded-full bg-[#d4a373] text-black flex items-center justify-center shadow-lg">
                    <Check size={15} />
                  </span>
                </div>
                <p className="text-white font-bold text-[13px] text-center">
                  {isHebrew ? 'זאת הדמות שלך 🎭' : 'This is your character 🎭'}
                </p>

                {/* Gender selector — drives the per-panel disambiguation descriptor */}
                <div className="w-full">
                  <p className="text-gray-500 text-[9px] font-black uppercase tracking-[0.18em] text-center mb-2">
                    {isHebrew ? 'איך להציג אותך בפאנלים?' : 'How should we portray you?'}
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    {genderOptions.map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setGender?.(opt.value)}
                        className={`px-3.5 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all duration-200
                          ${gender === opt.value
                            ? 'bg-[#d4a373]/20 border border-[#d4a373]/60 text-[#d4a373]'
                            : 'bg-white/[0.04] border border-white/10 text-gray-500 hover:text-gray-300 hover:border-white/20'
                          }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => setChanging(true)}
                    className="flex-1 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-gray-400 hover:text-white text-[11px] font-black uppercase tracking-wider flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw size={13} /> {isHebrew ? 'החלף' : 'Change'}
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-[1.5] py-3 rounded-2xl bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black text-[11px] uppercase tracking-wider"
                  >
                    {isHebrew ? 'השתמש בסיפור' : 'Use in my story'}
                  </button>
                </div>
              </div>
            )}

            {fileError && (
              <p className="mt-4 text-red-400 text-[11px] text-center">{fileError}</p>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </div>

          {/* Footer brand */}
          <div className="px-6 py-3 border-t border-white/[0.05] flex items-center justify-center gap-1.5">
            <Sparkles size={10} className="text-[#d4a373]/30" />
            <span className="text-[#d4a373]/30 text-[8.5px] font-black uppercase tracking-[0.22em]">LIFESCRIPT STUDIO</span>
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
