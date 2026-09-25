import Head from 'next/head';
import Link from 'next/link';
import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';
import { SITE_URL } from '../lib/site';

const COPY = {
  he: {
    title: 'מחיקת חשבון ומידע — LIFESCRIPT',
    desc: 'איך למחוק את חשבון LIFESCRIPT שלך ואת כל המידע שאנחנו מחזיקים עליך.',
    h1: 'מחיקת חשבון ומידע',
    summary: 'אתה יכול לבקש בכל עת למחוק את חשבונך ואת כל המידע שאנחנו מחזיקים עליך.',
    whatH: 'מה נמחק',
    what: [
      'כתובת האימייל, השם ותמונת הפרופיל שלך (אם נרשמת עם Google)',
      'תמונת הפנים שהעלית ל"לככב בסיפור" וגיליון הדמות שנוצר ממנה',
      'מוני השימוש היומיים/החודשיים שלך ומזהה הלקוח שלך ב-Stripe',
    ],
    notH: 'מה לא רלוונטי למחיקה',
    not: [
      'התסריטים, הפוסטרים והקומיקסים שיצרת — הם נשמרים רק בזיכרון המקומי של הדפדפן שלך (localStorage), על המכשיר שלך בלבד. אנחנו מעולם לא שמרנו אותם בשרתים שלנו, כך שאין מה למחוק בצד שלנו — פשוט נקה את נתוני הדפדפן במכשיר שלך.',
    ],
    formH: 'בקשת מחיקה',
    formSub: 'הזן את כתובת האימייל המשויכת לחשבון שלך. נטפל בבקשה תוך זמן סביר ונשלח אישור לאותה כתובת.',
    emailPh: 'האימייל שלך',
    notePh: 'הערה נוספת (לא חובה)',
    submit: 'שלח בקשת מחיקה',
    sending: 'שולח…',
    success: 'הבקשה התקבלה',
    successSub: 'קיבלנו את בקשת המחיקה שלך ונטפל בה תוך זמן סביר. אישור יישלח לכתובת שהזנת.',
    invalidEmail: 'נא להזין כתובת אימייל תקינה.',
    genericError: 'משהו השתבש. אפשר גם לפנות ישירות במייל.',
    orEmail: 'אפשר גם לפנות ישירות ל-',
    back: 'חזרה לאפליקציה →',
    privacy: 'מדיניות פרטיות',
  },
  en: {
    title: 'Account & Data Deletion — LIFESCRIPT',
    desc: 'How to delete your LIFESCRIPT account and all data we hold about you.',
    h1: 'Account & Data Deletion',
    summary: 'You can request at any time to delete your account and all data we hold about you.',
    whatH: 'What gets deleted',
    what: [
      'Your email address, name, and profile photo (if you signed in with Google)',
      'The face photo you uploaded for "Star Yourself" and the Character Sheet generated from it',
      'Your daily/monthly usage counters and your Stripe customer ID',
    ],
    notH: 'What deletion does not apply to',
    not: [
      'The scripts, posters, and comics you created — these are stored only in your browser\'s local storage (localStorage), on your device alone. We never stored them on our servers, so there is nothing to delete on our end — just clear your browser data on that device.',
    ],
    formH: 'Deletion request',
    formSub: 'Enter the email address associated with your account. We will process the request within a reasonable time and send confirmation to that address.',
    emailPh: 'your@email.com',
    notePh: 'Additional note (optional)',
    submit: 'Submit deletion request',
    sending: 'Sending…',
    success: 'Request received',
    successSub: 'We received your deletion request and will process it within a reasonable time. Confirmation will be sent to the address you entered.',
    invalidEmail: 'Please enter a valid email address.',
    genericError: 'Something went wrong. You can also reach us directly by email.',
    orEmail: 'You can also reach us directly at ',
    back: '← Back to App',
    privacy: 'Privacy Policy',
  },
};

export default function DataDeletionPage() {
  const { data: session } = useSession();
  const [lang, setLang] = useState('he');
  const isHe = lang === 'he';
  const t = COPY[lang];

  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');
  const [state, setState] = useState('idle'); // idle | sending | success | error
  const [errorMsg, setErrorMsg] = useState('');

  // Prefill from the signed-in session once it resolves, without fighting user edits.
  useEffect(() => {
    if (session?.user?.email && !email) setEmail(session.user.email);
  }, [session]);

  const submit = async () => {
    const clean = (email || session?.user?.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setState('error');
      setErrorMsg(t.invalidEmail);
      return;
    }
    setState('sending');
    setErrorMsg('');
    try {
      const res = await fetch('/api/request-deletion', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: clean, note, lang }),
      });
      if (!res.ok) throw new Error('request failed');
      setState('success');
    } catch {
      setState('error');
      setErrorMsg(t.genericError);
    }
  };

  return (
    <>
      <Head>
        <title>{t.title}</title>
        <meta name="description" content={t.desc} />
        <meta name="robots" content="index, follow" />
        <link rel="canonical" href={`${SITE_URL}/data-deletion`} />
        <meta key="og:title" property="og:title" content={t.title} />
        <meta key="og:description" property="og:description" content={t.desc} />
        <meta key="og:url" property="og:url" content={`${SITE_URL}/data-deletion`} />
        <meta property="og:type" content="website" />
      </Head>

      <div
        dir={isHe ? 'rtl' : 'ltr'}
        style={{ fontFamily: '"Heebo", "Segoe UI", sans-serif' }}
        className="min-h-screen bg-[#030712] text-white"
      >
        <header className="sticky top-0 z-40 bg-[#030712]/92 backdrop-blur-sm border-b border-white/[0.06]">
          <div className="max-w-2xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link
              href="/"
              className="text-[#d4a373] hover:text-[#e0b487] transition-colors text-[13px] font-semibold"
            >
              {t.back}
            </Link>
            <button
              onClick={() => setLang(isHe ? 'en' : 'he')}
              aria-label={isHe ? 'Switch to English' : 'עבור לעברית'}
              className="text-white/35 hover:text-white/70 text-[11px] font-mono tracking-widest transition-colors px-3 py-1.5 rounded-full border border-white/10 hover:border-white/25"
            >
              {isHe ? 'EN' : 'HE'}
            </button>
          </div>
        </header>

        <main className="max-w-2xl mx-auto px-6 py-14">
          <div className="mb-10 pb-8 border-b border-white/[0.06]">
            <p className="text-[10px] font-black tracking-[0.35em] text-[#d4a373]/50 uppercase mb-3">
              LIFESCRIPT Studio
            </p>
            <h1 className="text-3xl font-black tracking-wide text-white leading-tight">
              {t.h1}
            </h1>
            <p className="mt-3 text-white/30 text-[12px] leading-relaxed">
              {t.summary}
            </p>
          </div>

          <section className="border-b border-white/[0.05] py-8">
            <h2 className="text-[#d4a373] font-bold text-[14px] mb-3 leading-snug">{t.whatH}</h2>
            <ul className="space-y-2">
              {t.what.map((line, i) => (
                <li key={i} className="text-white/58 text-[13px] leading-[1.85] flex gap-2">
                  <span className="text-[#d4a373]/50 shrink-0">—</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="border-b border-white/[0.05] py-8">
            <h2 className="text-[#d4a373] font-bold text-[14px] mb-3 leading-snug">{t.notH}</h2>
            {t.not.map((line, i) => (
              <p key={i} className="text-white/58 text-[13px] leading-[1.85]">{line}</p>
            ))}
          </section>

          <section className="py-8">
            <h2 className="text-[#d4a373] font-bold text-[14px] mb-1 leading-snug">{t.formH}</h2>
            <p className="text-white/40 text-[12px] leading-relaxed mb-5">{t.formSub}</p>

            {state === 'success' ? (
              <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                <div className="w-8 h-8 shrink-0 rounded-full bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                  <Check size={16} className="text-emerald-400" />
                </div>
                <div>
                  <p className="text-emerald-400 font-bold text-[13px] mb-1">{t.success}</p>
                  <p className="text-white/50 text-[12px] leading-relaxed">{t.successSub}</p>
                </div>
              </div>
            ) : (
              <>
                <input
                  type="email"
                  value={email}
                  onChange={e => { setEmail(e.target.value); if (state === 'error') setState('idle'); }}
                  placeholder={t.emailPh}
                  dir="ltr"
                  disabled={state === 'sending'}
                  className={`w-full bg-white/[0.04] border border-white/10 rounded-2xl py-3.5 px-4 text-white text-[13px] placeholder-white/25 outline-none focus:border-[#d4a373]/50 transition-colors disabled:opacity-50 mb-3 ${isHe ? 'text-right' : ''}`}
                />
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder={t.notePh}
                  rows={2}
                  disabled={state === 'sending'}
                  className={`w-full bg-white/[0.04] border border-white/10 rounded-2xl py-3.5 px-4 text-white text-[13px] placeholder-white/25 outline-none focus:border-[#d4a373]/50 transition-colors disabled:opacity-50 mb-3 resize-none ${isHe ? 'text-right' : ''}`}
                />

                {state === 'error' && errorMsg && (
                  <div className="mb-3 p-3 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-start gap-2.5">
                    <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
                    <p className="text-red-400/90 text-[12px] leading-snug">{errorMsg}</p>
                  </div>
                )}

                <button
                  onClick={submit}
                  disabled={state === 'sending'}
                  className="w-full flex items-center justify-center gap-2 bg-[#d4a373] hover:bg-[#e0b487] disabled:bg-[#d4a373]/40 disabled:cursor-not-allowed active:scale-[0.98] text-black font-black text-[14px] px-5 py-3.5 rounded-2xl transition-all duration-150"
                >
                  {state === 'sending'
                    ? <><Loader2 size={15} className="animate-spin shrink-0" />{t.sending}</>
                    : t.submit}
                </button>

                <p className="text-center text-white/25 text-[11px] leading-relaxed mt-4">
                  {t.orEmail}
                  <a href="mailto:adialamo@gmail.com" className="text-[#d4a373]/60 hover:text-[#d4a373]">adialamo@gmail.com</a>
                </p>
              </>
            )}
          </section>

          <div className="mt-10 pt-8 border-t border-white/[0.06] flex flex-col items-center gap-3 text-center">
            <p className="text-[10px] tracking-[0.3em] font-black text-white/15 uppercase">
              LIFESCRIPT Studio
            </p>
            <Link href="/privacy" className="text-white/20 hover:text-white/50 text-[11px] transition-colors">
              {t.privacy}
            </Link>
          </div>
        </main>
      </div>
    </>
  );
}
