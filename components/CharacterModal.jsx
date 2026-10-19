import React, { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Check, Loader2, Camera, Sparkles, RefreshCw, Crown, ShieldCheck } from 'lucide-react';
import { isCapacitorNative } from '../utils/platform.js';
import { getMsg, CODES } from '../lib/messages.js';

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
 *   uploadCharacter   (selfieBase64, consent) => Promise<{ok, code?}>
 *   adultConfirmed    this ACCOUNT already declared "I am 18 or older" (server-side, asked once); until then only the 18+ step is shown
 *   confirmAdult      () => Promise<{ok, code?}> — records the declaration for the account
 *   clearCharacter    () => void
 *   removeCharacter   () => Promise<{ok, code?}> — deletes the photo/sheet and the saved pointer on the server (owner only)
 */
export default function CharacterModal({
  isOpen, onClose, lang,
  status, characterImageUrl, uploadCharacter, clearCharacter, removeCharacter, adultConfirmed, confirmAdult,
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
  const [consented, setConsented] = useState(false); // biometric consent gate (pre-create)
  const [removeStep, setRemoveStep] = useState('idle'); // 'idle' | 'confirm' | 'busy' — owner-only "Remove my character"
  const [adultOk,   setAdultOk]   = useState(false); // the checkbox of the one-time 18+ step (a self-declaration, not age verification)
  const [adultBusy, setAdultBusy] = useState(false);
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
    if (isOpen) { setPicked(''); setChanging(false); setFileError(''); setGated(false); setConsented(false); setRemoveStep('idle'); setAdultOk(false); setAdultBusy(false); }
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
      setConsented(false); // require fresh biometric consent for each uploaded photo (the 18+ declaration is asked once per account, not here)
    } catch {
      setFileError(isHebrew ? 'לא ניתן לקרוא את התמונה' : 'Could not read that image');
    }
  }, [isHebrew]);

  const handleCreate = useCallback(async () => {
    if (!consented) return; // biometric consent is mandatory (the server also requires the account's 18+ confirmation)
    const result = await uploadCharacter(picked, consented);
    if (result.ok) {
      setPicked(''); // fall through to the result view (shows the new sheet)
    } else if (result.code === 'ADULT_CONFIRMATION_REQUIRED') {
      setPicked(''); // the server says this account has not confirmed 18+: the store flipped adultConfirmed → the 18+ step is shown
    } else if (result.code === 'NEEDS_PRO') {
      setGated(true);
    } else if (result.code === CODES.QUOTA_SHEET || result.code === CODES.IDENTITY_BUDGET_REACHED
            || result.code === CODES.QUOTA_IDENTITY || result.code === CODES.IDENTITY_LIFETIME_USED
            || result.code === CODES.SAFETY_REJECTED || result.code === CODES.RATE_LIMITED || result.code === CODES.MINOR_REJECTED
            || result.code === CODES.IMAGE_UNSUPPORTED || result.code === CODES.CONTENT_REFUSED || result.code === CODES.CONTENT_CHECK_UNAVAILABLE || result.code === CODES.PHOTO_CHECK_UNAVAILABLE || result.code === CODES.CHARACTER_SHEET_FAILED) {
      // A limit / budget / moderation answer from the server: say exactly what happened.
      // QUOTA_SHEET carries {limit, resetsAt}: say how many uploads are included and when they renew.
      const lang = isHebrew ? 'he' : 'en';
      let reset;
      if (result.resetsAt) {
        const d = new Date(result.resetsAt);
        if (!Number.isNaN(d.getTime())) reset = d.toLocaleDateString(isHebrew ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
      }
      setFileError(getMsg(result.code, lang, { limit: result.limit, reset }));
    } else {
      setFileError(isHebrew ? 'משהו השתבש. נסה שוב.' : 'Something went wrong. Try again.');
    }
  }, [picked, uploadCharacter, isHebrew, consented]);

  const handleConfirmAdult = useCallback(async () => {
    if (!adultOk || adultBusy) return;
    setAdultBusy(true); setFileError('');
    const r = await confirmAdult?.();
    setAdultBusy(false);
    if (r?.ok) return;   // adultConfirmed turns true → the normal pick view appears
    if (r?.code === CODES.NEEDS_ACCOUNT) { setGated(true); return; }   // not signed in: same answer an anonymous upload gets
    setFileError(r?.code === CODES.RATE_LIMITED ? getMsg(CODES.RATE_LIMITED, isHebrew ? 'he' : 'en') : (isHebrew ? 'לא הצלחנו לשמור את האישור. נסה שוב.' : "We couldn't save your confirmation. Please try again."));
  }, [adultOk, adultBusy, confirmAdult, isHebrew]);

  const handleRemove = useCallback(async () => {
    setRemoveStep('busy');
    const r = await removeCharacter?.();
    if (r?.ok) {   // the modal falls back to the "pick" view; a partial result is said out loud instead of claiming a full removal
      setRemoveStep('idle');
      if (!r.partial) { setFileError(''); return; }
      setFileError(r.status === 'nothing-found'
        ? (isHebrew ? 'הקישור לדמות נמחק, אך לא נמצאו קבצים שמורים למחיקה.' : 'Your saved character link was cleared, but no stored files were found to delete.')
        : (isHebrew ? `הדמות הוסרה מהאפליקציה, אך ${r.failed} קבצים שמורים לא נמחקו. נסה שוב בעוד רגע — או פנה אלינו.` : `Your character was removed from the app, but ${r.failed} stored file(s) could not be deleted. Try again in a moment, or contact us.`));
      return;
    }
    setRemoveStep('idle');
    setFileError(isHebrew ? 'לא הצלחנו למחוק כרגע. נסה שוב.' : "We couldn't delete it right now. Please try again.");
  }, [removeCharacter, isHebrew]);

  // ── View resolution ──────────────────────────────────────────────────────────
  const showLoading = status === 'loading';
  // The 18+ step comes FIRST for an account that has not confirmed (including existing users who already have a character — their character keeps working
  // in generation; they are asked the next time they open this feature). Nothing else in the modal is reachable until it is confirmed or the modal is closed.
  const showAdult   = !showLoading && !gated && !adultConfirmed;
  const showResult  = !showLoading && !gated && !showAdult && characterImageUrl && !picked && !changing;
  const showPreview = !showLoading && !gated && !showAdult && !!picked;
  const showPick    = !showLoading && !gated && !showAdult && !picked && (changing || !characterImageUrl);

  // Owner-only removal: deletes the character image and the saved link on the server (not just on this device). Also offered on the 18+ step so a
  // user who does not confirm can still remove an existing character.
  const removeBlock = removeCharacter && (
    removeStep === 'idle' ? (
      <button onClick={() => setRemoveStep('confirm')} className="min-h-[44px] px-3 text-gray-600 hover:text-red-400 text-[10px] font-bold uppercase tracking-wider transition-colors">
        {isHebrew ? 'הסר את הדמות שלי' : 'Remove my character'}
      </button>
    ) : (
      <div className="w-full rounded-2xl bg-red-500/[0.06] border border-red-500/25 p-3 flex flex-col gap-2">
        <p className="text-gray-300 text-[10.5px] leading-relaxed text-center">
          {isHebrew ? 'למחוק את הדמות שלך ואת התמונה ששמרנו? לא ניתן לשחזר.' : 'Delete your character and the image we stored? This cannot be undone.'}
        </p>
        <div className="flex gap-2">
          <button onClick={() => setRemoveStep('idle')} disabled={removeStep === 'busy'} className="flex-1 min-h-[44px] py-2 rounded-xl bg-white/[0.04] border border-white/10 text-gray-400 text-[10px] font-black uppercase tracking-wider disabled:opacity-40">
            {isHebrew ? 'ביטול' : 'Cancel'}
          </button>
          <button onClick={handleRemove} disabled={removeStep === 'busy'} className="flex-1 min-h-[44px] py-2 rounded-xl bg-red-500/80 text-white text-[10px] font-black uppercase tracking-wider disabled:opacity-60 flex items-center justify-center gap-1.5">
            {removeStep === 'busy' && <Loader2 size={12} className="animate-spin" />}
            {isHebrew ? 'מחק' : 'Delete'}
          </button>
        </div>
      </div>
    )
  );

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
        className="fixed inset-0 z-[2001] flex items-center justify-center p-4 md:p-6 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none"
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
              {isHebrew ? 'לככב בסיפור שלך' : 'Star in your own story'}
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
                  {isHebrew ? 'ליהוק עצמי אינו זמין בחשבון שלך' : 'Casting yourself isn\'t available on your account'}
                </p>
                <p className="text-gray-500 text-[11.5px] leading-relaxed">
                  {isHebrew ? 'הפיצ׳ר הזה אינו פתוח כרגע בחשבון שלך.' : 'This feature isn\'t open on your account right now.'}
                </p>
              </div>
            )}

            {/* ── 18+ step (asked once per account) ── */}
            {showAdult && (
              <div className="flex flex-col items-center text-center gap-3 py-0" data-testid="adult-step">
                <div className="[@media(max-height:900px)]:hidden w-14 h-14 rounded-2xl bg-[#d4a373]/10 border border-[#d4a373]/30 flex items-center justify-center">
                  <ShieldCheck size={24} className="text-[#d4a373]" />
                </div>
                <p className="text-white font-bold text-[14px]">
                  {isHebrew ? '"לככב בסיפור" מיועד למשתמשים מגיל 18' : '"Star Yourself" is for ages 18 and over'}
                </p>
                <p className="text-gray-500 text-[11.5px] leading-relaxed">
                  {isHebrew
                    ? 'מאשרים פעם אחת וממשיכים. לא רוצים להשתמש בתמונה? אפשר להמשיך ליצור גם בלעדיה.'
                    : 'Confirm once and you can continue. Don\'t want to use a photo? You can keep creating without one.'}
                </p>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={adultOk}
                  onClick={() => setAdultOk(v => !v)}
                  className="w-full min-h-[44px] flex items-center gap-2.5 text-start p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-[#d4a373]/30 transition-colors"
                >
                  <span className={`shrink-0 w-5 h-5 rounded-[6px] border flex items-center justify-center transition-all duration-150
                    ${adultOk ? 'bg-[#d4a373] border-[#d4a373]' : 'bg-transparent border-white/25'}`}>
                    {adultOk && <Check size={13} className="text-black" />}
                  </span>
                  <span className="text-gray-200 text-[12px] font-bold">{isHebrew ? 'אני בן/בת 18 ומעלה' : 'I am 18 or older'}</span>
                </button>
                <p className="text-gray-600 text-[10.5px] leading-relaxed">
                  {isHebrew ? 'בהמשך אתה מסכים ל' : 'By continuing you agree to the '}
                  <a href="/terms" target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] px-1 underline text-gray-400 hover:text-white">{isHebrew ? 'תנאי השימוש' : 'Terms'}</a>
                  {isHebrew ? ' ול' : ' and '}
                  <a href="/privacy" target="_blank" rel="noopener noreferrer" className="inline-flex items-center min-h-[44px] px-1 underline text-gray-400 hover:text-white">{isHebrew ? 'מדיניות הפרטיות' : 'Privacy Policy'}</a>.
                </p>
                <div className="flex flex-col gap-2 w-full">
                  <button
                    onClick={handleConfirmAdult}
                    disabled={!adultOk || adultBusy}
                    className="w-full min-h-[44px] py-3 rounded-2xl bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black text-[11px] uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {adultBusy && <Loader2 size={13} className="animate-spin" />}
                    {isHebrew ? 'אישור והמשך' : 'Confirm and continue'}
                  </button>
                  <button
                    onClick={onClose}
                    className="w-full min-h-[44px] py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-gray-300 hover:text-white text-[11px] font-black uppercase tracking-wider"
                  >
                    {isHebrew ? 'להמשיך בלי תמונה' : 'Continue without a photo'}
                  </button>
                </div>
                {characterImageUrl && <div className="w-full flex justify-center">{removeBlock}</div>}
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
                  <img src={picked} alt={isHebrew ? 'תצוגה מקדימה של הסלפי שהעלית' : 'Preview of your uploaded selfie'} className="w-full h-full object-cover" />
                </div>
                <p className="text-gray-500 text-[10.5px] text-center leading-relaxed px-2">
                  {isHebrew
                    ? 'ניצור גיליון דמות מסוגנן מהתמונה (לוקח כ-15 שניות).'
                    : "We'll craft a stylized character sheet from this (~15s)."}
                </p>

                {/* Biometric consent gate — required before any face upload */}
                <button
                  type="button"
                  onClick={() => setConsented(v => !v)}
                  aria-pressed={consented}
                  className="w-full flex items-start gap-2.5 text-right rtl:text-right ltr:text-left p-3 rounded-xl bg-white/[0.03] border border-white/[0.07] hover:border-[#d4a373]/30 transition-colors"
                >
                  <span className={`mt-[1px] shrink-0 w-4 h-4 rounded-[5px] border flex items-center justify-center transition-all duration-150
                    ${consented ? 'bg-[#d4a373] border-[#d4a373]' : 'bg-transparent border-white/25'}`}>
                    {consented && <Check size={11} className="text-black" />}
                  </span>
                  <span className="text-gray-400 text-[10px] leading-relaxed">
                    {isHebrew
                      ? 'אני מאשר/ת שזו תמונה שלי או של אדם שנתן הסכמה מפורשת, שאינה של קטין, ושהיא תעובד כמידע ביומטרי ליצירת גיליון דמות בהתאם לתנאי השימוש ומדיניות הפרטיות.'
                      : 'I confirm this is a photo of me or of someone who gave explicit consent, that it is not of a minor, and that it will be processed as biometric data to create a character sheet per the Terms and Privacy Policy.'}
                  </span>
                </button>

                <div className="flex gap-2 w-full">
                  <button
                    onClick={() => setPicked('')}
                    className="flex-1 py-3 rounded-2xl bg-white/[0.04] border border-white/10 text-gray-400 hover:text-white text-[11px] font-black uppercase tracking-wider"
                  >
                    {isHebrew ? 'תמונה אחרת' : 'Another photo'}
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={!consented}
                    className="flex-[1.5] py-3 rounded-2xl bg-gradient-to-br from-[#d4a373] to-[#b3865b] text-black font-black text-[11px] uppercase tracking-wider flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
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
                  {isHebrew ? 'מלהק אותך לתפקיד...' : 'Casting you into the story...'}
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
                  <img src={characterImageUrl} alt={isHebrew ? 'הדמות המעוצבת שלך' : 'Your generated character'} className="w-full h-full object-cover" />
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

                {removeBlock}
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
