// תרגומים לשפות שונות
const translations = {
    he: {
        appTitle: 'החיים כסרט',
        mainHeading: 'החיים כסרט',
        subtitle: 'ספר לי מה עבר עליך היום ואת השאר תשאיר לי',
        journalSectionHeading: 'כתוב את היומן שלך',
        journalLabel: 'רשומה יומית:',
        journalPlaceholder: 'כתוב כאן את הרשומה היומית שלך...',
        genreLabel: 'בחר ז\'אנר קומיקס:',
        genreTip: 'בחר ז\'אנר שיתאים לסיפור שלך - זה ישפיע על הסגנון והטון של התסריט.',
        generateButton: 'צור תסריט',
        loadingMessage: 'טוען...',
        errorMessagePrefix: 'שגיאה: ',
        missingFieldsError: 'אנא מלא את כל השדות.',
        serverErrorPrefix: 'שגיאת שרת: ',
        scriptOutputHeading: 'התסריט שלך:',
        langHebrew: 'עברית',
        langEnglish: 'English',
        continueScriptBtn: 'המשך תסריט',
        saveScriptBtn: 'שמור תסריט',
        saveStoryBtn: 'שמור סיפור'
    },
    en: {
        appTitle: 'Life as a Movie',
        mainHeading: 'Life as a Movie',
        subtitle: 'Tell me about your day, and I’ll do the rest',
        journalSectionHeading: 'Write Your Journal Entry',
        journalLabel: 'Journal Entry:',
        journalPlaceholder: 'Write your daily entry here...',
        genreLabel: 'Select Comic Genre:',
        genreTip: 'Choose a genre that fits your story - it will affect the style and tone of the script.',
        generateButton: 'Generate Script',
        loadingMessage: 'Loading...',
        errorMessagePrefix: 'Error: ',
        missingFieldsError: 'Please fill in all fields.',
        serverErrorPrefix: 'Server error: ',
        scriptOutputHeading: 'Your Script:',
        langHebrew: 'עברית',
        langEnglish: 'English',
        continueScriptBtn: 'Continue Script',
        saveScriptBtn: 'Save Script',
        saveStoryBtn: 'Save Story'
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // אלמנטים ב-DOM
    const appTitle = document.getElementById('app-title');
    const mainHeading = document.getElementById('main-heading');
    const journalSectionHeading = document.getElementById('journal-section-heading');
    const journalLabel = document.getElementById('journal-label');
    const journalEntry = document.getElementById('journal-entry');
    const genreLabel = document.getElementById('genre-label');
    const generateButton = document.getElementById('generate-button');
    const loadingDiv = document.getElementById('loading');
    const errorDiv = document.getElementById('error');
    const scriptOutput = document.getElementById('script-output');
    const scriptOutputHeading = document.getElementById('script-output-heading');
    const langToggleHe = document.getElementById('lang-toggle-he');
    const langToggleEn = document.getElementById('lang-toggle-en');
    const htmlElement = document.documentElement;
    const subtitle = document.getElementById('subtitle');
    const saveScriptBtn = document.getElementById('save-script');
    const saveStoryBtn = document.getElementById('save-story');
    const genreTip = document.getElementById('genre-tip');
    const themeToggle = document.getElementById('theme-toggle');

    // בדיקת קיום אלמנטים קריטיים
    if (!appTitle || !mainHeading || !journalSectionHeading || !journalLabel || !journalEntry || !genreLabel || !generateButton || !loadingDiv || !errorDiv || !scriptOutput || !scriptOutputHeading || !langToggleHe || !langToggleEn || !saveScriptBtn || !saveStoryBtn || !themeToggle) {
        console.error('חסר אלמנט קריטי ב-HTML. ודא שכל ה-id-ים קיימים.');
        return;
    }

    // ז'אנרים עם אייקונים
    const genres = [
        { value: 'adventure', he: 'הרפתקאות', en: 'Adventure', icon: '🧭' },
        { value: 'comedy', he: 'קומדיה', en: 'Comedy', icon: '😂' },
        { value: 'drama', he: 'דרמה', en: 'Drama', icon: '🎭' },
        { value: 'sci-fi', he: 'מדע בדיוני', en: 'Sci-Fi', icon: '🤖' },
        { value: 'horror', he: 'אימה', en: 'Horror', icon: '👻' },
        { value: 'fantasy', he: 'פנטזיה', en: 'Fantasy', icon: '🧙‍♂️' },
        { value: 'romance', he: 'רומנטיקה', en: 'Romance', icon: '💖' },
        { value: 'action', he: 'פעולה', en: 'Action', icon: '💥' },
    ];
    let selectedGenre = genres[0].value;

    // כפתור המשך תסריט
    let currentLang = htmlElement.getAttribute('lang') || 'he';
    const continueScriptBtn = document.createElement('button');
    continueScriptBtn.type = 'button';
    continueScriptBtn.id = 'continue-script';
    continueScriptBtn.className = 'secondary-btn';
    continueScriptBtn.style.display = 'none';
    continueScriptBtn.textContent = translations[currentLang]?.continueScriptBtn || 'המשך תסריט';
    scriptOutput.parentNode.appendChild(continueScriptBtn);

    let lastScript = '';
    let continueUsed = false;

    // פונקציה ליצירת גריד ז'אנרים
    function renderGenreGrid(lang) {
        console.log('renderGenreGrid called with lang:', lang);
        const grid = document.getElementById('genre-carousel');
        if (!grid) {
            console.error('genre-carousel לא קיים ב-DOM!');
            return;
        }
        grid.innerHTML = '';
        genres.forEach(g => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'genre-btn';
            btn.dataset.value = g.value;
            btn.setAttribute('aria-label', g[lang]);
            btn.innerHTML = g.icon + `<span>${g[lang]}</span>`;
            if (g.value === selectedGenre) btn.classList.add('selected');
            btn.addEventListener('click', () => {
                selectedGenre = g.value;
                document.querySelectorAll('.genre-btn').forEach(b => b.classList.remove('selected'));
                btn.classList.add('selected');
            });
            grid.appendChild(btn);
        });
        console.log('סיום renderGenreGrid, כפתורים ב-grid:', grid.children.length);
    }

    // פונקציה לעדכון טקסטים לפי שפה
    function updateContent(lang) {
        console.log('updateContent called with lang:', lang);
        appTitle.textContent = translations[lang].appTitle;
        mainHeading.textContent = translations[lang].mainHeading;
        if (subtitle) subtitle.textContent = translations[lang].subtitle;
        journalSectionHeading.textContent = translations[lang].journalSectionHeading;
        journalLabel.textContent = translations[lang].journalLabel;
        journalEntry.placeholder = translations[lang].journalPlaceholder;
        genreLabel.textContent = translations[lang].genreLabel;
        if (genreTip) genreTip.textContent = translations[lang].genreTip;
        generateButton.textContent = translations[lang].generateButton;
        loadingDiv.textContent = translations[lang].loadingMessage;
        if (scriptOutputHeading.style.display !== 'none') {
            scriptOutputHeading.textContent = translations[lang].scriptOutputHeading;
        }
        langToggleHe.textContent = translations[lang].langHebrew;
        langToggleEn.textContent = translations[lang].langEnglish;
        continueScriptBtn.textContent = translations[lang].continueScriptBtn;
        saveScriptBtn.textContent = translations[lang].saveScriptBtn || (lang === 'he' ? 'שמור תסריט' : 'Save Script');
        saveStoryBtn.textContent = translations[lang].saveStoryBtn || (lang === 'he' ? 'שמור סיפור' : 'Save Story');
        if (lang === 'he') {
            htmlElement.setAttribute('lang', 'he');
            htmlElement.setAttribute('dir', 'rtl');
            document.body.style.textAlign = 'right';
        } else {
            htmlElement.setAttribute('lang', 'en');
            htmlElement.setAttribute('dir', 'ltr');
            document.body.style.textAlign = 'left';
        }
        langToggleHe.classList.toggle('active', lang === 'he');
        langToggleEn.classList.toggle('active', lang === 'en');
        renderGenreGrid(lang);
    }

    // קביעת שפת ברירת המחדל
    updateContent(currentLang);

    // הוספת מאזינים לכפתורי השפה
    langToggleHe.addEventListener('click', () => {
        currentLang = 'he';
        updateContent('he');
    });
    langToggleEn.addEventListener('click', () => {
        currentLang = 'en';
        updateContent('en');
    });

    // מאזין למצב כהה
    function setDarkMode(active, persist = true) {
        if (active) {
            document.documentElement.classList.add('dark');
            if (themeToggle) {
                themeToggle.innerHTML = '<span aria-hidden="true">☀️</span><span class="visually-hidden">מצב בהיר</span>';
                themeToggle.setAttribute('aria-label', 'מצב בהיר');
            }
            if (persist) localStorage.setItem('theme', 'dark');
        } else {
            document.documentElement.classList.remove('dark');
            if (themeToggle) {
                themeToggle.innerHTML = '<span aria-hidden="true">🌙</span><span class="visually-hidden">מצב כהה</span>';
                themeToggle.setAttribute('aria-label', 'מצב כהה');
            }
            if (persist) localStorage.setItem('theme', 'light');
        }
    }
    themeToggle.addEventListener('click', () => {
        setDarkMode(!document.documentElement.classList.contains('dark'));
    });

    // טעינה ראשונית
    (function() {
        const userPref = localStorage.getItem('theme');
        const systemPref = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        if (userPref === 'dark' || (!userPref && systemPref)) {
            setDarkMode(true, false);
        } else {
            setDarkMode(false, false);
        }
    })();

    // מאזין לשליחת הטופס
    document.getElementById('journal-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        console.log('submit event fired');
        const journalEntryValue = journalEntry.value.trim();
        const genre = selectedGenre;
        if (!journalEntryValue || !genre) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = translations[currentLang].missingFieldsError;
            return;
        }
        errorDiv.style.display = 'none';
        scriptOutput.textContent = '';
        scriptOutputHeading.style.display = 'none';
        loadingDiv.style.display = 'block';
        try {
            const response = await fetch('/api/generateScript', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ journalEntry: journalEntryValue, genre })
            });
            if (!response.ok) {
                const errorData = await response.json();
                if (response.status === 429) {
                    throw new Error('המערכת עמוסה כרגע. נסה שוב בעוד מספר דקות.');
                }
                throw new Error(`${translations[currentLang].serverErrorPrefix}${response.status} - ${errorData.error || 'Unknown error'}`);
            }
            const data = await response.json();
            let warningHtml = '';
            if (data.warning) {
                warningHtml = `<div class="script-warning" style="color:#b71c1c;font-weight:bold;background:#fff3f3;border:1.5px solid #b71c1c;padding:0.7em 1em;margin-bottom:0.7em;border-radius:8px;direction:rtl;text-align:right;">⚠️ ${data.warning}</div>`;
            }
            scriptOutput.innerHTML = warningHtml + `<pre class="script-professional">${(data.script || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').trim()}</pre>`;
            lastScript = data.script;
            continueUsed = false;
            showSaveScriptBtn(true);
            scriptOutputHeading.textContent = translations[currentLang].scriptOutputHeading;
            scriptOutputHeading.style.display = 'block';
            document.getElementById('result-card').style.display = 'block';
            continueScriptBtn.style.display = 'inline-block';
            continueScriptBtn.disabled = false;
        } catch (err) {
            errorDiv.style.display = 'block';
            errorDiv.textContent = `${translations[currentLang].errorMessagePrefix}${err.message}`;
        } finally {
            loadingDiv.style.display = 'none';
        }
    });

    // כפתור שמירת תסריט
    saveScriptBtn.addEventListener('click', () => {
        const script = scriptOutput.textContent;
        if (!script) return;
        const blob = new Blob([script], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'comic-script.txt';
        a.click();
    });

    // הצג כפתור שמירה רק אם יש תסריט
    function showSaveScriptBtn(show) {
        saveScriptBtn.style.display = show ? 'inline-block' : 'none';
        document.getElementById('result-card').style.display = show ? 'block' : 'none';
    }

    // כפתור שמירת סיפור
    saveStoryBtn.addEventListener('click', () => {
        const story = journalEntry.value.trim();
        if (!story) return;
        const blob = new Blob([story], { type: 'text/plain' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'my-story.txt';
        a.click();
    });

    // הסתרת כפתור שמירה אם אין תסריט
    scriptOutput.textContent = '';
    showSaveScriptBtn(false);
});