import React, { useState, useEffect } from 'react';
import Head from 'next/head';
import { motion, AnimatePresence } from 'framer-motion';
import { Film, Copyright, AlertCircle, Key, X, Download, Share2, Camera, MessageSquare, Send, Check } from 'lucide-react';
import Navbar from '../components/Navbar';
import LaunchTicket from '../components/LaunchTicket';
import ScriptOutput from '../components/ScriptOutput';
import HeroSection from '../components/HeroSection';
import ScriptForm from '../components/ScriptForm';
import { useBackgroundAudio } from '../hooks/useBackgroundAudio';
import { Analytics } from '@vercel/analytics/react';
import { track } from '@vercel/analytics';
import { SHOWCASE_POSTERS } from '../constants/showcase';
import { MODAL_DATA } from '../constants/modalData';

function HomePage() {
  const [script, setScript] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState('en');
  const [mounted, setMounted] = useState(false);
  const [isTypingGlobal, setIsTypingGlobal] = useState(false);

  const [selectedGenre, setSelectedGenre] = useState(null);
  const [isTyping, setIsTyping] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [tempAdminKey, setTempAdminKey] = useState('');
  const [modalContent, setModalContent] = useState(null);
  const [showTips, setShowTips] = useState(false);
  const [showGallery, setShowGallery] = useState(true);
  const [selectedPoster, setSelectedPoster] = useState(null);
  const [producerName, setProducerName] = useState('');

  // --- Director's Log Logic ---
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackStatus, setFeedbackStatus] = useState('idle');

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
        }, 2500);
      } else {
        throw new Error('Server responded with error');
      }
    } catch (err) {
      console.error("Feedback error:", err);
      setFeedbackStatus('idle');
      alert(lang === 'he' ? 'תקלה בתקשורת עם השרת. נסה שוב.' : 'Communication error. Please try again.');
    }
  };

  useEffect(() => {
    setMounted(true);

    const savedName = localStorage.getItem('lifescript_producer_name');
    if (savedName) setProducerName(savedName);

    const savedKey = localStorage.getItem('lifescript_admin_key');
    if (savedKey) setTempAdminKey(savedKey);

    if (!localStorage.getItem('lifescript_device_id')) {
      const newId = 'ds_' + Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
      localStorage.setItem('lifescript_device_id', newId);
    }
  }, []);

  const toggleLanguage = () => setLang(prev => prev === 'he' ? 'en' : 'he');

  const saveAdminKey = () => {
    const cleanKey = tempAdminKey.trim();

    if (cleanKey !== "") {
      localStorage.setItem('lifescript_admin_key', cleanKey);
      setTempAdminKey(cleanKey);
      setShowAdminPanel(false);
      setError('');

      const updateMsg = lang === 'he'
        ? 'המפתח עודכן. הוא ייבדק בעת יצירת התסריט.'
        : 'Key updated. It will be verified during generation.';

      console.log(updateMsg);
    } else {
      setShowAdminPanel(false);
    }
  };

  const handleGenerateScript = async (journalEntry, genre) => {
    if (!journalEntry || journalEntry.trim().length < 5) return;

    setShowGallery(false);
    setLoading(true);
    setError('');
    setScript('');
    setSelectedGenre(genre);

    try {
      const savedAdminKey = localStorage.getItem('lifescript_admin_key') || '';
      const deviceId = localStorage.getItem('lifescript_device_id') || 'unknown';

      const response = await fetch('/api/generate-script', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-key': savedAdminKey,
          'x-device-id': deviceId
        },
        body: JSON.stringify({
          journalEntry,
          genre,
          producerName: producerName || (lang === 'he' ? 'אורח' : 'Guest'),
          deviceId: deviceId,
          adminKeyBody: savedAdminKey
        }),
      });

      let data = {};
      try {
        data = await response.json();
      } catch (e) {
        if (!response.ok) throw new Error(lang === 'he' ? 'שרת ההפקה לא זמין כרגע' : 'Production server offline');
      }

      if (response.status === 429) {
        if (typeof window !== 'undefined' && window.gtag) {
          window.gtag('event', 'script_error', { error_type: 'quota_reached', genre });
        }
        const quotaMsg = lang === 'he'
          ? "🎬 הצילומים להיום הסתיימו. המכסה היומית נוצלה - נתראה מחר בבכורה!"
          : "🎬 Production wrapped for today. Daily quota reached - see you at tomorrow's premiere!";

        setError(quotaMsg);
        setLoading(false);
        return;
      }

      if (!response.ok) {
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
        console.log("✅ Script received successfully!");
      } else {
        throw new Error('התקבלה תשובה ריקה מהשרת');
      }

    } catch (err) {
      console.error("Frontend Generation Error:", err);
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'script_error', {
          error_type: 'frontend_exception',
          error_message: err.message,
          genre
        });
      }
      if (err.message.includes('fetch failed') || !navigator.onLine) {
        setError(lang === 'he' ? 'אין חיבור אינטרנט פעיל - ההפקה הופסקה' : 'No internet connection - Production halted');
      } else if (err.message.includes('401') || err.message.toLowerCase().includes('unauthorized')) {
        setError(lang === 'he'
          ? 'גישת מנהל נכשלה: הסיסמה שגויה או פגה.'
          : 'Admin access failed: Incorrect or expired password.');
      } else if (err.message.includes('429')) {
        setError(lang === 'he'
          ? 'המכסה היומית הסתיימה או שיש עומס. נסה שוב בעוד רגע.'
          : 'Daily limit reached or system busy. Try again in a moment.');
      } else {
        setError(err.message || 'תקלה בתקשורת עם השרת');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGeneratePoster = async (scriptText) => {
    setLoading(true);
    setError('');

    try {
      const marker = "[image:";
      const markerIndex = scriptText.toLowerCase().indexOf(marker);
      let visualPrompt = "Cinematic movie poster, dramatic lighting";

      if (markerIndex !== -1) {
        const endBracketIndex = scriptText.indexOf("]", markerIndex);
        visualPrompt = scriptText.substring(markerIndex + marker.length, endBracketIndex).trim();
      }

      const response = await fetch('/api/generate-poster', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: visualPrompt,
          genre: selectedGenre,
          lang: lang,
          deviceId: localStorage.getItem('lifescript_device_id')
        }),
      });
      const data = await response.json();

      if (data.success && data.imageUrl) {
        setSelectedPoster({ src: data.imageUrl, id: 'generated' });
      } else {
        throw new Error(data.message || 'הפקת הפוסטר נכשלה');
      }
    } catch (err) {
      console.error("Poster Error Caught:", err);
      setError(err.message);
      setSelectedPoster(null);
    } finally {
      setLoading(false);
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
        <link href="https://fonts.googleapis.com/css2?family=Heebo:wght@100;300;400;700;900&display=swap" rel="stylesheet" />
      </Head>

      {/* רקע גרדיאנט קולנועי */}
      <div className="mesh-gradient fixed inset-0 -z-10">
        <div className="mesh-sphere w-[600px] h-[600px] bg-purple-900/10 top-[-10%] left-[-10%]" />
        <div className="mesh-sphere w-[500px] h-[500px] bg-blue-900/10 bottom-[-10%] right-[-10%]" />
      </div>

      <Navbar lang={lang} onLanguageToggle={toggleLanguage} />

      <main className="container mx-auto pt-4 md:pt-8 pb-12 px-6 max-w-5xl flex-grow relative z-10">

        <HeroSection setShowAdminPanel={setShowAdminPanel} lang={lang} />

        {/* Admin Panel */}
        <AnimatePresence>
          {showAdminPanel && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/95 backdrop-blur-xl px-6"
              onClick={() => setShowAdminPanel(false)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-[#0f1117] border border-[#d4a373]/30 p-8 md:p-12 rounded-[2.5rem] shadow-2xl w-full max-w-lg relative text-center"
              >
                {/* כפתור סגירה */}
                <button
                  onClick={() => setShowAdminPanel(false)}
                  className="close-button absolute top-6 right-6 text-white/20 hover:text-[#d4a373] transition-colors p-2"
                >
                  <X size={24} />
                </button>

                <Key className="text-[#d4a373] mx-auto mb-4" size={48} />

                {/* כותרת דינמית */}
                <h2 className="text-3xl font-black text-white uppercase tracking-tighter">
                  {lang === 'he' ? 'גישת מנהל' : 'ADMIN ACCESS'}
                </h2>

                {/* תיאור משני דינמי */}
                <p className="text-[#d4a373]/40 text-xs tracking-widest mt-2 uppercase">
                  {lang === 'he' ? 'מורשים בלבד' : 'AUTHORIZED PERSONNEL ONLY'}
                </p>

                <div className="mt-10 space-y-6">
                  {/* שדה הזנה עם Placeholder דינמי */}
                  <input
                    type="password"
                    value={tempAdminKey}
                    autoFocus
                    onChange={(e) => setTempAdminKey(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && saveAdminKey()}
                    placeholder={lang === 'he' ? 'הזן קוד סודי...' : 'ENTER SECRET KEY...'}
                    className="w-full bg-black/50 border border-white/10 p-6 rounded-2xl text-2xl text-white outline-none focus:border-[#d4a373] text-center tracking-[0.4em]"
                  />

                  {/* כפתור אישור דינמי */}
                  <button
                    onClick={saveAdminKey}
                    className="w-full bg-[#d4a373] text-black py-6 rounded-2xl font-black text-xl hover:bg-white transition-all active:scale-95 shadow-xl shadow-[#d4a373]/20 uppercase"
                  >
                    {lang === 'he' ? 'אישור כניסה' : 'AUTHORIZE'}
                  </button>

                  {/* כפתור ביטול דינמי */}
                  <button
                    onClick={() => setShowAdminPanel(false)}
                    className="text-white/30 hover:text-white text-sm uppercase tracking-widest block mx-auto transition-colors"
                  >
                    {lang === 'he' ? 'ביטול' : 'CANCEL'}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Modals (Terms, Privacy, Support, About) */}
        <AnimatePresence>
          {modalContent && MODAL_DATA[modalContent] && (
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/95 md:backdrop-blur-xl px-6"
              onClick={() => setModalContent(null)}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-[#0f1117] border border-[#d4a373]/20 p-8 md:p-12 pt-16 rounded-[2.5rem] max-w-2xl w-full max-h-[85vh] overflow-hidden relative shadow-2xl"
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
          className={`glass-panel rounded-[3rem] overflow-hidden shadow-2xl relative ${(loading || isTyping) ? 'ai-loading-active' : ''}`}
        >
          <div className="bg-[#030712]/60 backdrop-blur-3xl p-8 md:p-16 relative">
            <ScriptForm
              onSubmit={handleGenerateScript}
              loading={loading || isTyping}
              lang={lang}
              producerName={producerName}
              setProducerName={setProducerName}
              isTypingGlobal={isTypingGlobal}
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
                  className="mt-10 p-6 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center gap-4 text-red-400 text-xl md:text-2xl font-bold text-center"
                >
                  <AlertCircle size={28} />
                  <span>{error}</span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.section>

        {/* Gallery Section */}
        <AnimatePresence>
          {showGallery && !script && (
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: "easeOut" }}
              className="mt-16 mb-10"
            >
              <div className="text-center mb-10">
                <h3 className="text-[#d4a373] text-[10px] font-black tracking-[0.5em] uppercase mb-2 opacity-60">
                  {lang === 'he' ? 'גלריית הפקות' : 'PRODUCTION SAMPLES'}
                </h3>
                <div className="h-[1px] w-20 bg-[#d4a373]/30 mx-auto" />
              </div>

              {/* התיקון כאן: הגבלת גובה וגלילה פנימית */}
              <div className="max-h-[500px] overflow-y-auto overflow-x-hidden px-2 custom-gallery-scroll pb-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 md:gap-8">
                  {SHOWCASE_POSTERS.map((poster, index) => {
                    const isSelected = selectedPoster && selectedPoster.id === poster.id;
                    return (
                      <motion.div
                        key={poster.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.1 }}
                        onClick={() => setSelectedPoster(poster)}
                        className={`group relative aspect-[2/3] overflow-hidden rounded-[2rem] border transition-all duration-500 cursor-pointer
        ${isSelected ? 'border-[#d4a373] shadow-[0_0_30px_rgba(212,163,115,0.2)]' : 'border-white/10 shadow-2xl hover:border-white/30'}`}
                      >
                        <img
                          src={poster.src}
                          alt={lang === 'he' ? poster.titleHe : poster.titleEn}
                          className={`w-full h-full object-cover transition-all duration-1000 
          ${isSelected ? 'scale-105 blur-[1px] brightness-[0.4]' : 'grayscale-[0.2] group-hover:grayscale-0'}`}
                        />
                        <div className={`absolute inset-0 bg-gradient-to-t from-black via-black/40 to-transparent transition-all duration-500 flex flex-col justify-end p-4 md:p-6 text-right
        ${isSelected ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 md:group-hover:opacity-100 md:group-hover:translate-y-0'}`}>

                          {/* כותרת ז'אנר בתוך הגלריה */}
                          <div className="flex flex-col mb-1 md:mb-2">
                            <span className="text-[#d4a373] text-[7px] md:text-[9px] font-black tracking-[0.2em] md:tracking-[0.3em] uppercase italic block">
                              {lang === 'he' ? "ז'אנר:" : 'GENRE:'}
                            </span>
                            <span className="text-white text-[10px] md:text-xs font-bold tracking-widest uppercase">
                              {lang === 'he' ? poster.titleHe : poster.titleEn}
                            </span>
                          </div>
                          <div className={`h-[1px] md:h-[1.5px] bg-[#d4a373] transition-all duration-700 ${isSelected ? 'w-12 md:w-16' : 'w-0 group-hover:w-10'}`} />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>

        {/* תצוגת התסריט והפוסטר */}
        <AnimatePresence mode="wait">
          {script && !loading && (
            <motion.div
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.8, ease: "easeOut" }}
              className="mt-16 md:mt-24"
            >
              <ScriptOutput
                script={script}
                lang={lang}
                genre={selectedGenre}
                setIsTypingGlobal={setIsTyping}
                producerName={producerName}
                posterUrl={selectedPoster?.src}
                onGeneratePoster={() => handleGeneratePoster(script)}
                loading={loading}
                error={error}
              />
            </motion.div>
          )}
        </AnimatePresence>

        {/* מודל הרחבה קטן ויוקרתי (Expanded Panel) */}
        <AnimatePresence>
          {selectedPoster && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPoster(null)}
              className="fixed inset-0 z-[1000] bg-black/40 backdrop-blur-sm flex items-end md:items-center justify-center p-6 pb-24 md:pb-10"
            >
              <motion.div
                initial={{ scale: 0.9, y: 40 }}
                animate={{ scale: 1, y: 0 }}
                exit={{ scale: 0.9, y: 40 }}
                onClick={(e) => e.stopPropagation()}
                className="bg-[#0f1117]/95 border border-[#d4a373]/30 rounded-[2.5rem] shadow-[0_25px_100px_rgba(0,0,0,0.9)] w-full max-w-md overflow-hidden flex flex-col relative"
                style={{ maxHeight: '70vh' }}
              >
                {/* כפתור סגירה (X) בלבד - אלמנט הניווט היחיד */}
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setSelectedPoster(null);
                  }}
                  className="close-button absolute right-6 text-white/40 hover:text-[#d4a373] transition-all duration-300 z-[9999] p-4 bg-black/20 backdrop-blur-md rounded-full group"
                  style={{
                    top: 'calc(var(--sat, 0px) + 16px)',
                    touchAction: 'manipulation'
                  }}
                >
                  <X size={24} className="close-button group-hover:rotate-90 transition-transform duration-500" />
                </button>

                {/* תמונה מוקטנת למעלה עם גרדיאנט עמוק */}
                <div className="w-full h-40 relative">
                  <img
                    src={selectedPoster.src}
                    className="w-full h-full object-cover opacity-50"
                    alt={selectedPoster.titleEn}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#0f1117] via-[#0f1117]/50 to-transparent" />
                </div>

                {/* תוכן הטקסט - מקסימום מקום לקריאה */}
                <div className="p-8 pt-0 pb-10 flex flex-col flex-grow overflow-hidden">
                  <div className="mb-6">
                    <span className="text-[#d4a373] text-[9px] font-black tracking-[0.3em] uppercase italic border-b border-[#d4a373]/20 pb-1">
                      {lang === 'he' ? selectedPoster.titleHe : selectedPoster.titleEn}
                    </span>
                  </div>

                  {/* אזור הטקסט עם גלילה פנימית חלקה */}
                  <div className="overflow-y-auto pr-3 custom-scrollbar flex-grow text-right">
                    <p className="text-white/90 text-[1.1rem] md:text-xl leading-relaxed font-light whitespace-pre-line"
                      style={{
                        fontFamily: "'Courier Prime', 'Courier New', monospace",
                        direction: lang === 'he' ? 'rtl' : 'ltr',
                      }}>
                      {lang === 'he' ? selectedPoster.excerptHe : selectedPoster.excerptEn}
                    </p>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Director's Log (Feedback Section) */}
        <div className="mt-2 mb-0 w-full max-w-xl mx-auto px-6 relative z-50">
          <AnimatePresence mode='wait'>
            {!showFeedback ? (
              <motion.button
                key="feedback-trigger"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                onClick={() => setShowFeedback(true)}
                className="w-full group relative overflow-hidden rounded-2xl bg-[#0f1117]/80 backdrop-blur-md border border-[#d4a373]/10 hover:border-[#d4a373]/40 transition-all duration-500 py-6 px-4 text-center cursor-pointer shadow-lg"
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
                    {lang === 'he' ? 'יש לך הערות על ההפקה? שתף אותנו' : 'Notes on the production? Share with us'}
                  </p>
                </div>
              </motion.button>
            ) : (
              <motion.div
                key="feedback-form"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="bg-[#0f1117] border border-[#d4a373]/30 p-8 rounded-3xl shadow-2xl relative overflow-hidden text-right"
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

                <button
                  onClick={handleSendFeedback}
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
              </motion.div>
            )}
          </AnimatePresence>
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
              {['about', 'support', 'terms', 'privacy'].map((item) => (
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
      
      <Analytics />
    </div>
  );
}

export default HomePage;