import { RETENTION } from '../config/limits.js';
import { termsPlansHe, termsPlansEn, faqPlansHe, faqPlansEn, uploadsSentenceHe, uploadsSentenceEn, privacyFaceHe, privacyFaceEn, privacyUsageHe, privacyUsageEn, termsFaceHe, termsFaceEn, storedFilesHe, storedFilesEn } from './limits-copy.js';

import { privacyAccountHe, privacyAccountEn, privacyProvidersHe, privacyProvidersEn, privacySharingHe, privacySharingEn } from './ai-provider-copy.js';

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
          h: '2. מכסות ושימוש הוגן',
          p: termsPlansHe(),
        },
        {
          h: '3. תשלומים',
          p: 'LIFESCRIPT חינמית לשימוש ואינה גובה תשלומים. אם אי פעם יוצעו פיצ\'רים בתשלום, תנאים אלה יעודכנו לפני כן והמחיר יוצג לפני התשלום.',
        },
        {
          h: '4. הגנת תוכן וניקוי קלטים אוטומטי',
          p: 'כל טקסט שנשלח למערכת עובר ניקוי אוטומטי לסינון HTML, תגיות זדוניות והזרקות קוד. חל איסור מוחלט לנסות לעקוף מנגנונים אלו, להשתמש בטכניקות Prompt Injection לשינוי התנהגות ה-AI, או להזין תוכן פוגעני, אלים, פורנוגרפי, גזעני או תוכן המופנה כלפי קטינים.',
        },
        {
          h: '5. "לככב בסיפור" — תמונות פנים ומידע ביומטרי',
          p: termsFaceHe(),
        },
        {
          h: '6. ביצועי השירות ואדפטציה דינמית',
          p: 'המערכת פועלת עם ארכיטקטורת Circuit Breaker שמנתבת כל בקשה לספק הזמין ביותר בזמן אמת. מהירות יצירת תמונות ותסריטים עשויה להשתנות בהתאם לזמינות ספקים גלובליים. שינויים אלו אינם מהווים כשל שירות — אלא מנגנון איזון חכם.',
        },
        {
          h: '7. הגבלת גיל, AI ושירותי צד שלישי',
          p: 'LifeScript מיועדת לבני 18 ומעלה. שירותי ה-AI שבהם אנחנו משתמשים דורשים משתמשים בוגרים, והסיפורים שנוצרים עשויים לכלול נושאים בוגרים. בהמשך שימוש אתה מצהיר שאתה בן/בת 18 ומעלה. הפיצ\'ר "לככב בסיפור" (העלאת תמונת פנים) דורש בנוסף אישור נפרד, חד-פעמי, שאתה בן/בת 18 ומעלה. LIFESCRIPT משתמשת בשירותי AI חיצוניים דרך OpenRouter (בהם Google, xAI, Black Forest Labs ו-DeepInfra) וב-Cloudflare; ראה מדיניות הפרטיות, סעיף 7. אנחנו לא אחראים לשינויים במדיניות ספקים אלו. התוכן שנוצר מבוסס על בינה מלאכותית ועשוי להכיל אי-דיוקים; האחריות על השימוש בו חלה על המשתמש בלבד.',
        },
        {
          h: '8. אחריות, אחריות על תוכן המשתמש ושיפוי',
          p: 'השירות מסופק "כמות שהוא" (AS IS) וללא אחריות מכל סוג. במידה המרבית המותרת בדין, LIFESCRIPT לא תישא באחריות לנזק עקיף, תוצאתי או מיוחד, וחבותה הכוללת לא תעלה על הסכום ששילמת בפועל ב-12 החודשים שקדמו לאירוע. אתה האחראי הבלעדי לכל טקסט וכל תוכן שאתה מזין למערכת, ומצהיר כי יש לך את מלוא הזכויות להזינו וכי אינו מפר זכויות צד שלישי, חוק או צו. אתה מתחייב לשפות את LIFESCRIPT בגין כל תביעה, נזק או הוצאה (לרבות שכ"ט עו"ד) הנובעים מהתוכן שהזנת או מהפרת תנאים אלו.',
        },
        {
          h: '9. דין חל, שינויים ויצירת קשר',
          p: 'על תנאים אלו יחולו דיני מדינת ישראל, ומקום השיפוט הבלעדי יהיה בתל אביב. אנו רשאים לעדכן תנאים אלו מעת לעת; המשך השימוש לאחר עדכון מהווה הסכמה. השירות מופעל תחת השם LIFESCRIPT. בכל שאלה, בקשת מחיקה או פנייה בנושא פרטיות ניתן לפנות אל adialamo@gmail.com.',
        },
      ],
      summary: 'עודכן לאחרונה: 28 באוקטובר 2026',
    },
    en: {
      title: 'TERMS',
      sections: [
        {
          h: '1. Full Ownership of Creations',
          p: 'All scripts, posters, comic panels, and any content generated for you belong entirely and exclusively to you. LIFESCRIPT makes no claim of ownership over your creations — not your stories, characters, or the visual output generated on your behalf.',
        },
        {
          h: '2. Quotas & Fair Use',
          p: termsPlansEn(),
        },
        {
          h: '3. Payments',
          p: 'LIFESCRIPT is free to use and does not collect payments. If paid features are ever offered, these terms will be updated first and the price will be shown before you pay.',
        },
        {
          h: '4. Content Protection & Automatic Input Sanitization',
          p: 'All text submitted to the system is automatically sanitized to filter HTML, malicious tags, and injection attempts. It is strictly forbidden to bypass these mechanisms, use prompt-injection techniques to alter AI behavior, or submit offensive, violent, pornographic, racist, or minors-targeted content.',
        },
        {
          h: '5. "Star Yourself" — Face Photos & Biometric Data',
          p: termsFaceEn(),
        },
        {
          h: '6. Service Performance & Dynamic Adaptation',
          p: 'The system operates a Circuit Breaker architecture that routes each request to the most available provider in real time. Image and script generation speed may vary based on global provider availability. These variations are not service failures — they are intelligent load balancing.',
        },
        {
          h: '7. Age Restriction, AI & Third-Party Services',
          p: 'LifeScript is intended for adults aged 18 and over. The AI services we use require adult users, and generated stories may include mature themes. By continuing to use the service you confirm that you are 18 or older. The "Star Yourself" feature (uploading a face photo) additionally asks you to confirm once, separately, that you are 18 or older. LIFESCRIPT uses third-party AI services through OpenRouter (including Google, xAI, Black Forest Labs and DeepInfra) and Cloudflare; see the Privacy Policy, section 7. We are not responsible for changes in their policies. AI-generated content may contain inaccuracies; the user bears sole responsibility for how it is used.',
        },
        {
          h: '8. Warranty, Responsibility for Your Content & Indemnification',
          p: 'The service is provided "AS IS," without warranty of any kind. To the maximum extent permitted by law, LIFESCRIPT shall not be liable for any indirect, consequential, or special damages, and its total liability shall not exceed the amount you actually paid in the 12 months preceding the event. You are solely responsible for any text or content you submit, and you represent that you have full rights to submit it and that it infringes no third-party right, law, or order. You agree to indemnify LIFESCRIPT against any claim, damage, or expense (including legal fees) arising from your content or your breach of these terms.',
        },
        {
          h: '9. Governing Law, Changes & Contact',
          p: 'These terms are governed by the laws of the State of Israel, with exclusive jurisdiction in Tel Aviv. We may update these terms from time to time; continued use after an update constitutes acceptance. The service operates under the name LIFESCRIPT. For any question, deletion request, or privacy matter, contact adialamo@gmail.com.',
        },
      ],
      summary: 'Last updated: 28 October 2026',
    },
  },

  // ─── Privacy Policy ────────────────────────────────────────────────────────

  // The AI-provider and storage wording (privacy §1, §2, §4, §6, §7, §8 and terms §5) follows the providers' public terms and the retention values in config/limits.js. Re-read it whenever a provider, a plan or a retention setting changes.
  privacy: {
    he: {
      title: 'פרטיות',
      summary: '"הפרטיות שלך היא התסריט הכי חשוב שאנחנו מגנים עליו." · עודכן 29 באוקטובר 2026',
      sections: [
        {
          h: '1. מה נשמר ומה לא',
          p: 'הטקסט שאתה כותב (יומן, תסריט) אינו נשמר על ידינו במסד נתונים, וההיסטוריה שלך נשמרת בזיכרון המקומי (localStorage) של הדפדפן שלך. שים לב: הטקסט נשלח לספקי AI חיצוניים כדי ליצור את התוצר (ראה סעיף 7). פוסטרים ופאנלי קומיקס שנוצרו עשויים להישמר גם באחסון ענן (Cloudflare R2) בכתובת אינטרנט אקראית שאינה מופיעה באף רשימה, כדי שיהיה אפשר להציג ולשתף אותם; מי שמחזיק בכתובת יכול לפתוח את הקובץ. ' + storedFilesHe() + ' קבצים שנוצרו לפני אוקטובר 2026 עשויים להישמר בכתובת פחות אקראית, וניתן לבקש את מחיקתם (סעיף 9). הדפדפן שומר במכשיר בלבד גם כמה הגדרות: שם היוצר, אישור "אני בן/בת 18 ומעלה" שנתן מי שלא התחבר, בחירת העוגיות והתקדמות במדריך. הן אינן נשלחות אלינו. התנתקות מהחשבון מסירה מהמכשיר את ההיסטוריה השמורה, את שם היוצר ואת הקישור לדמות שלך.',
        },
        {
          h: '2. תמונות "לככב בסיפור"',
          p: privacyFaceHe(),
        },
        {
          h: '3. חשבון והתחברות',
          p: privacyAccountHe(),
        },
        {
          h: '4. נתוני שימוש ומכסות',
          p: privacyUsageHe(),
        },
        {
          h: '5. תשלומים',
          p: 'LIFESCRIPT חינמית לשימוש ואינה גובה תשלומים, ולכן אין בידינו פרטי תשלום או כרטיס אשראי.',
        },
        {
          h: '6. עוגיות ואנליטיקה',
          p: 'אנחנו משתמשים בעוגיות חיוניות לשמירת ההתחברות שלך, ובעוגיית הזמנה (ls_ref) לזיהוי החבר שהזמין אותך (נמחקת לאחר ' + RETENTION.referralCookieDays + ' יום). אנחנו משתמשים ב-Vercel Web Analytics, שאינו משתמש בעוגיות לזיהוי מבקרים: מבקר מזוהה באמצעות גיבוב (hash) זמני של הבקשה, שנמחק אוטומטית לאחר יממה, והנתונים המתקבלים הם מצטברים — כגון עמודים שנצפו, אתר מפנה, מיקום משוער (מדינה, אזור ועיר), סוג מכשיר, מערכת הפעלה ודפדפן, ואירועי שימוש בפיצ\'רים כמו יצירת תסריט או שיתוף. הוא פועל באתר ובאפליקציית האנדרואיד. באתר בלבד, ורק לאחר שתאשרו עוגיות אנליטיקה, אנחנו טוענים גם את Google Analytics, שקובע מזהים (עוגיות) ומעבד נתונים כמו כתובת ה-IP ופרטי המכשיר כדי לספק לנו סטטיסטיקות שימוש; איננו משתמשים בו לפרסום. Google Analytics פועל לפי בחירת הסכמה השמורה במכשיר שלכם (Google Consent Mode: אחסון האנליטיקה מוגדר כברירת מחדל כ-"denied" והופך ל-"granted" רק כשתאשרו; אחסון הפרסום חסום תמיד). לפני שתחליטו הוא אינו נטען ושום דבר אינו נשלח ל-Google; אם תאשרו הוא נטען ומתחיל לספור את הביקורים שלכם; אם תסרבו הוא לא ייטען לעולם. אפשר לאפס את הבחירה על ידי ניקוי נתוני האתר בדפדפן. הוא אינו נטען לעולם באפליקציית האנדרואיד.',
        },
        {
          h: '7. עיבוד על ידי ספקי AI חיצוניים',
          p: privacyProvidersHe(),
        },
        {
          h: '8. אנחנו לא מוכרים מידע',
          p: privacySharingHe(),
        },
        {
          h: '9. הזכויות שלך ובעל המאגר',
          p: 'אתה יכול לבקש בכל עת לעיין במידע שלך, לתקנו או למחוק את חשבונך, את תמונות הפנים שהעלית או כל מידע אחר שאנחנו מחזיקים. ניתן להגיש בקשת מחיקה דרך עמוד מחיקת החשבון והמידע שלנו — באפליקציה ובאתר, בתפריט החשבון, בחרו "מחק את החשבון שלי" והעמוד ייפתח עם האימייל שלכם כבר ממולא — או ישירות במייל adialamo@gmail.com. לפני כל מחיקה אנחנו מאמתים שהבקשה הוגשה על ידי בעל החשבון (בקשה שנשלחת בזמן שאתה מחובר מאומתת אוטומטית, אחרת נאשר מול הכתובת) — ונטפל בכל בקשה מאומתת תוך 30 ימים מקבלתה (אם נצטרך לאשר אותה מולכם קודם, 30 הימים נספרים מרגע האישור שלכם).',
        },
      ],
    },
    en: {
      title: 'PRIVACY',
      summary: '"Your privacy is the most important script we protect." · Updated 29 October 2026',
      sections: [
        {
          h: '1. What We Store and What We Don\'t',
          p: 'The text you write (diary, script) is not stored by us in a database, and your history is kept in your browser\'s local storage (localStorage). Note: the text is sent to external AI providers to produce the result (see section 7). Generated posters and comic panels may also be stored in cloud storage (Cloudflare R2) at a random web address that is not listed anywhere, so they can be displayed and shared; anyone who has the address can open the file. ' + storedFilesEn() + ' Files created before October 2026 may be stored at a less random address, and you can ask us to delete them (section 9). Your browser also keeps a few settings on this device only: your creator name, the "I am 18 or older" confirmation given by visitors who are not signed in, your cookie choice and your guided-tour progress. They are not sent to us. Signing out removes the saved history, the creator name and the link to your character from this device.',
        },
        {
          h: '2. "Star Yourself" Photos',
          p: privacyFaceEn(),
        },
        {
          h: '3. Account & Sign-In',
          p: privacyAccountEn(),
        },
        {
          h: '4. Usage & Quota Data',
          p: privacyUsageEn(),
        },
        {
          h: '5. Payments',
          p: 'LIFESCRIPT is free to use and does not collect payments, so we hold no payment or card details.',
        },
        {
          h: '6. Cookies & Analytics',
          p: 'We use essential cookies to keep you signed in, and a referral cookie (ls_ref) to recognize the friend who invited you (deleted after ' + RETENTION.referralCookieDays + ' days). We use Vercel Web Analytics, which does not use cookies to identify visitors: a visitor is counted using a temporary hash of the request that is discarded automatically after a day, and the data is aggregate — such as pages viewed, referrer, approximate location (country, region and city), device type, operating system and browser, and feature-usage events such as creating a script or sharing. It runs on the website and in the Android app. On the website only, and only after you accept analytics cookies, we also load Google Analytics, which sets identifiers (cookies) and processes data such as your IP address and device information to give us usage statistics; we do not use it for advertising. Google Analytics works with a consent choice that is stored on your device (Google Consent Mode: analytics storage is "denied" by default and becomes "granted" only when you accept; advertising storage is always denied). Before you decide it is not loaded and nothing is sent to Google; if you accept it is loaded and starts counting your visits; if you decline it is never loaded. You can reset the choice by clearing this site\'s data in your browser. It is never loaded in the Android app.',
        },
        {
          h: '7. Processing by External AI Providers',
          p: privacyProvidersEn(),
        },
        {
          h: "8. We Don't Sell Your Data",
          p: privacySharingEn(),
        },
        {
          h: '9. Your Rights & Data Controller',
          p: 'You can request at any time to access your data, correct it, or delete your account, the face photos you uploaded, or any other data we hold. You can submit a deletion request through our account & data deletion page — in the app and on the website, open the account menu and choose "Delete my account" and the page opens with your email already filled in — or directly at adialamo@gmail.com. Before anything is deleted we verify that the request comes from the account owner (a request sent while you are signed in is verified automatically, otherwise we confirm with the address) — and we process every verified request within 30 days of receiving it (if we need to confirm it with you first, the 30 days count from your confirmation).',
        },
      ],
    },
  },

  // ─── Accessibility Statement ───────────────────────────────────────────────

  accessibility: {
    he: {
      title: 'נגישות',
      summary: 'הצהרת הנגישות עודכנה לאחרונה באוקטובר 2026.',
      sections: [
        {
          h: 'המחויבות שלנו',
          p: 'LIFESCRIPT Studio רואה חשיבות עליונה במתן שירות נגיש ושוויוני לכלל המשתמשים, לרבות אנשים עם מוגבלות. אנו פועלים להנגיש את האתר ולשפרו באופן מתמשך, מתוך אמונה שהחוויה הקולנועית צריכה להיות פתוחה לכולם.',
        },
        {
          h: 'תקן ורמת ההתאמה',
          p: 'LifeScript שואפת לפעול לפי המלצות התקן הישראלי ת"י 5568 והנחיות WCAG 2.0 ברמה AA, וממשיכה לשפר את הנגישות. אם משהו לא עובד עבורכם, נשמח שתפנו אלינו (ראו בהמשך).',
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
      summary: 'This accessibility statement was last updated in October 2026.',
      sections: [
        {
          h: 'Our Commitment',
          p: 'LIFESCRIPT Studio places great importance on providing an accessible, equitable service to all users, including people with disabilities. We work to make the site accessible and to improve it continuously, in the belief that the cinematic experience should be open to everyone.',
        },
        {
          h: 'Standard & Conformance Level',
          p: 'LifeScript aims to follow the recommendations of Israeli Standard SI 5568 and WCAG 2.0 Level AA, and we are continuing to improve accessibility. If something isn\'t working for you, please contact us (see below).',
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
          p: 'בשלב יצירת הפוסטר או הקומיקס תמצא אפשרות להעלות תמונת פנים. ה-AI בונה ממנה "גיליון דמות" ומחדיר אותך לסצנות. כל משתמש רשום מקבל פוסטר אחד חינם להתנסות. ' + uploadsSentenceHe() + ' שים לב — הפיצ\'ר מיועד לבני 18 ומעלה, ומותר להעלות רק את הפנים שלך, או של בגיר שנתן הסכמה.',
        },
        {
          h: 'איך עובד "הזמן חברים"?',
          p: 'בתפריט החשבון (אחרי התחברות) לחץ על "הזמן חברים" כדי לקבל קישור אישי. על כל חבר שנרשם דרך הקישור ויוצר פוסטר ראשון — אתה מקבל פוסטר "לככב בסיפור" חינם נוסף. אפשר לעקוב אחרי כמה חברים הצטרפו וכמה פוסטרים צברת ישירות בחלון.',
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
          p: 'During poster or comic generation you\'ll find an option to upload a face photo. The AI builds a "Character Sheet" from it and casts you into the scenes. Every registered user gets one free poster to try it. ' + uploadsSentenceEn() + ' Note — this feature is for users aged 18 and over, and you may only upload your own face, or an adult who has consented.',
        },
        {
          h: 'How does "Invite friends" work?',
          p: 'In the account menu (after signing in), tap "Invite friends" to get a personal link. For every friend who signs up through it and makes their first poster, you earn a free "Star Yourself" poster. You can track how many friends joined and how many posters you\'ve earned right inside the window.',
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
          p: 'מאחורי כל לחיצה המערכת מנסה מודלי AI בזה אחר זה — קודם Gemini, ו-Gemma ו-DeepSeek כגיבוי — כדי שתסריט יגיע גם כשאחד עמוס. לתמונות, קסקדה של ספקים — Cloudflare AI, FLUX וב"לככב בסיפור" גם Grok ו-Gemini — עוזרת להגיש פוסטר ופאנלים גם בעומס גבוה.',
        },
        {
          h: 'מהתסריט ללוח הסיפור',
          p: 'אחרי שהתסריט מוכן, LIFESCRIPT ממשיכה בהפקה: מנתחת את הסצנות, מחלקת אותן ל-5 עד 7 פאנלים ומייצרת כל פאנל בנפרד — בסגנון שבחרת: סגנון אנימה, קומיקס רטרו, או נואר קולנועי. הפאנלים מופיעים בהדרגה ברגע שמוכנים, כך שהיצירה מתגלה בפניך סצנה אחר סצנה.',
        },
        {
          h: 'לככב בסיפור שלך',
          p: 'הפיצ\'ר החתום שלנו: העלה תמונת פנים, וה-AI יהפוך אותך לדמות הראשית בפוסטר ובקומיקס שלך. אנחנו בונים "גיליון דמות" עקבי כדי שתיראה כמוך לאורך כל הסצנות. כל משתמש רשום מקבל פוסטר "לככב בסיפור" אחד חינם להתנסות.',
        },
        {
          h: 'חינמי והזמנת חברים',
          p: faqPlansHe(),
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
          p: 'Behind every click, the system tries AI models in turn — Gemini first, with Gemma and DeepSeek as backups — so a script is delivered even when one is busy. For visuals, a cascade of image providers — Cloudflare AI, FLUX and, for Star Yourself, Grok and Gemini — helps deliver your poster and panels even under heavy load.',
        },
        {
          h: 'From Script to Storyboard',
          p: "Once your script is ready, LIFESCRIPT continues production: it analyzes scenes, breaks them into 5–7 panels, and generates each independently — in your chosen style: Anime Style, Retro Comic, or Cinematic Noir. Panels appear progressively the moment they're ready, so your creation reveals itself scene by scene.",
        },
        {
          h: 'Star in Your Own Story',
          p: 'Our signature feature: upload a face photo, and the AI turns you into the lead character of your own poster and comic. We build a consistent "Character Sheet" so you look like yourself across every scene. Every registered user gets one free "Star Yourself" poster to try it.',
        },
        {
          h: 'Free & Inviting Friends',
          p: faqPlansEn(),
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

// ─── Android-app (Capacitor) variant ─────────────────────────────────────────────────────────────────────────────────
// Google Play payments policy: inside the native app nothing may mention a price, a subscription, Stripe or "upgrading". The web
// MODAL_DATA above is unchanged; the app renders modalDataFor(true), which drops the billing / payments / "how to upgrade"
// sections, neutralises the plan descriptions, and renumbers the headings.
// (tests/native-copy.test.js scans the result for any leftover price / subscription / upgrade wording.)
const NATIVE_DROP = /^\s*(?:\d+\.\s*)?(?:חיוב, חידוש|Billing, Renewal|תשלומים$|Payments$)|משדרגים ל-Pro|לשדרג ל-Pro|upgrade to Pro|חינמי והזמנת|Free & Inviting/i;
const NATIVE_PLANS = {
  he: 'השימוש בשירות כפוף למכסות שימוש הוגן יומיות וחודשיות, שעשויות להשתנות ומתחדשות לפי החלון המוצג באפליקציה. כל משתמש רשום מקבל מכסה של תסריטים, פוסטרים וקומיקסים, וכן פוסטר "לככב בסיפור" אחד חינם (חד-פעמי).',
  en: 'Use of the service is subject to daily and monthly fair-use quotas, which may change and renew on the schedule shown in the app. Every registered user receives an allowance of scripts, posters and comics, plus one free "Star Yourself" poster (one-time).',
};
const NATIVE_STAR = {
  he: 'בשלב יצירת הפוסטר או הקומיקס תמצא אפשרות להעלות תמונת פנים. ה-AI בונה ממנה "גיליון דמות" ומחדיר אותך לסצנות. כל משתמש רשום מקבל פוסטר אחד חינם להתנסות. שים לב — הפיצ\'ר מיועד לבני 18 ומעלה, ומותר להעלות רק את הפנים שלך, או של בגיר שנתן הסכמה.',
  en: 'During poster or comic generation you\'ll find an option to upload a face photo. The AI builds a "Character Sheet" from it and casts you into the scenes. Every registered user gets one free poster to try it. Note — this feature is for users aged 18 and over, and you may only upload your own face, or an adult who has consented.',
};
const NATIVE_ABOUT_STAR = {
  he: 'הפיצ\'ר החתום שלנו: העלה תמונת פנים, וה-AI יהפוך אותך לדמות הראשית בפוסטר ובקומיקס שלך. אנחנו בונים "גיליון דמות" עקבי כדי שתיראה כמוך לאורך כל הסצנות. כל משתמש רשום מקבל פוסטר "לככב בסיפור" אחד חינם להתנסות.',
  en: 'Our signature feature: upload a face photo, and the AI turns you into the lead character of your own poster and comic. We build a consistent "Character Sheet" so you look like yourself across every scene. Every registered user gets one free "Star Yourself" poster to try it.',
};

// Disclosures about web-payment data and the Pro waitlist: removed from the app's copy (the full wording stays on the web pages).
const NATIVE_TEXT_REPLACEMENTS = [
  [' באתר בלבד, ורק לאחר שתאשרו עוגיות אנליטיקה, אנחנו טוענים גם את Google Analytics, שקובע מזהים (עוגיות) ומעבד נתונים כמו כתובת ה-IP ופרטי המכשיר כדי לספק לנו סטטיסטיקות שימוש; איננו משתמשים בו לפרסום. Google Analytics פועל לפי בחירת הסכמה השמורה במכשיר שלכם (Google Consent Mode: אחסון האנליטיקה מוגדר כברירת מחדל כ-"denied" והופך ל-"granted" רק כשתאשרו; אחסון הפרסום חסום תמיד). לפני שתחליטו הוא אינו נטען ושום דבר אינו נשלח ל-Google; אם תאשרו הוא נטען ומתחיל לספור את הביקורים שלכם; אם תסרבו הוא לא ייטען לעולם. אפשר לאפס את הבחירה על ידי ניקוי נתוני האתר בדפדפן. הוא אינו נטען לעולם באפליקציית האנדרואיד.', ''],
  [' On the website only, and only after you accept analytics cookies, we also load Google Analytics, which sets identifiers (cookies) and processes data such as your IP address and device information to give us usage statistics; we do not use it for advertising. Google Analytics works with a consent choice that is stored on your device (Google Consent Mode: analytics storage is "denied" by default and becomes "granted" only when you accept; advertising storage is always denied). Before you decide it is not loaded and nothing is sent to Google; if you accept it is loaded and starts counting your visits; if you decline it is never loaded. You can reset the choice by clearing this site\'s data in your browser. It is never loaded in the Android app.', ''],
  ['המסלול שלך (כולל גישה מיוחדת שהענקנו), ', ''],
  ['מזהה לקוח אצל ספק תשלומים (רק אם אי פעם נוצרה עבורך רשומת לקוח כזו; כיום איננו גובים תשלומים), ', ''],
  ['your plan (including any special access we granted), ', ''],
  ['a payment-provider customer ID (only if such a customer record was ever created for you; we collect no payments today), ', ''],
  [', הרשמות לרשימת ההמתנה ובקשות', ' ובקשות'],
  ['Feedback, waitlist sign-ups and deletion requests', 'Feedback and deletion requests'],
  [' אם תצטרפו לרשימת ההמתנה לאפשרות בתשלום עתידית, נשמור את כתובת האימייל, את השפה, את התאריך, את גרסת ההודעה שראיתם, ואם הייתם מחוברים — את מזהה החשבון. נשתמש בהם רק כדי לעדכן אתכם פעם אחת כשהאפשרות תהיה זמינה, ונשמור אותם עד אז או עד שתבקשו להסיר אותם (דרך עמוד מחיקת הנתונים או במייל).', ''],
  [' If you join the waitlist for a possible future paid option we store your email address, your language, the date, the version of the notice you saw and, if you were signed in, your account id. We use them only to tell you once when it is available, and keep them until then or until you ask us to remove them (through the data-deletion page or by email).', ''],
  ['waitlist and deletion-request messages', 'deletion-request messages'],
  ['בהרשמה לרשימת ההמתנה ובבקשת מחיקה', 'בבקשת מחיקה'],
];
const applyNativeReplacements = (p) => NATIVE_TEXT_REPLACEMENTS.reduce((t, [from, to]) => t.split(from).join(to), p);

function nativeParagraph(h, p) {
  if (/^\d+\.\s*(?:מכסות ושימוש|Quotas & Fair)/.test(h)) return /[א-ת]/.test(h) ? NATIVE_PLANS.he : NATIVE_PLANS.en;
  if (/^\d+\.\s*(?:הגבלת גיל|Age Restriction)/.test(h)) return applyNativeReplacements(p);
  if (/מלככבים" בפוסטר|"star" in the poster/.test(h)) return /[א-ת]/.test(h) ? NATIVE_STAR.he : NATIVE_STAR.en;
  if (/לככב בסיפור שלך|Star in Your Own Story/.test(h)) return /[א-ת]/.test(h) ? NATIVE_ABOUT_STAR.he : NATIVE_ABOUT_STAR.en;
  return applyNativeReplacements(p);
}

/** MODAL_DATA for the web (native=false: the very same object) or for the Android app (native=true: no pricing / purchase text). */
export function modalDataFor(native) {
  if (!native) return MODAL_DATA;
  const out = {};
  for (const [doc, langs] of Object.entries(MODAL_DATA)) {
    out[doc] = {};
    for (const [lang, content] of Object.entries(langs)) {
      if (!content || !Array.isArray(content.sections)) { out[doc][lang] = content; continue; }
      let sections = content.sections
        .filter((sec) => !NATIVE_DROP.test(sec.h || ''))
        .map((sec) => ({ ...sec, p: nativeParagraph(sec.h || '', sec.p) }));
      if (content.sections.every((sec) => /^\d+\./.test(sec.h || ''))) {
        let n = 0;
        sections = sections.map((sec) => ({ ...sec, h: sec.h.replace(/^\d+\./, `${++n}.`) }));
      }
      out[doc][lang] = { ...content, sections };
    }
  }
  return out;
}
