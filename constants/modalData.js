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
          h: '2. מסלולים, מכסות ושימוש הוגן',
          p: 'LIFESCRIPT מציעה מסלול חינמי ומסלול Pro. במסלול החינמי: 3 תסריטים, פוסטר אחד וקומיקס אחד ביום, וכן פוסטר "לככב בסיפור" אחד חינם (חד-פעמי). במסלול Pro (9$ לחודש): תסריטים ללא הגבלה, עד 3 פוסטרים ו-2 קומיקסים ביום, עד 7 פאנלים לקומיקס, יצירת רילז ותור עיבוד מועדף. גולשים שאינם רשומים מוגבלים ל-2 תסריטים ביום. המגבלות היומיות מתאפסות בחצות UTC, ונועדו לשמור על איכות השירות לכלל המשתמשים.',
        },
        {
          h: '3. חיוב, חידוש וביטול מנוי',
          p: 'מנוי Pro מחויב 9$ לחודש דרך Stripe ומתחדש אוטומטית מדי חודש עד לביטול. ניתן לבטל בכל עת דרך "נהל מנוי" בתפריט החשבון; הביטול נכנס לתוקף בתום תקופת החיוב הנוכחית, ולא יתבצע חיוב נוסף לאחריו. אנחנו לא רואים ולא שומרים את פרטי כרטיס האשראי שלך — כל נתוני התשלום מנוהלים ומאובטחים על ידי Stripe. בכל שאלה בנושא חיוב או החזר ניתן לפנות אלינו דרך התמיכה.',
        },
        {
          h: '4. הגנת תוכן וניקוי קלטים אוטומטי',
          p: 'כל טקסט שנשלח למערכת עובר ניקוי אוטומטי לסינון HTML, תגיות זדוניות והזרקות קוד. חל איסור מוחלט לנסות לעקוף מנגנונים אלו, להשתמש בטכניקות Prompt Injection לשינוי התנהגות ה-AI, או להזין תוכן פוגעני, אלים, פורנוגרפי, גזעני או תוכן המופנה כלפי קטינים.',
        },
        {
          h: '5. "לככב בסיפור" — העלאת תמונות פנים',
          p: 'בעת שימוש בפיצ\'ר "לככב בסיפור" עליך להעלות אך ורק תמונה של עצמך, או של אדם שנתן לכך את הסכמתו המפורשת. חל איסור מוחלט להעלות תמונות של קטינים או של אדם ללא הסכמתו. התמונה מעובדת ליצירת "גיליון דמות" ונשמרת באחסון מוצפן למשך עד 90 יום לצורך שימוש חוזר, ולאחר מכן נמחקת אוטומטית. פירוט מלא במדיניות הפרטיות.',
        },
        {
          h: '6. ביצועי השירות ואדפטציה דינמית',
          p: 'המערכת פועלת עם ארכיטקטורת Circuit Breaker שמנתבת כל בקשה לספק הזמין ביותר בזמן אמת. מהירות יצירת תמונות ותסריטים עשויה להשתנות בהתאם לזמינות ספקים גלובליים. שינויים אלו אינם מהווים כשל שירות — אלא מנגנון איזון חכם.',
        },
        {
          h: '7. הגבלת גיל, AI ושירותי צד שלישי',
          p: 'השירות מיועד למשתמשים מגיל 13 ומעלה; רכישת מנוי בתשלום מחייבת גיל 18 ומעלה או אישור אפוטרופוס. LIFESCRIPT משתמשת בשירותי AI חיצוניים (Google AI, OpenRouter ואחרים). אנחנו לא אחראים לשינויים במדיניות ספקים אלו. התוכן שנוצר מבוסס על בינה מלאכותית ועשוי להכיל אי-דיוקים; האחריות על השימוש בו חלה על המשתמש בלבד.',
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
          h: '2. Plans, Quotas & Fair Use',
          p: 'LIFESCRIPT offers a Free plan and a Pro plan. Free plan: 3 scripts, 1 poster, and 1 comic per day, plus one free "Star Yourself" poster (one-time). Pro plan ($9/month): unlimited scripts, up to 3 posters and 2 comics per day, up to 7 comic panels, reels generation, and a priority processing queue. Unregistered visitors are limited to 2 scripts per day. Daily limits reset at UTC midnight and exist to maintain quality service for all users.',
        },
        {
          h: '3. Billing, Renewal & Cancellation',
          p: 'The Pro subscription is billed at $9/month via Stripe and renews automatically each month until cancelled. You can cancel anytime via "Manage Subscription" in the account menu; cancellation takes effect at the end of the current billing period, with no further charges afterward. We never see or store your card details — all payment data is handled and secured by Stripe. For any billing or refund question, contact us via support.',
        },
        {
          h: '4. Content Protection & Automatic Input Sanitization',
          p: 'All text submitted to the system is automatically sanitized to filter HTML, malicious tags, and injection attempts. It is strictly forbidden to bypass these mechanisms, use prompt-injection techniques to alter AI behavior, or submit offensive, violent, pornographic, racist, or minors-targeted content.',
        },
        {
          h: '5. "Star Yourself" — Uploading Face Photos',
          p: 'When using the "Star Yourself" feature, you must upload only a photo of yourself, or of a person who has given explicit consent. Uploading photos of minors or of any person without their consent is strictly forbidden. The image is processed into a "Character Sheet" and stored in encrypted storage for up to 90 days for reuse, after which it is automatically deleted. See the Privacy Policy for full details.',
        },
        {
          h: '6. Service Performance & Dynamic Adaptation',
          p: 'The system operates a Circuit Breaker architecture that routes each request to the most available provider in real time. Image and script generation speed may vary based on global provider availability. These variations are not service failures — they are intelligent load balancing.',
        },
        {
          h: '7. Age Restriction, AI & Third-Party Services',
          p: 'This service is intended for users aged 13 and above; purchasing a paid subscription requires you to be 18 or older, or to have guardian approval. LIFESCRIPT uses third-party AI services (Google AI, OpenRouter, and others). We are not responsible for changes in their policies. AI-generated content may contain inaccuracies; the user bears sole responsibility for how it is used.',
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
          h: '1. התוכן שאתה יוצר נשאר אצלך',
          p: 'התסריטים, הפוסטרים ופאנלי הקומיקס שאתה יוצר אינם נשמרים בשרתים שלנו. היסטוריית ההפקות שלך נשמרת אך ורק בזיכרון המקומי (localStorage) של הדפדפן שלך, על המכשיר שלך בלבד — אנחנו לא יכולים לראות אותה, והיא נמחקת ברגע שאתה מנקה את נתוני הדפדפן.',
        },
        {
          h: '2. תמונות "לככב בסיפור"',
          p: 'כשאתה מעלה תמונת פנים לפיצ\'ר "לככב בסיפור", היא מעובדת ליצירת "גיליון דמות" ונשמרת באחסון ענן מוצפן (Cloudflare R2) למשך עד 90 יום — כדי שתוכל לככב שוב בלי להעלות מחדש. בתום התקופה התמונה נמחקת אוטומטית. אנחנו שומרים רק מצביע (קישור) לתמונה, ולעולם לא משתמשים בפנים שלך לאימון מודלים או לכל מטרה אחרת.',
        },
        {
          h: '3. חשבון והתחברות',
          p: 'אם אתה נרשם, אנחנו שומרים את כתובת האימייל והשם שלך (מ-Google או מקישור הכניסה) כדי לנהל את החשבון, המכסה והמנוי שלך. זהו המידע המזהה אישית היחיד שאנחנו מחזיקים.',
        },
        {
          h: '4. נתוני שימוש ומכסות',
          p: 'כדי לאכוף את המגבלות היומיות ההוגנות, אנחנו סופרים כמה תסריטים, פוסטרים וקומיקסים יצרת ביום נתון. מונים אלו נשמרים זמנית (Redis) ומתאפסים בחצות UTC.',
        },
        {
          h: '5. תשלומים',
          p: 'תשלומי מנוי ה-Pro מעובדים במלואם על ידי Stripe. אנחנו לעולם לא רואים, מקבלים או שומרים את פרטי כרטיס האשראי שלך — אנחנו שומרים רק מזהה לקוח של Stripe המקושר לחשבונך, לצורך ניהול המנוי.',
        },
        {
          h: '6. עוגיות ואנליטיקה',
          p: 'אנחנו משתמשים בעוגיות חיוניות לשמירת ההתחברות שלך, ובעוגיית הזמנה (ls_ref) לזיהוי החבר שהזמין אותך (נמחקת לאחר 30 יום). בנוסף אנחנו משתמשים ב-Google Analytics וב-Vercel Analytics לאיסוף נתוני שימוש מצטברים ואנונימיים שעוזרים לנו לשפר את השירות. נתונים אלו אינם מזהים אותך אישית.',
        },
        {
          h: '7. עיבוד מאובטח דרך ספקי AI מובילים',
          p: 'הטקסט והתמונות שלך מועברים בצורה מוצפנת (HTTPS) לשרתי Google AI, OpenRouter ושרתים מובילים נוספים בתחום, לצורך יצירת התסריט והתמונות. שירותים אלו אינם שומרים את התוכן שלך לאחר השלמת הבקשה ואינם משתמשים בו למטרות פרסום.',
        },
        {
          h: '8. אנחנו לא מוכרים מידע',
          p: 'אנחנו לא מוכרים, לא משתפים ולא מעבדים את הקלטים שלך לשום מטרה פרסומית או מסחרית. LIFESCRIPT מרוויחה מהיכולת לייצר עבורך — לא ממה שאתה כותב.',
        },
        {
          h: '9. הזכויות שלך',
          p: 'אתה יכול לבקש בכל עת למחוק את חשבונך, את תמונות הפנים שהעלית או כל מידע אחר שאנחנו מחזיקים. פנה אלינו דרך "יומן הבמאי" או התמיכה, ונטפל בבקשתך.',
        },
      ],
    },
    en: {
      title: 'PRIVACY',
      summary: '"Your privacy is the most important script we protect."',
      sections: [
        {
          h: '1. The Content You Create Stays Yours',
          p: 'The scripts, posters, and comic panels you create are not stored on our servers. Your production history is saved only in your browser\'s local storage (localStorage), on your device alone — we cannot see it, and it is erased the moment you clear your browser data.',
        },
        {
          h: '2. "Star Yourself" Photos',
          p: 'When you upload a face photo for the "Star Yourself" feature, it is processed into a "Character Sheet" and stored in encrypted cloud storage (Cloudflare R2) for up to 90 days — so you can star again without re-uploading. After that period the photo is automatically deleted. We store only a pointer (URL) to the image, and we never use your face to train models or for any other purpose.',
        },
        {
          h: '3. Account & Sign-In',
          p: 'If you sign up, we store your email address and name (from Google or the magic-link sign-in) to manage your account, quota, and subscription. This is the only personally identifying information we hold.',
        },
        {
          h: '4. Usage & Quota Data',
          p: 'To enforce fair daily limits, we count how many scripts, posters, and comics you created on a given day. These counters are stored temporarily (Redis) and reset at UTC midnight.',
        },
        {
          h: '5. Payments',
          p: 'Pro subscription payments are processed entirely by Stripe. We never see, receive, or store your card details — we store only a Stripe customer ID linked to your account, for the purpose of managing the subscription.',
        },
        {
          h: '6. Cookies & Analytics',
          p: 'We use essential cookies to keep you signed in, and a referral cookie (ls_ref) to recognize the friend who invited you (deleted after 30 days). We also use Google Analytics and Vercel Analytics to collect aggregate, anonymous usage data that helps us improve the service. This data does not personally identify you.',
        },
        {
          h: '7. Secure Processing via Trusted AI Providers',
          p: 'Your text and images are transmitted over encrypted HTTPS to Google AI, OpenRouter, and other industry-leading AI infrastructure providers, for the purpose of generating scripts and images. These services do not retain your content after a request is completed and do not use it for advertising.',
        },
        {
          h: "8. We Don't Sell Your Data",
          p: "We do not sell, share, or repurpose your inputs for any advertising or commercial purpose. LIFESCRIPT profits from the ability to generate for you — not from what you write.",
        },
        {
          h: '9. Your Rights',
          p: 'You can request at any time to delete your account, the face photos you uploaded, or any other data we hold. Contact us via the "Director\'s Log" or support, and we will handle your request.',
        },
      ],
    },
  },

  // ─── Accessibility Statement ───────────────────────────────────────────────

  accessibility: {
    he: {
      title: 'נגישות',
      summary: 'הצהרת הנגישות עודכנה לאחרונה ביוני 2026.',
      sections: [
        {
          h: 'המחויבות שלנו',
          p: 'LIFESCRIPT Studio רואה חשיבות עליונה במתן שירות נגיש ושוויוני לכלל המשתמשים, לרבות אנשים עם מוגבלות. אנו פועלים להנגיש את האתר ולשפרו באופן מתמשך, מתוך אמונה שהחוויה הקולנועית צריכה להיות פתוחה לכולם.',
        },
        {
          h: 'תקן ורמת ההתאמה',
          p: 'האתר נבנה בהשראת המלצות התקן הישראלי ת"י 5568 והנחיות הנגישות הבינלאומיות WCAG 2.0 ברמה AA, ככל שהדבר ניתן בפלטפורמה. אנו נעזרים בניגודיות צבעים גבוהה, טקסט קריא, ותמיכה בהתאמות תצוגה במכשירים שונים.',
        },
        {
          h: 'התאמות חלקיות',
          p: 'ייתכן שחלקים מסוימים באתר טרם הונגשו במלואם או נמצאים עדיין בתהליך התאמה. אנו ממשיכים לפעול לשיפור מתמיד ומתחייבים לטפל בכל פנייה בנושא בהקדם האפשרי.',
        },
        {
          h: 'נתקלתם במכשול? ספרו לנו',
          p: 'אם נתקלתם בקושי או במגבלת נגישות באתר, נשמח שתעדכנו אותנו כדי שנוכל לתקן. ניתן לפנות אלינו דרך "יומן הבמאי" באתר (כפתור המשוב), וצוות LIFESCRIPT ישתדל להגיב לכל פנייה בתוך זמן סביר.',
        },
      ],
    },
    en: {
      title: 'ACCESSIBILITY',
      summary: 'This accessibility statement was last updated in June 2026.',
      sections: [
        {
          h: 'Our Commitment',
          p: 'LIFESCRIPT Studio places great importance on providing an accessible, equitable service to all users, including people with disabilities. We work to make the site accessible and to improve it continuously, in the belief that the cinematic experience should be open to everyone.',
        },
        {
          h: 'Standard & Conformance Level',
          p: 'The site is built following the recommendations of Israeli Standard SI 5568 and the international WCAG 2.0 Level AA accessibility guidelines, to the extent feasible on the platform. We rely on high color contrast, readable text, and support for display adaptations across devices.',
        },
        {
          h: 'Partial Conformance',
          p: 'Some parts of the site may not yet be fully accessible or may still be undergoing adaptation. We continue working toward ongoing improvement and are committed to addressing any accessibility request as soon as possible.',
        },
        {
          h: 'Hit a Barrier? Tell Us',
          p: 'If you encounter any difficulty or accessibility limitation on the site, we’d be glad to hear from you so we can fix it. You can reach us through the "Director\'s Log" on the site (the feedback button), and the LIFESCRIPT team will do its best to respond to every request within a reasonable time.',
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
        {
          h: 'איך "מלככבים" בפוסטר עם הפנים שלי?',
          p: 'בשלב יצירת הפוסטר או הקומיקס תמצא אפשרות להעלות תמונת פנים. ה-AI בונה ממנה "גיליון דמות" ומחדיר אותך לסצנות. כל משתמש רשום מקבל פוסטר אחד חינם להתנסות; מנויי Pro מקבלים מכסה חודשית. שים לב — מותר להעלות רק את הפנים שלך, או של מי שנתן הסכמה.',
        },
        {
          h: 'איך עובד "הזמן חברים"?',
          p: 'בתפריט החשבון (אחרי התחברות) לחץ על "הזמן חברים" כדי לקבל קישור אישי. על כל חבר שנרשם דרך הקישור ויוצר פוסטר ראשון — אתה מקבל פוסטר "לככב בסיפור" חינם נוסף. אפשר לעקוב אחרי כמה חברים הצטרפו וכמה פוסטרים צברת ישירות בחלון.',
        },
        {
          h: 'איך משדרגים ל-Pro, ואיך מבטלים?',
          p: 'לחץ על "שדרג לפרו" בנאבבר או בתפריט החשבון — התשלום מאובטח דרך Stripe (9$ לחודש). לביטול, פתח את "נהל מנוי" בתפריט החשבון; הביטול נכנס לתוקף בתום החודש הנוכחי ולא תחויב שוב.',
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
        {
          h: 'How do I "star" in the poster with my own face?',
          p: 'During poster or comic generation you\'ll find an option to upload a face photo. The AI builds a "Character Sheet" from it and casts you into the scenes. Every registered user gets one free poster to try it; Pro members get a monthly allowance. Note — only upload your own face, or someone who has consented.',
        },
        {
          h: 'How does "Invite friends" work?',
          p: 'In the account menu (after signing in), tap "Invite friends" to get a personal link. For every friend who signs up through it and makes their first poster, you earn a free "Star Yourself" poster. You can track how many friends joined and how many posters you\'ve earned right inside the window.',
        },
        {
          h: 'How do I upgrade to Pro, and how do I cancel?',
          p: 'Click "Go Pro" in the navbar or account menu — payment is secured by Stripe ($9/month). To cancel, open "Manage Subscription" in the account menu; cancellation takes effect at the end of the current month and you won\'t be charged again.',
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
          h: 'לככב בסיפור שלך',
          p: 'הפיצ\'ר החתום שלנו: העלה תמונת פנים, וה-AI יהפוך אותך לדמות הראשית בפוסטר ובקומיקס שלך. אנחנו בונים "גיליון דמות" עקבי כדי שתיראה כמוך לאורך כל הסצנות. כל משתמש רשום מקבל פוסטר "לככב בסיפור" אחד חינם להתנסות; מנויי Pro מקבלים מכסה חודשית נדיבה.',
        },
        {
          h: 'חינמי, Pro והזמנת חברים',
          p: 'במסלול החינמי תכתוב 3 תסריטים, פוסטר וקומיקס ביום — מספיק כדי להתאהב. מסלול Pro (9$ לחודש) פותח תסריטים ללא הגבלה, יותר פוסטרים וקומיקסים ביום, רילז ותור עיבוד מועדף. ויש בונוס: על כל חבר שתזמין שנרשם ויוצר פוסטר ראשון — אתה מקבל פוסטר "לככב בסיפור" חינם נוסף.',
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
          h: 'Star in Your Own Story',
          p: 'Our signature feature: upload a face photo, and the AI turns you into the lead character of your own poster and comic. We build a consistent "Character Sheet" so you look like yourself across every scene. Every registered user gets one free "Star Yourself" poster to try it; Pro members get a generous monthly allowance.',
        },
        {
          h: 'Free, Pro & Inviting Friends',
          p: 'On the Free plan you write 3 scripts, a poster, and a comic each day — enough to fall in love. Pro ($9/month) unlocks unlimited scripts, more posters and comics per day, reels, and a priority queue. And there\'s a bonus: for every friend you invite who signs up and makes their first poster, you earn another free "Star Yourself" poster.',
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
