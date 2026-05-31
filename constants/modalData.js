export const MODAL_DATA = {

  // ─── Terms of Service ──────────────────────────────────────────────────────

  terms: {
    he: {
      title: 'תנאי שימוש',
      sections: [
        {
          h: '1. בעלות מלאה על היצירה',
          p: 'כל התסריטים, הפוסטרים, פאנלי הקומיקס וכל תוכן שנוצר עבורך שייכים לך באופן מלא ובלעדי. LIFESCRIPT אינה טוענת לבעלות כלשהי על יצירותיך — לא על הסיפורים, לא על הדמויות ולא על התוצר הויזואלי שנוצר עבורך.',
        },
        {
          h: '2. מדיניות שימוש הוגן ומגבלות יומיות',
          p: 'לשמירה על איכות השירות לכלל המשתמשים, כל חשבון מוגבל ל-3 תסריטים, 2 פוסטרים ו-1 קומיקס ביום. מגבלות אלו מתאפסות בחצות UTC. ייתכנו תנודות בביצועים הנובעות מעומס על ספקי AI גלובליים — אלו אינן תקלה, אלא ניהול אינטליגנטי של משאבי הייצור.',
        },
        {
          h: '3. הגנת תוכן וניקוי קלטים אוטומטי',
          p: 'כל טקסט שנשלח למערכת עובר ניקוי אוטומטי לסינון HTML, תגיות זדוניות והזרקות קוד. חל איסור מוחלט לנסות לעקוף מנגנונים אלו, להשתמש בטכניקות Prompt Injection לשינוי התנהגות ה-AI, או להזין תוכן פוגעני, אלים, פורנוגרפי, גזעני או תוכן המופנה כלפי קטינים.',
        },
        {
          h: '4. ביצועי השירות ואדפטציה דינמית',
          p: 'המערכת פועלת עם ארכיטקטורת Circuit Breaker שמנתבת כל בקשה לספק הזמין ביותר בזמן אמת. מהירות יצירת תמונות ותסריטים עשויה להשתנות בהתאם לזמינות ספקים גלובליים. שינויים אלו אינם מהווים כשל שירות — אלא מנגנון איזון חכם.',
        },
        {
          h: '5. הגבלת גיל, AI ושירותי צד שלישי',
          p: 'השירות מיועד למשתמשים מגיל 13 ומעלה. LIFESCRIPT משתמשת בשירותי AI חיצוניים (Google AI, OpenRouter). אנחנו לא אחראים לשינויים במדיניות ספקים אלו. התוכן שנוצר מבוסס על בינה מלאכותית ועשוי להכיל אי-דיוקים; האחריות על השימוש בו חלה על המשתמש בלבד.',
        },
      ],
    },
    en: {
      title: 'TERMS',
      sections: [
        {
          h: '1. Full Ownership of Creations',
          p: 'All scripts, posters, comic panels, and any content generated for you belong entirely and exclusively to you. LIFESCRIPT makes no claim of ownership over your creations — not your stories, characters, or the visual output generated on your behalf.',
        },
        {
          h: '2. Fair Use Policy & Daily Limits',
          p: 'To maintain quality service for all users, each account is limited to 3 scripts, 2 posters, and 1 comic per day. Limits reset at UTC midnight. Performance variations may occur due to load on global AI providers — these are not failures, but intelligent management of production resources.',
        },
        {
          h: '3. Content Protection & Automatic Input Sanitization',
          p: 'All text submitted to the system is automatically sanitized to filter HTML, malicious tags, and injection attempts. It is strictly forbidden to bypass these mechanisms, use prompt-injection techniques to alter AI behavior, or submit offensive, violent, pornographic, racist, or minors-targeted content.',
        },
        {
          h: '4. Service Performance & Dynamic Adaptation',
          p: 'The system operates a Circuit Breaker architecture that routes each request to the most available provider in real time. Image and script generation speed may vary based on global provider availability. These variations are not service failures — they are intelligent load balancing.',
        },
        {
          h: '5. Age Restriction, AI & Third-Party Services',
          p: 'This service is intended for users aged 13 and above. LIFESCRIPT uses third-party AI services (Google AI, OpenRouter). We are not responsible for changes in their policies. AI-generated content may contain inaccuracies; the user bears sole responsibility for how it is used.',
        },
      ],
    },
  },

  // ─── Privacy Policy ────────────────────────────────────────────────────────

  privacy: {
    he: {
      title: 'פרטיות',
      summary: '"הפרטיות שלך היא התסריט הכי חשוב שאנחנו מגנים עליו."',
      sections: [
        {
          h: '1. מדיניות "אפס אחסון" (Zero Storage)',
          p: 'הטקסטים שאתה מזין, התסריטים שנוצרים, הפוסטרים הקולנועיים ופאנלי הקומיקס — כל אלו שייכים לך ולך בלבד ואינם נשמרים, נצברים או מאוחסנים בשום שרת שלנו. הנתונים עוברים ישירות לעיבוד ונמחקים עם סיום כל בקשה. אין לנו היסטוריית יצירה, אין קבצי גיבוי, ואין מסד נתונים שמחזיק את הסיפור שלך.',
        },
        {
          h: '2. עיבוד מאובטח דרך ספקי AI מובילים',
          p: 'הטקסט שלך מועבר בצורה מוצפנת (HTTPS) לשרתי Google AI, OpenRouter ושרתים מובילים נוספים בתחום, לצורך יצירת התסריט והתמונות. אנחנו משתמשים במפתחות API ייעודיים שאינם מזהים אותך אישית. שירותים אלו אינם שומרים את התוכן שלך לאחר השלמת הבקשה ואינם משתמשים בו למטרות פרסום.',
        },
        {
          h: '3. אנחנו לא מוכרים מידע',
          p: 'אנחנו לא מוכרים, לא משתפים ולא מעבדים את הקלטים שלך לשום מטרה פרסומית או מסחרית. LIFESCRIPT מרוויחה מהיכולת לייצר עבורך — לא ממה שאתה כותב.',
        },
        {
          h: '4. אחסון מקומי בלבד (LocalStorage)',
          p: 'שם המשתמש שלך, הגדרות השפה ומפתח הגישה נשמרים על המכשיר האישי שלך בלבד, בזיכרון המקומי של הדפדפן. מידע זה אינו מועבר לשרתינו ואינו משמש לשום מטרת מעקב או פרסום.',
        },
      ],
    },
    en: {
      title: 'PRIVACY',
      summary: '"Your privacy is the most important script we protect."',
      sections: [
        {
          h: '1. Zero Storage Policy',
          p: 'Your input texts, generated scripts, movie posters, and comic panels all belong exclusively to you and are never stored, cached, or saved on any of our servers. Data goes directly to processing and is deleted upon completion of each request. We have no creation history, no backup files, and no database holding your story.',
        },
        {
          h: '2. Secure Processing via Trusted AI Providers',
          p: 'Your text is transmitted over encrypted HTTPS to Google AI, OpenRouter, and other industry-leading AI infrastructure providers, for the purpose of generating scripts and images. We use dedicated API tokens that do not personally identify you. These services do not retain your content after a request is completed and do not use it for advertising.',
        },
        {
          h: "3. We Don't Sell Your Data",
          p: "We do not sell, share, or repurpose your inputs for any advertising or commercial purpose. LIFESCRIPT profits from the ability to generate for you — not from what you write.",
        },
        {
          h: '4. Local Storage Only',
          p: "Your display name, language settings, and access key are stored only on your personal device, in your browser's local storage. This information never reaches our servers and is never used for tracking.",
        },
      ],
    },
  },

  // ─── Support / Help Center ─────────────────────────────────────────────────

  support: {
    he: {
      title: 'תמיכה',
      type: 'faq',
      footerLabel: 'LIFESCRIPT בשלב Beta מוקדם — מעריכים כל הערה ורעיון',
      footerButton: 'המשך הפקה נעימה!',
      sections: [
        {
          h: 'הכפתור "צור תסריט" לא מגיב?',
          p: 'המנגנון דורש לפחות 5 מילים כדי לבנות עולם. הרחב את תיאור היומן — שם דמות, רגש, מקום — והכפתור ייפתח מיידית.',
        },
        {
          h: 'למה פאנלי הקומיקס נטענים בהדרגה?',
          p: 'כל פאנל נוצר בנפרד ומוצג ברגע שמוכן — כדי שלא תחכה לכלום. הפאנלים ממשיכים להיווצר ברקע גם אם הראשון כבר גלוי על המסך. זה עיצוב מכוון ולא תקלה.',
        },
        {
          h: 'פאנל מסוים לוקח יותר זמן מהאחרים?',
          p: 'המערכת מנהלת עומסים בזמן אמת. אם ספק ויזואלי מסוים עמוס, המנגנון מנתב אוטומטית לספק חלופי — כמו Flux — כדי להבטיח את איכות התמונה הגבוהה ביותר. זה לוקח עוד כמה שניות, אבל שווה את זה.',
        },
        {
          h: 'הפוסטר לא נטען?',
          p: 'לחץ שוב על "צור פוסטר קולנועי". אם הבעיה חוזרת, רענון מלא של הדף פותר את הבעיה ב-100% מהמקרים.',
        },
        {
          h: 'בעיות סאונד ומוזיקה?',
          p: 'ודא שהמכשיר אינו על מצב שקט (Silent). בדפדפני מובייל, לעיתים יש ללחוץ על כפתור הרמקול בטופס כדי לאפשר את המוזיקה.',
        },
      ],
    },
    en: {
      title: 'SUPPORT',
      type: 'faq',
      footerLabel: 'LIFESCRIPT is in early Beta — every note and idea is valued',
      footerButton: 'Happy Directing!',
      sections: [
        {
          h: 'Generate button not responding?',
          p: 'The engine needs at least 5 words to build a world. Expand your journal entry — a character name, an emotion, a location — and the button will activate immediately.',
        },
        {
          h: 'Why are comic panels loading one by one?',
          p: "Each panel is generated independently and appears the moment it's ready — so you're never staring at a blank screen. Panels continue loading in the background even as the first ones are already visible. This is intentional design, not a bug.",
        },
        {
          h: 'One panel taking longer than the others?',
          p: 'The system manages provider load in real time. If a particular visual provider is under pressure, the engine automatically re-routes to an alternative — like Flux — to guarantee the highest image quality. It takes a few extra seconds, but it\'s worth it.',
        },
        {
          h: 'Poster not loading?',
          p: 'Click "Generate Movie Poster" again. If the issue persists, a full page refresh resolves it every time.',
        },
        {
          h: 'Sound or music issues?',
          p: "Ensure your device isn't on Silent mode. On mobile browsers, tap the speaker icon in the form to allow audio.",
        },
      ],
    },
  },

  // ─── About ─────────────────────────────────────────────────────────────────

  about: {
    he: {
      title: 'אודות',
      sections: [
        {
          h: 'החזון: מחיים לתסריט, מתסריט לקומיקס',
          p: 'כולנו חיים בתוך סיפור. LIFESCRIPT לוקחת את האירועים של היום שלך — שיחה שהייתה, רגע שחלף, רגש שנותר — ומרימה אותם לרמת ייצור קולנועי מלאה. כותבים תסריט. מפיקים פוסטר. יוצרים קומיקס.',
        },
        {
          h: 'מנגנון AI מרובה-ספקים',
          p: 'מאחורי כל לחיצה פועל מנגנון שמריץ בו-זמנית מספר מודלי שפה מהמתקדמים בעולם — Gemini Flash, Gemma ו-DeepSeek — ובוחר אוטומטית את המהיר שמחזיר תוצאה מושלמת. לתמונות, קסקדה חכמה של ספקים ויזואליים — Gemini, FLUX, Cloudflare AI ועוד — מבטיחה פוסטר ופאנלים תמיד, גם בשיא העומס.',
        },
        {
          h: 'מהתסריט ללוח הסיפור',
          p: 'אחרי שהתסריט מוכן, LIFESCRIPT ממשיכה בהפקה: מנתחת את הסצנות, מחלקת אותן ל-5 עד 7 פאנלים ומייצרת כל פאנל בנפרד — בסגנון שבחרת: אנימה סטודיו, מארוול רטרו, או נואר קולנועי. הפאנלים מופיעים בהדרגה ברגע שמוכנים, כך שהיצירה מתגלה בפניך סצנה אחר סצנה.',
        },
        {
          h: 'איך להפיק את המיטב?',
          p: "כתוב בכנות — לפחות שלוש משפטים שמתארים מה קרה, מה הרגשת ומי היה שם. לאחר שה-AI מפיק את התסריט, יש לך שליטה מלאה לערוך, לדייק ולשכלל אותו. בשלב הבא, הפק פוסטר קולנועי מרהיב שיהווה את השער לסיפור שלך, ומשם המשך ליצירת לוח קומיקס מטורף המציג את הסצנות פאנל אחר פאנל. ולסיום — צור ריל קולנועי זז ישירות מהפאנלים שהופקו. שמור את התוצרים שלך — כל יום הוא פרק חדש בארכיון הקולנועי האישי שלך.",
        },
      ],
      quote: "Don't just live your story — direct it.",
    },
    en: {
      title: 'ABOUT',
      sections: [
        {
          h: 'Vision: From Life to Script, From Script to Comic',
          p: 'We all live inside a story. LIFESCRIPT takes the real events of your day — a conversation that happened, a moment that passed, an emotion that stayed — and elevates them to full cinematic production. Write a script. Generate a poster. Create a comic.',
        },
        {
          h: 'Intelligent Multi-Provider AI Engine',
          p: 'Behind every click, an engine simultaneously races multiple world-class language models — Gemini Flash, Gemma, and DeepSeek — automatically selecting the fastest model that returns a perfect result. For visuals, a smart cascade of image providers — Gemini, FLUX, Cloudflare AI, and more — ensures your poster and panels are always delivered, even under heavy global load.',
        },
        {
          h: 'From Script to Storyboard',
          p: "Once your script is ready, LIFESCRIPT continues production: it analyzes scenes, breaks them into 5–7 panels, and generates each independently — in your chosen style: Anime Studio, Marvel Retro, or Cinematic Noir. Panels appear progressively the moment they're ready, so your creation reveals itself scene by scene.",
        },
        {
          h: 'How to Direct Your Best Story',
          p: "Write honestly — at least three sentences describing what happened, how you felt, and who was there. Once the AI generates your script, you have full control to edit, refine, and perfect it. Next, generate a stunning Movie Poster to serve as the cover of your story, then transform it into an awesome multi-panel comic book. Finally, create a cinematic Reel directly from your generated panels. Save your creations — every day is a new chapter in your personal cinematic archive.",
        },
      ],
      quote: "Don't just live your story — direct it.",
    },
  },
};
